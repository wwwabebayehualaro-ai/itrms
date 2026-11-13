/**
 * The rules of the new vehicle registration service, DVC-01 (task 1.2b): what a request must meet, and the steps that make a vehicle,
 * give it its plate and issue its libre. The register itself (vehicles, ownerships, plates, libres) is the vehicles slice's; these
 * steps call its commands inside the transition's transaction, so a step that fails leaves nothing. The effects are thin over this.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { DocumentsService, documentTemplates, issuedDocuments } from '@itrms/documents/api';
import { StationeryStock } from '@itrms/fees/api';
import { parseStationeryKey } from '@itrms/fees/contracts';
import { nextNumber } from '@itrms/kernel/numbering';
import { unitRefs } from '@itrms/kernel/org';
import { organisations, persons } from '@itrms/parties/api';
import {
    libres,
    PlateStock,
    plateAssignments,
    plates,
    vehicleOwnerships,
    vehicles,
    VehicleRegistry,
    VehiclesService
} from '@itrms/vehicles/api';
import {
    federalVehicleIdSchema,
    nationalPlateText,
    parsePlate,
    parseVin,
    REGISTRATION_CERTIFICATE_COUNTER,
    type vehicleRegisterSchema
} from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';
import type { z } from 'zod';

import {
    addisDay,
    bookletEntrySchema,
    nationalEntrySchema,
    ownerRowSchema,
    REGISTRATION_CERTIFICATE_TEMPLATE
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { actForHandlingOffice, claimedElsewhere } from './handling-office';
import type { CasePlace } from './licences.service';

type Words = keyof typeof am;
type RegisterInput = z.input<typeof vehicleRegisterSchema>;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

/** The request's answers an effect reads, by contract path (the effects' input contract, see registration.effects.ts). */
export type RegistrationInput = {
    owners: unknown[];
    chassisNumber: string;
    chassisKind?: string;
    chassisMismatchConfirmed?: boolean;
    engineNumber?: string;
    make: string;
    model: string;
    modelYear: number;
    categoryKey: string;
    use: string;
    seats?: number;
    loadCapacityKg?: number;
    grossWeightKg?: number;
    engineCc?: number;
    axles?: number;
    colour?: string;
    fuel?: string;
    madeIn?: string;
    engineHp?: number;
    cylinders?: number;
    /** the size as the papers give it, in metres */
    lengthM?: number;
    widthM?: number;
    heightM?: number;
    tyreSize?: string;
    tyres?: number;
    netWeightKg?: number;
};

/** A size in metres, as the papers give it, in whole millimetres as the register keeps it. */
const millimetres = (metres: number | undefined): number | undefined =>
    metres === undefined ? undefined : Math.round(metres * 1000);

/** The register's bounds of a vehicle's size, in metres: a size outside them is refused at the box it was typed in. */
const SIZE_METRES = { lengthM: [0.5, 30], widthM: [0.5, 5], heightM: [0.5, 6] } as const;

type Facts = Readonly<Record<string, unknown>>;

const factObject = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const value = facts[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
};

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.registration_missing_fact', params: { key } });

const factId = (facts: Facts, key: string): string => {
    const id = factObject(facts, key)?.id;
    if (typeof id !== 'string') throw missingFact(key);
    return id;
};

