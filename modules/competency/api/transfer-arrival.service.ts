/**
 * A vehicle arriving from another region, DVC-17 (task 1.4c3, ADR-0060): what the request must meet, and the steps that put the
 * vehicle on the register on the vehicle data transfer document its owner brought. The register is the vehicles slice's and the
 * registration's strict checks apply (the paper facts of a back-capture are not accepted here); the document is checked by the
 * officer, never fetched. The vehicle that once left this region comes back through its own record (task 1.4c3b), so a chassis
 * this register knows is refused here. The plate step is the registration's (VehicleRegistrationService.reservePlate, assignPlate,
 * releasePlate); this adds the check, the registration and the certificate.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { requireCounter } from '@itrms/kernel/numbering';
import { SettingsService } from '@itrms/kernel/settings';
import { libres, PlateStock, vehicles, VehicleArrivals, VehicleRegistry, VehiclesService } from '@itrms/vehicles/api';
import {
    ARRIVAL_VERIFIED_HOW,
    arrivalKey,
    federalVehicleIdSchema,
    parseVin,
    REGISTRATION_CERTIFICATE_COUNTER,
    type vehicleRegisterSchema
} from '@itrms/vehicles/contracts';
import type { z } from 'zod';

import {
    addisDay,
    nationalEntrySchema,
    REGISTRATION_CERTIFICATE_TEMPLATE,
    VEHICLE_TRANSFER_PLATE_EXCHANGE_SETTING,
    VEHICLE_TRANSFER_REINSPECT_SETTING
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { actForHandlingOffice, arrivalClaimedElsewhere, claimedElsewhere } from './handling-office';
import type { CasePlace } from './licences.service';
import {
    checkLibreFree,
    checkPaperDates,
    checkPlateFree,
    libreKey,
    lockPlate,
    plateOf,
    refuse,
    type Refusal
} from './paper-records';
import { VehicleRegistrationService, type RegistrationInput } from './registration.service';

type Words = keyof typeof am;
type RegisterInput = z.input<typeof vehicleRegisterSchema>;
type Facts = Readonly<Record<string, unknown>>;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

/** The request's answers an effect reads, by contract path (see transfer-arrival.effects.ts): the vehicle's, and the document's. */
export type TransferArrivalInput = RegistrationInput & {
    /** the day the vehicle was first registered, as the document says (Gregorian, entered in the Ethiopian calendar) */
    firstRegisteredOn: string;
    /** the day the current owners took it, when the document says (default: the first registration) */
    ownersSince?: string;
    federalVehicleId?: string;
    /** the plate the vehicle arrived on: an old regional plate or a national or special one */
    plate: string;
    /** ticked when the vehicle is given a national plate here: it is what the fee's plate line follows */
    takesNationalPlate?: boolean;
    /** the federal libre the owner holds, its booklet's serial, and the day it was issued */
    libreNumber: string;
    libreIssuedOn: string;
    /** the other region's bolo, a fact only */
    boloValidUntil?: string;
    transferDocumentNumber: string;
    issuingRegion: string;
    issuingOffice: string;
    documentDate: string;
    documentValidUntil: string;
    documentVerified?: boolean;
    verifiedHow: string;
    holdsListed?: boolean;
    holdsNote?: string;
    /** the scan of the document, as the request's file field holds it */
    transferDocumentScan?: unknown;
};

const factObject = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const value = facts[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
};

const missingFact = (key: string) =>
    new ConflictError('contract_unmet', { detailKey: 'competency.errors.registration_missing_fact', params: { key } });

