/**
 * The rules of the new vehicle registration service, DVC-01 (task 1.2b): what a request must meet, and the steps that make a vehicle,
 * give it its plate and issue its libre. The register itself (vehicles, ownerships, plates, libres) is the vehicles slice's; these
 * steps call its commands inside the transition's transaction, so a step that fails leaves nothing. The effects are thin over this.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { DocumentsService } from '@itrms/documents/api';
import {
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
    type vehicleRegisterSchema
} from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';
import { cases } from '@itrms/workflow/api';
import type { z } from 'zod';

import { addisDay, nationalEntrySchema, ownerRowSchema, VEHICLE_LIBRE_TEMPLATE } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
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
};

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
        @Inject(DocumentsService) private readonly documents: DocumentsService
    ) {}

    /** What the register's command takes, from the request's answers: one owner of either kind in each row. */
    private registerInput(input: RegistrationInput, extra: { firstRegisteredOn: string }): RegisterInput {
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
        // the vehicle itself is made only when the request is registered, so two could otherwise both get there
        const [other] = await tx
            .select({ id: cases.id })
            .from(cases)
            .where(
                and(
                    isNull(cases.closedAt),
                    ne(cases.id, place.caseId),
                    sql`${cases.facts}#>>'{registration,vinKey}' = ${checked.vinKey}`
                )
            )
            .limit(1);
        if (other)
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.chassisInOpenCase'),
                detailKey: 'competency.rule.chassisInOpenCase'
            });
        return {
            registration: { vinKey: checked.vinKey, chassisNumber: checked.chassisNumber, vinCheck: checked.vinCheck }
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
    async register(tx: Tx, place: CasePlace, facts: Facts, input: RegistrationInput) {
        // the register records the acting unit as the vehicle's handling office, and the plate comes from that office's stock
        if (place.ctx.unitId !== place.handlingUnitId)
            throw new ForbiddenError({ detailKey: 'competency.errors.act_from_handling_office' });
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
    async assignPlate(tx: Tx, place: CasePlace, facts: Facts, answers: unknown) {
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

    // ---- the libre ----

    /** The libre for the vehicle's owners, with its number, and its document, signed like any other. */
    async issueLibre(tx: Tx, place: CasePlace, facts: Facts, template: string | undefined) {
        const vehicleId = factId(facts, 'vehicle');
        const libre = await this.registry.issueLibre(tx, place.ctx, vehicleId, {
            issuedOn: addisDay(),
            caseId: place.caseId
        });
        if (!libre.number) throw new NotFoundError();
        const vehicle = await this.vehicles.get(tx, vehicleId);
        const language = currentContext()?.language === 'en' ? 'en' : 'am';
        const owners = (vehicle.ownerships.find((o) => o.id === libre.ownershipId)?.holders ?? []).map((h) => ({
            name: h.name[language] || h.name.am
        }));
        const words = (key: string): { am: string; en: string } => ({
            am: (vehiclesAm as Record<string, string>)[key] ?? key,
            en: (vehiclesEn as Record<string, string>)[key] ?? key
        });
        const templateKey = template || VEHICLE_LIBRE_TEMPLATE;
        const issued = await this.documents.issue(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            templateKey,
            language,
            number: libre.number,
            caseId: place.caseId,
            subject: { table: 'vehicles.libres', id: libre.id },
            data: {
                number: libre.number,
                issuedOn: libre.issuedOn,
                firstRegisteredOn: vehicle.firstRegisteredOn,
                plate: vehicle.currentPlate?.text ?? '',
                federalVehicleId: vehicle.federalVehicleId,
                chassisNumber: vehicle.chassisNumber,
                engineNumber: vehicle.engineNumber,
                make: vehicle.make,
                model: vehicle.model,
                modelYear: vehicle.modelYear,
                category: { am: vehicle.category.name.am ?? '', en: vehicle.category.name.en ?? '' },
                use: words(`vehicles.use.${vehicle.use}`),
                fuel: vehicle.fuel ? words(`vehicles.fuel.${vehicle.fuel}`) : null,
                colour: vehicle.colour,
                seats: vehicle.seats,
                loadCapacityKg: vehicle.loadCapacityKg,
                owners
            }
        });
        const known = factObject(facts, 'documents') ?? {};
        return { libre: { id: libre.id, number: libre.number }, documents: { ...known, [templateKey]: issued.id } };
    }
}