@Injectable()
export class VehicleRegistrationService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(PlateStock) private readonly stock: PlateStock,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(DocumentsService) private readonly documents: DocumentsService,
        @Inject(StationeryStock) private readonly stationery: StationeryStock
    ) {}

    /**
     * What the register's command takes, from the request's answers: one owner of either kind in each row. The back-capture of a
     * paper file (back-capture.service.ts) reads the same answers.
     */
    registerInput(input: RegistrationInput, extra: { firstRegisteredOn: string }): RegisterInput {
        const outside = (Object.keys(SIZE_METRES) as (keyof typeof SIZE_METRES)[]).filter((k) => {
            const value = input[k];
            const [min, max] = SIZE_METRES[k];
            return value !== undefined && (value < min || value > max);
        });
        if (outside.length > 0)
            throw new ValidationError('validation_failed', {
                errors: outside.map((path) => ({
                    path,
                    code: 'out_of_range',
                    message: say('competency.rule.sizeMetres')
                }))
            });
        const owners = input.owners.map((row, i) => {
            const parsed = ownerRowSchema.safeParse(row);
            const person = parsed.success ? parsed.data.ownerPerson : undefined;
            const organisation = parsed.success ? parsed.data.ownerOrganisation : undefined;
            if (!parsed.success || Boolean(person) === Boolean(organisation))
                throw new ValidationError('validation_failed', {
                    errors: [{ path: `owners.${i}`, code: 'owner_one_of', message: say('competency.rule.ownerOneOf') }]
                });
            return person
                ? { kind: 'person' as const, id: person }
                : { kind: 'organisation' as const, id: organisation ?? '' };
        });
        const given: Record<string, unknown> = {
            owners,
            chassisNumber: input.chassisNumber,
            chassisKind: input.chassisKind,
            acceptVinMismatch: input.chassisMismatchConfirmed,
            engineNumber: input.engineNumber,
            make: input.make,
            model: input.model,
            modelYear: input.modelYear,
            categoryKey: input.categoryKey,
            use: input.use,
            seats: input.seats,
            loadCapacityKg: input.loadCapacityKg,
            grossWeightKg: input.grossWeightKg,
            engineCc: input.engineCc,
            axles: input.axles,
            colour: input.colour,
            fuel: input.fuel,
            madeIn: input.madeIn,
            engineHp: input.engineHp,
            cylinders: input.cylinders,
            lengthMm: millimetres(input.lengthM),
            widthMm: millimetres(input.widthM),
            heightMm: millimetres(input.heightM),
            tyreSize: input.tyreSize,
            tyres: input.tyres,
            netWeightKg: input.netWeightKg,
            firstRegisteredOn: extra.firstRegisteredOn
        };
        // a box left empty is no value: the register's command takes an absent key, not an undefined one
        return Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) as RegisterInput;
    }

    // ---- filing ----

    /**
     * What makes a request acceptable, checked on the server: the register's own checks (category, seats and load, chassis number,
     * owners), and that no other open request is for the same chassis. Nothing is written.
     */
    async check(tx: Tx, place: CasePlace, input: RegistrationInput) {
        const given = this.registerInput(input, { firstRegisteredOn: addisDay() });
        const vin = parseVin(input.chassisNumber, {
            ...(input.chassisKind === 'other' || input.chassisKind === 'iso3779'
                ? { chassisKind: input.chassisKind }
                : {}),
            modelYear: input.modelYear,
            acceptMismatch: input.chassisMismatchConfirmed ?? false
        });
        // two requests for one chassis filed at the same moment: the second waits for the first's transaction, then sees its facts
        if (vin.ok)
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.vehicle-registration:${vin.vinKey}`}, 0))`
            );
        const checked = await this.registry.checkRegistration(tx, place.ctx, given);
        // the vehicle itself is made only when the request is registered, so two could otherwise both get there: an open
        // registration, or an open back-capture of a paper file (task 1.13), of the same chassis anywhere in the region (task 1.2e)
        if (await claimedElsewhere(tx, place.caseId, { vinKey: checked.vinKey }))
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.chassisInOpenCase'),
                detailKey: 'competency.rule.chassisInOpenCase'
            });
        return {
            registration: {
                vinKey: checked.vinKey,
                chassisNumber: checked.chassisNumber,
                vinCheck: checked.vinCheck,
                // a check digit the officer confirmed does not match: shown on the case to the lead who approves it
                notices: checked.vinCheck === 'mismatch' ? ['competency.notice.chassisMismatch'] : []
            }
        };
    }

    // ---- the plate, held from approval ----

    /** The office's next free plate, held for the case so that a registration approved can always be completed. */
    async reservePlate(tx: Tx, place: CasePlace) {
        const plate = await this.stock.reserve(tx, place.ctx, {
            holderUnitId: place.handlingUnitId,
            caseId: place.caseId,
            on: addisDay()
        });
        return { plate: { id: plate.id, key: plate.plateKey, text: nationalPlateText(plate.plateKey) } };
    }

    /** A rejected case gives its plate back to the office's stock. No plate held is nothing to do. */
    async releasePlate(tx: Tx, place: CasePlace): Promise<void> {
        await this.stock.release(tx, place.ctx, { caseId: place.caseId, on: addisDay() });
    }

    // ---- the registration ----

    /** The federal vehicle id the officer read from the national system, as a step's answer. Kept only if no vehicle has it. */
    async recordFederalId(tx: Tx, place: CasePlace, facts: Facts, answers: unknown) {
        const given = nationalEntrySchema.parse(answers).federalVehicleId;
        if (given === undefined || given === '') return {};
        const parsed = federalVehicleIdSchema.safeParse(given);
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: 'federalVehicleId',
                    code: 'invalid',
                    message: i.message
                }))
            });
        const [holder] = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(and(eq(vehicles.regionId, place.regionId), eq(vehicles.federalVehicleId, parsed.data)));
        if (holder && holder.id !== (await this.vehicleOf(tx, place.caseId)))
            throw new ConflictError('duplicate_reference', { detailKey: 'vehicles.errors.duplicate_federal_id' });
        return {
            registration: {
                ...factObject(facts, 'registration'),
                federalVehicleId: parsed.data,
                federalIdSource: 'manual'
            }
        };
    }

    /** The vehicle this case registered, if it has: a step taken twice makes one vehicle. */
    private async vehicleOf(tx: Tx, caseId: string): Promise<string | undefined> {
        const [made] = await tx
            .select({ vehicleId: vehicleOwnerships.vehicleId })
            .from(vehicleOwnerships)
            .where(and(eq(vehicleOwnerships.caseId, caseId), eq(vehicleOwnerships.acquiredBy, 'first_registration')));
        return made?.vehicleId;
    }

    /** The vehicle, its owners and the first ownership period, handled by the office the case is in. */
    async register(tx: Tx, at: CasePlace, facts: Facts, input: RegistrationInput) {
        // the register records the acting unit as the vehicle's handling office, and the plate comes from that office's stock
        const place = await actForHandlingOffice(tx, at);
        const made = await this.vehicleOf(tx, place.caseId);
        if (made) return { vehicle: { id: made } };
        const registration = factObject(facts, 'registration');
        const federalVehicleId = registration?.federalVehicleId;
        const given = this.registerInput(input, { firstRegisteredOn: addisDay() });
        const vehicle = await this.registry.register(tx, place.ctx, {
            ...given,
            ...(typeof federalVehicleId === 'string' ? { federalVehicleId, federalIdSource: 'manual' as const } : {}),
            caseId: place.caseId
        });
        return { vehicle: { id: vehicle.id } };
    }

    /**
     * The reserved plate goes on the vehicle; or, when the counter had to hand over another plate of the office's stock (the
     * reserved one is not at hand), the plate the officer named. The plate not used is free again.
     */
    async assignPlate(tx: Tx, at: CasePlace, facts: Facts, answers: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const vehicleId = factId(facts, 'vehicle');
        const today = addisDay();
        // run again, the vehicle already carries the plate this case gave it
        const [carried] = await tx
            .select({ id: plates.id, key: plates.plateKey })
            .from(plateAssignments)
            .innerJoin(plates, eq(plates.id, plateAssignments.plateId))
            .where(
                and(
                    eq(plateAssignments.vehicleId, vehicleId),
                    isNull(plateAssignments.until),
                    eq(plates.caseId, place.caseId)
                )
            );
        if (carried) return { plate: { id: carried.id, key: carried.key, text: nationalPlateText(carried.key) } };
        const reserved = factObject(facts, 'plate');
        const reservedKey = typeof reserved?.key === 'string' ? reserved.key : undefined;
        const replacement = nationalEntrySchema.parse(answers).replacementPlate;
        let key = reservedKey;
        if (replacement) {
            const parsed = parsePlate(replacement, []);
            if (!parsed || parsed.format !== 'national')
                throw new ValidationError('validation_failed', {
                    errors: [
                        { path: 'replacementPlate', code: 'invalid_plate', message: say('competency.rule.notAPlate') }
                    ]
                });
            if (parsed.key !== reservedKey) {
                await this.stock.release(tx, place.ctx, { caseId: place.caseId, on: today });
                key = parsed.key;
            }
        }
        if (!key) throw missingFact('plate');
        const assigned = await this.registry.assignStockPlate(tx, place.ctx, vehicleId, {
            key,
            caseId: place.caseId,
            since: today
        });
        return { plate: { id: assigned.plateId, key: assigned.key, text: nationalPlateText(assigned.key) } };
    }

    // ---- the libre (ADR-0050) ----

    /**
     * The libre of the vehicle's owners, with no number yet, and its registration certificate (the temporary libre), numbered
     * from the office's counter. The booklet is the next step's (`issueBooklet`). Run again it returns what it issued.
     */
    async issueLibre(tx: Tx, at: CasePlace, facts: Facts, template: string | undefined) {
        const place = await actForHandlingOffice(tx, at);
        const vehicleId = factId(facts, 'vehicle');
        const libre = await this.registry.issueLibre(tx, place.ctx, vehicleId, {
            issuedOn: addisDay(),
            caseId: place.caseId
        });
        const templateKey = template || REGISTRATION_CERTIFICATE_TEMPLATE;
        const issued = await this.certificate(tx, place, libre, templateKey);
        const known = factObject(facts, 'documents') ?? {};
        return {
            libre: { id: libre.id, number: libre.number, template: templateKey },
            documents: { ...known, [templateKey]: issued.id }
        };
    }

    /**
     * The federal booklet the libre is written in, from the office's stationery: the one the officer names, or the office's next
     * one. The booklets spoiled on the way are recorded with their reasons and never issued again. The certificate is issued
     * again with the booklet's serial, and the one before it says superseded. With no booklet in stock the step is refused and
     * the case waits in it until booklets come. Run again it returns the booklet it took.
     */
    async issueBooklet(tx: Tx, at: CasePlace, facts: Facts, answers: unknown) {
        const place = await actForHandlingOffice(tx, at);
        const libreId = factId(facts, 'libre');
        const templateKey = this.factText(facts, 'libre', 'template') ?? REGISTRATION_CERTIFICATE_TEMPLATE;
        const parsed = bookletEntrySchema.safeParse(answers);
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    code: 'invalid',
                    message: i.message
                }))
            });
        const given = parsed.data;
        const serial = given.bookletSerial || undefined;
        const spoiled = given.spoiledBooklets ?? [];
        const [current] = await tx.select().from(libres).where(eq(libres.id, libreId));
        if (!current) throw missingFact('libre');
        if (current.number === null) {
            const named = [
                ...spoiled.map((b, i) => ({ path: `spoiledBooklets.${i}.spoiledSerial`, text: b.spoiledSerial })),
                ...(serial ? [{ path: 'bookletSerial', text: serial }] : [])
            ];
            const seen = new Set<string>();
            const errors: { path: string; code: string; message: string }[] = [];
            for (const n of named) {
                const p = parseStationeryKey(n.text);
                // the serial, not the text: "LB 3" and "LB0000003" are one booklet
                const key = p ? `${p.series}/${p.serial}` : undefined;
                if (!key)
                    errors.push({ path: n.path, code: 'invalid_serial', message: say('competency.rule.notABooklet') });
                else if (seen.has(key))
                    errors.push({ path: n.path, code: 'named_twice', message: say('competency.rule.bookletSpoiled') });
                else seen.add(key);
            }
            if (errors.length > 0) throw new ValidationError('validation_failed', { errors });
            // every booklet named, locked in the stock's own order: no deadlock with a keeper's command over the same run
            await this.stationery.lockKeys(tx, place.ctx, 'libre_booklet', [
                ...spoiled.map((b) => b.spoiledSerial),
                ...(serial ? [serial] : [])
            ]);
            for (const booklet of spoiled)
                await this.stationery.spoil(tx, place.ctx, {
                    kind: 'libre_booklet',
                    key: booklet.spoiledSerial,
                    reason: booklet.spoiledReason,
                    caseId: place.caseId
                });
        }
        const item = await this.stationery.use(tx, place.ctx, {
            kind: 'libre_booklet',
            ...(serial ? { key: serial } : {}),
            usedFor: { table: 'vehicles.libres', id: libreId },
            caseId: place.caseId
        });
        const libre = await this.registry.recordBooklet(tx, place.ctx, libreId, {
            number: item.itemKey,
            ...(given.libreNationalReference ? { nationalReference: given.libreNationalReference } : {})
        });
        const issued = await this.certificate(tx, place, libre, templateKey);
        const known = factObject(facts, 'documents') ?? {};
        return {
            libre: { id: libre.id, number: libre.number, template: templateKey, booklet: item.itemKey },
            documents: { ...known, [templateKey]: issued.id }
        };
    }

    private factText(facts: Facts, key: string, field: string): string | undefined {
        const value = factObject(facts, key)?.[field];
        return typeof value === 'string' && value !== '' ? value : undefined;
    }

    /**
     * The libre's registration certificate as the vehicle and the libre now stand: issued once, numbered from the office's
     * counter; issued again (the same number) when what it says has changed, the one before saying superseded.
     */
    private async certificate(tx: Tx, place: CasePlace, libre: typeof libres.$inferSelect, templateKey: string) {
        const [standing] = await tx
            .select({ number: issuedDocuments.number, language: issuedDocuments.language })
            .from(issuedDocuments)
            .innerJoin(documentTemplates, eq(documentTemplates.id, issuedDocuments.templateId))
            .where(
                and(
                    eq(documentTemplates.key, templateKey),
                    eq(issuedDocuments.subjectId, libre.id),
                    isNull(issuedDocuments.supersededBy)
                )
            );
        const number =
            standing?.number ?? (await nextNumber(tx, REGISTRATION_CERTIFICATE_COUNTER, place.handlingUnitId)).number;
        const vehicle = await this.vehicles.get(tx, libre.vehicleId);
        // issued again, it keeps its first language: an officer reading in another language changes nothing on it
        const language = (standing?.language ?? currentContext()?.language) === 'en' ? 'en' : 'am';
        const holders = vehicle.ownerships.find((o) => o.id === libre.ownershipId)?.holders ?? [];
        const addresses = await this.addresses(tx, holders, language);
        const owners = holders.map((h) => ({
            name: h.name[language] || h.name.am,
            address: addresses.get(h.id) ?? null
        }));
        const words = (key: string): { am: string; en: string } => ({
            am: (vehiclesAm as Record<string, string>)[key] ?? key,
            en: (vehiclesEn as Record<string, string>)[key] ?? key
        });
        return this.documents.reissue(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            templateKey,
            language,
            number,
            caseId: place.caseId,
            subject: { table: 'vehicles.libres', id: libre.id },
            data: {
                number,
                issuedOn: libre.issuedOn,
                firstRegisteredOn: vehicle.firstRegisteredOn,
                plate: vehicle.currentPlate?.text ?? '',
                federalVehicleId: vehicle.federalVehicleId,
                owners,
                category: { am: vehicle.category.name.am ?? '', en: vehicle.category.name.en ?? '' },
                make: vehicle.make,
                model: vehicle.model,
                modelYear: vehicle.modelYear,
                madeIn: vehicle.madeIn,
                chassisNumber: vehicle.chassisNumber,
                engineNumber: vehicle.engineNumber,
                engineCc: vehicle.engineCc,
                engineHp: vehicle.engineHp,
                cylinders: vehicle.cylinders,
                fuel: vehicle.fuel ? words(`vehicles.fuel.${vehicle.fuel}`) : null,
                colour: vehicle.colour,
                lengthMm: vehicle.lengthMm,
                widthMm: vehicle.widthMm,
                heightMm: vehicle.heightMm,
                tyreSize: vehicle.tyreSize,
                tyres: vehicle.tyres,
                grossWeightKg: vehicle.grossWeightKg,
                netWeightKg: vehicle.netWeightKg,
                seats: vehicle.seats,
                loadCapacityKg: vehicle.loadCapacityKg,
                use: words(`vehicles.use.${vehicle.use}`),
                // the bolo comes with task 1.3
                boloNumber: null,
                bookletSerial: libre.number,
                nationalReference: libre.nationalReference
            }
        });
    }

    /**
     * Where the owners live, as the certificate prints it: the unit, the kebele and the house number on their record. Never their
     * phone: it is sensitive (read only through an audited reveal) and the certificate is shown at every checkpoint.
     */
    private async addresses(
        tx: Tx,
        holders: readonly { kind: 'person' | 'organisation'; id: string }[],
        language: 'am' | 'en'
    ): Promise<Map<string, string>> {
        const ids = (kind: string) => holders.filter((h) => h.kind === kind).map((h) => h.id);
        const people = ids('person');
        const bodies = ids('organisation');
        const rows = [
            ...(people.length
                ? await tx
                      .select({
                          id: persons.id,
                          unitId: persons.addressUnitId,
                          kebele: persons.kebele,
                          house: persons.houseNumber
                      })
                      .from(persons)
                      .where(inArray(persons.id, people))
                : []),
            ...(bodies.length
                ? await tx
                      .select({
                          id: organisations.id,
                          unitId: organisations.addressUnitId,
                          kebele: organisations.kebele,
                          house: organisations.houseNumber
                      })
                      .from(organisations)
                      .where(inArray(organisations.id, bodies))
                : [])
        ];
        const units = await unitRefs(
            tx,
            rows.map((r) => r.unitId)
        );
        const label = (key: 'competency.libre.kebele' | 'competency.libre.house') => (language === 'en' ? en : am)[key];
        const out = new Map<string, string>();
        for (const r of rows) {
            const unit = r.unitId ? units.get(r.unitId) : undefined;
            const parts = [
                unit ? unit.name[language] || unit.name.am : undefined,
                r.kebele ? `${label('competency.libre.kebele')} ${r.kebele}` : undefined,
                r.house ? `${label('competency.libre.house')} ${r.house}` : undefined
            ].filter((x): x is string => Boolean(x));
            if (parts.length) out.set(r.id, parts.join(', '));
        }
        return out;
    }
}