@Injectable()
export class TransferArrivalService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehiclesService) private readonly vehicleRecords: VehiclesService,
        @Inject(PlateStock) private readonly stock: PlateStock,
        @Inject(VehicleArrivals) private readonly arrivals: VehicleArrivals,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    /**
     * The register's command for the arrival: the registration's strict checks, the owners' period acquired by transfer in from the
     * day the document gives, and the document's number and issuing body as its note.
     */
    private registerInput(input: TransferArrivalInput, caseId: string): RegisterInput {
        const federal = input.federalVehicleId?.trim();
        return {
            ...this.registration.registerInput(input, { firstRegisteredOn: input.firstRegisteredOn }),
            ...(federal ? { federalVehicleId: federal, federalIdSource: 'manual' as const } : {}),
            since: input.ownersSince ?? input.firstRegisteredOn,
            acquiredBy: 'transfer_in',
            caseId,
            note: `${input.issuingRegion.trim()} ${input.transferDocumentNumber.trim()}`.slice(0, 500)
        };
    }

    /**
     * The document's own rules: its number, its issuing region and office, its date (not in the future), its last day (not before its
     * date, and not before the day the request was filed: the document is valid then), and that the officer checked it.
     */
    private checkDocument(input: TransferArrivalInput, filedOn: string): void {
        const errors: Refusal[] = [];
        const today = addisDay();
        const need = (path: string, value: string | undefined, key: Words) => {
            if (!value?.trim()) errors.push({ path, code: 'required', message: say(key) });
        };
        need('transferDocumentNumber', input.transferDocumentNumber, 'competency.rule.arrivalDocumentNumber');
        need('issuingRegion', input.issuingRegion, 'competency.rule.arrivalIssuingRegion');
        need('issuingOffice', input.issuingOffice, 'competency.rule.arrivalIssuingOffice');
        // a number or a region of separators only folds to nothing: it names no document
        if (input.transferDocumentNumber.trim() && !arrivalKey(input.transferDocumentNumber))
            errors.push({
                path: 'transferDocumentNumber',
                code: 'required',
                message: say('competency.rule.arrivalDocumentNumber')
            });
        if (input.issuingRegion.trim() && !arrivalKey(input.issuingRegion))
            errors.push({
                path: 'issuingRegion',
                code: 'required',
                message: say('competency.rule.arrivalIssuingRegion')
            });
        if (input.documentDate > today)
            errors.push({ path: 'documentDate', code: 'in_future', message: say('competency.rule.notInFuture') });
        else if (input.documentValidUntil < input.documentDate)
            errors.push({
                path: 'documentValidUntil',
                code: 'before_date',
                message: say('competency.rule.arrivalDocumentValidity')
            });
        else if (input.documentValidUntil < filedOn)
            errors.push({
                path: 'documentValidUntil',
                code: 'lapsed',
                message: say('competency.rule.arrivalDocumentLapsed')
            });
        if (input.documentVerified !== true)
            errors.push({
                path: 'documentVerified',
                code: 'not_verified',
                message: say('competency.rule.arrivalNotVerified')
            });
        if (!(ARRIVAL_VERIFIED_HOW as readonly string[]).includes(input.verifiedHow))
            errors.push({
                path: 'verifiedHow',
                code: 'invalid',
                message: say('competency.rule.arrivalVerifiedHow')
            });
        if (errors.length > 0) refuse(errors);
    }

    // ---- filing ----

    /**
     * What makes a request acceptable, checked on the server: the document, a chassis and federal id the register does not know (a
     * vehicle of this region that left comes back by another path), the registration's strict checks, a plate no vehicle carries
     * that the region's plate rule agrees with, the libre, the dates, and no other open request for the same chassis or plate.
     * Nothing is written. What the case's facts froze at the filing (the day, the region's settings) is kept as it was.
     */
    async check(tx: Tx, place: CasePlace, input: TransferArrivalInput, facts: Facts = {}) {
        // the certificate is numbered from the office's counter when the vehicle is registered: an office with none finds out now
        await requireCounter(tx, REGISTRATION_CERTIFICATE_COUNTER, place.handlingUnitId);
        const earlier = factObject(facts, 'transferArrival');
        const filedOn = typeof earlier?.filedOn === 'string' ? earlier.filedOn : addisDay();
        this.checkDocument(input, filedOn);

        const vin = parseVin(input.chassisNumber, {
            ...(input.chassisKind === 'other' || input.chassisKind === 'iso3779'
                ? { chassisKind: input.chassisKind }
                : {}),
            modelYear: input.modelYear,
            acceptMismatch: input.chassisMismatchConfirmed ?? false
        });
        // two requests for one chassis, or one document, at the same moment: the second waits for the first's transaction
        if (vin.ok)
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.vehicle-registration:${vin.vinKey}`}, 0))`
            );
        const documentKey = arrivalKey(input.transferDocumentNumber);
        const issuingRegionKey = arrivalKey(input.issuingRegion);
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`competency.arrival-document:${issuingRegionKey}:${documentKey}`}, 0))`
        );
        if (
            await this.arrivals.ofDocument(tx, place.regionId, {
                issuingRegion: input.issuingRegion,
                number: input.transferDocumentNumber
            })
        )
            refuse([
                {
                    path: 'transferDocumentNumber',
                    code: 'duplicate',
                    message: say('competency.rule.arrivalDocumentUsed')
                }
            ]);

        const federal = input.federalVehicleId?.trim();
        const libre = input.libreNumber?.trim() ? libreKey(input.libreNumber) : undefined;
        // the libre and the federal id, too, name one vehicle: an open arrival with the same document, libre or federal id refuses this one
        if (libre)
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.arrival-libre:${libre}`}, 0))`
            );
        if (federal)
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.arrival-federal:${federal.toUpperCase()}`}, 0))`
            );
        if (
            await arrivalClaimedElsewhere(tx, place.caseId, {
                issuingRegionKey,
                documentKey,
                ...(libre ? { libreKey: libre } : {}),
                ...(federal ? { federalId: federal.toUpperCase() } : {})
            })
        )
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.arrivalDocumentInOpenCase'),
                detailKey: 'competency.rule.arrivalDocumentInOpenCase'
            });
        if (federal) {
            const parsed = federalVehicleIdSchema.safeParse(federal);
            if (!parsed.success)
                refuse(
                    parsed.error.issues.map((i) => ({ path: 'federalVehicleId', code: 'invalid', message: i.message }))
                );
        }
        await this.checkNotKnown(tx, place.regionId, vin.ok ? vin.vinKey : undefined, federal);

        const checked = await this.registry.checkRegistration(tx, place.ctx, this.registerInput(input, place.caseId));
        const plate = await plateOf(tx, this.vehicleRecords, input.plate);
        // two requests for one plate at the same moment (the back-capture takes the same lock)
        await lockPlate(tx, plate.key);
        await checkPlateFree(tx, this.stock, place.regionId, plate);

        // what the region asked for when the request was filed stands for the case, whatever its settings say later
        const exchangeSetting =
            typeof earlier?.exchangeSetting === 'boolean'
                ? earlier.exchangeSetting
                : (await this.settings.value<unknown>(
                      tx,
                      place.handlingUnitId,
                      VEHICLE_TRANSFER_PLATE_EXCHANGE_SETTING
                  )) !== false;
        const reinspect =
            typeof earlier?.reinspect === 'boolean'
                ? earlier.reinspect
                : (await this.settings.value<unknown>(tx, place.handlingUnitId, VEHICLE_TRANSFER_REINSPECT_SETTING)) ===
                  true;
        const plateExchange = plate.format === 'legacy' && exchangeSetting;
        // the fee's plate line follows the tick, so the tick must be what the rule says (fee inputs read answers only)
        if (plateExchange && input.takesNationalPlate !== true)
            refuse([
                {
                    path: 'takesNationalPlate',
                    code: 'must_take',
                    message: say('competency.rule.arrivalNationalPlate')
                }
            ]);
        if (!plateExchange && input.takesNationalPlate === true)
            refuse([
                {
                    path: 'takesNationalPlate',
                    code: 'keeps_plate',
                    message: say('competency.rule.arrivalKeepsPlate')
                }
            ]);

        if (!input.libreNumber?.trim())
            refuse([{ path: 'libreNumber', code: 'required', message: say('competency.rule.arrivalLibreRequired') }]);
        await checkLibreFree(tx, place.regionId, input.libreNumber);
        checkPaperDates(input);

        if (await claimedElsewhere(tx, place.caseId, { vinKey: checked.vinKey, plateKey: plate.key }))
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.arrivalInOpenCase'),
                detailKey: 'competency.rule.arrivalInOpenCase'
            });
        const notices = [
            ...(checked.vinCheck === 'mismatch' ? ['competency.notice.chassisMismatch'] : []),
            // a hold is recorded on its holder's letter, through the encumbrance service: the officer is told, nothing is made
            ...(input.holdsListed === true ? ['competency.notice.arrivalHoldsListed'] : [])
        ];
        return {
            transferArrival: {
                vinKey: checked.vinKey,
                chassisNumber: checked.chassisNumber,
                vinCheck: checked.vinCheck,
                plateKey: plate.key,
                plateFormat: plate.format,
                plateExchange,
                exchangeSetting,
                reinspect,
                filedOn,
                documentKey,
                issuingRegionKey,
                libreKey: libre,
                federalId: federal?.toUpperCase() ?? null,
                notices
            }
        };
    }

    /**
     * The chassis or the federal id is one the register already knows. An active vehicle is on the register; one transferred out is
     * a vehicle of this region that comes back (task 1.4c3b); one taken off or reported stolen is not registered again here.
     */
    private async checkNotKnown(tx: Tx, regionId: string, vinKey: string | undefined, federal: string | undefined) {
        if (vinKey === undefined && federal === undefined) return;
        const rows = await tx
            .select({
                id: vehicles.id,
                status: vehicles.status,
                vinKey: vehicles.vinKey,
                federalVehicleId: vehicles.federalVehicleId
            })
            .from(vehicles)
            .where(
                and(
                    eq(vehicles.regionId, regionId),
                    or(
                        vinKey === undefined ? undefined : eq(vehicles.vinKey, vinKey),
                        federal === undefined ? undefined : eq(vehicles.federalVehicleId, federal.toUpperCase())
                    )
                )
            );
        const byChassis = rows.find((r) => vinKey !== undefined && r.vinKey === vinKey);
        const byFederal = rows.find((r) => federal !== undefined && r.federalVehicleId === federal.toUpperCase());
        if (byChassis && byFederal && byChassis.id !== byFederal.id)
            refuse([
                {
                    path: 'federalVehicleId',
                    code: 'other_vehicle',
                    message: say('competency.rule.arrivalFederalIdOther')
                }
            ]);
        const known = byChassis ?? byFederal;
        if (!known) return;
        const path = byChassis ? 'chassisNumber' : 'federalVehicleId';
        const KEYS = {
            active: 'competency.rule.arrivalOnRegister',
            transferred_out: 'competency.rule.arrivalReturning',
            deregistered: 'competency.rule.arrivalNotReturnable',
            stolen: 'competency.rule.arrivalStolen'
        } as const satisfies Record<string, Words>;
        refuse([{ path, code: known.status, message: say(KEYS[known.status]) }]);
    }

    // ---- the registration ----

    /**
     * The vehicle joins the register on its document, handled by the office the case is in: its owners from the day the document
     * gives, acquired by transfer in, the plate it arrived on, the federal libre they hold and the document as it was checked. Run
     * again it returns what the case made.
     */
    async register(tx: Tx, at: CasePlace, facts: Facts, input: TransferArrivalInput) {
        // the register records the acting unit as the vehicle's handling office: the office, or the one above it the step was sent up to
        const place = await actForHandlingOffice(tx, at);
        const made = await this.arrivals.ofCase(tx, place.caseId);
        if (made) return this.madeBy(tx, place.caseId, made.vehicleId, made.id);
        const frozen = factObject(facts, 'transferArrival');
        if (typeof frozen?.filedOn !== 'string') throw missingFact('transferArrival');
        const plate = await plateOf(tx, this.vehicleRecords, input.plate);
        const vehicle = await this.registry.register(tx, place.ctx, this.registerInput(input, place.caseId));
        await this.registry.recordPlate(tx, place.ctx, vehicle.id, {
            text: plate.text,
            source: plate.format === 'legacy' ? 'legacy' : 'manual',
            since: input.firstRegisteredOn
        });
        await this.registry.recordLibre(tx, place.ctx, vehicle.id, {
            number: libreKey(input.libreNumber),
            issuedOn: input.libreIssuedOn,
            caseId: place.caseId
        });
        const arrival = await this.arrivals.record(tx, place.ctx, {
            vehicleId: vehicle.id,
            caseId: place.caseId,
            documentNumber: input.transferDocumentNumber,
            issuingRegion: input.issuingRegion,
            issuingOffice: input.issuingOffice,
            documentDate: input.documentDate,
            validUntil: input.documentValidUntil,
            verifiedHow: input.verifiedHow as (typeof ARRIVAL_VERIFIED_HOW)[number],
            arrivedOn: addisDay(),
            carriedPlateText: plate.text,
            carriedPlateKey: plate.key,
            ...(input.boloValidUntil ? { boloValidUntil: input.boloValidUntil } : {}),
            holdsListed: input.holdsListed === true,
            ...(input.holdsListed === true && input.holdsNote?.trim() ? { holdsNote: input.holdsNote.trim() } : {})
        });
        return this.madeBy(tx, place.caseId, vehicle.id, arrival.id);
    }

    /** What the case made, as facts: the vehicle, its libre and the arrival's record. */
    private async madeBy(tx: Tx, caseId: string, vehicleId: string, arrivalId: string) {
        const [libre] = await tx
            .select({ id: libres.id, number: libres.number })
            .from(libres)
            .where(and(eq(libres.vehicleId, vehicleId), eq(libres.caseId, caseId)));
        if (!libre) throw missingFact('libre');
        return {
            vehicle: { id: vehicleId },
            libre: { id: libre.id, number: libre.number },
            arrival: { id: arrivalId }
        };
    }

    /**
     * The registration certificate: this office numbers it from its own counter, as the registration's temporary libre. Issued after
     * the plate, so that it names the plate the vehicle carries now. Run again it returns what it issued.
     */
    async issueCertificate(tx: Tx, at: CasePlace, facts: Facts, answers: unknown = {}) {
        const place = await actForHandlingOffice(tx, at);
        // the plate step's answer is read only when a plate is exchanged: one given for a vehicle that keeps its plate is not dropped silently
        const given = nationalEntrySchema.safeParse(answers ?? {});
        if (
            factObject(facts, 'transferArrival')?.plateExchange === false &&
            given.success &&
            given.data.replacementPlate
        )
            refuse([
                {
                    path: 'replacementPlate',
                    code: 'not_exchanged',
                    message: say('competency.rule.arrivalNoPlateExchange')
                }
            ]);
        const libreId = factObject(facts, 'libre')?.id;
        if (typeof libreId !== 'string') throw missingFact('libre');
        const [libre] = await tx.select().from(libres).where(eq(libres.id, libreId));
        if (!libre) throw missingFact('libre');
        const issued = await this.registration.issueCertificate(tx, place, libre, REGISTRATION_CERTIFICATE_TEMPLATE);
        const known = factObject(facts, 'documents') ?? {};
        return { documents: { ...known, [REGISTRATION_CERTIFICATE_TEMPLATE]: issued.id } };
    }
}
