/**
 * A vehicle arriving from another region, DVC-17 (task 1.4c3, ADR-0060): what the request must meet, and the steps that put the
 * vehicle on the register on the vehicle data transfer document its owner brought. The register is the vehicles slice's and the
 * registration's strict checks apply (the paper facts of a back-capture are not accepted here); the document is checked by the
 * officer, never fetched. The vehicle that once left this region comes back through its own record (task 1.4c3b); any other chassis
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
import {
    libres,
    PlateStock,
    vehicles,
    VehicleArrivals,
    VehicleHandovers,
    vehicleHandovers,
    VehicleRegistry,
    VehiclesService
} from '@itrms/vehicles/api';
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
import { actForHandlingOffice, arrivalClaimedElsewhere, claimedElsewhere, lockVehicleClaim } from './handling-office';
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
/** A vehicle of this region the chassis or the federal id names. */
type KnownVehicle = Pick<typeof vehicles.$inferSelect, 'id' | 'status' | 'vinKey' | 'federalVehicleId'>;

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
        @Inject(VehicleHandovers) private readonly handovers: VehicleHandovers,
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
     * What makes a request acceptable, checked on the server: the document, a chassis and federal id the register does not know (or
     * the vehicle of this region that left, which comes back on its own record), the registration's strict checks, a plate no vehicle carries
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
        const known = await this.checkNotKnown(tx, place.regionId, vin.ok ? vin.vinKey : undefined, federal);
        if (known) await lockVehicleClaim(tx, known.id);
        const given = this.registerInput(input, place.caseId);
        const returning = known ? await this.checkReturning(tx, known, given.owners, input, federal) : undefined;

        const checked = await this.registry.checkRegistration(
            tx,
            place.ctx,
            given,
            known ? { returning: known.id } : {}
        );
        const plate = await plateOf(tx, this.vehicleRecords, input.plate);
        // two requests for one plate at the same moment (the back-capture takes the same lock)
        await lockPlate(tx, plate.key);
        // the plate the vehicle left with changes nothing; another region's is recorded; one of its own past is not taken back
        let plateOnReturn: 'same' | 'new' | undefined;
        if (returning) {
            if (plate.key === returning.state.currentPlateKey) plateOnReturn = 'same';
            else if (returning.state.platesEver.includes(plate.key))
                refuse([
                    {
                        path: 'plate',
                        code: 'plate_history',
                        message: say('competency.rule.arrivalPlateFromHistory')
                    }
                ]);
            else plateOnReturn = 'new';
        }
        if (plateOnReturn !== 'same') await checkPlateFree(tx, this.stock, place.regionId, plate);

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
        // the libre the owner brings is the one in force already when it is the same booklet for the same owners: nothing to record
        const sameLibre = returning?.state.libreInForce?.number === libreKey(input.libreNumber);
        if (!(returning && sameLibre && returning.sameOwners))
            await checkLibreFree(tx, place.regionId, input.libreNumber);
        checkPaperDates(input);
        if (returning && !(sameLibre && returning.sameOwners)) {
            // the libre is for the owners of the period it is recorded in: the one on the register, or the one this arrival opens
            const from = returning.sameOwners ? returning.state.openPeriod?.since : input.ownersSince;
            if (from !== undefined && input.libreIssuedOn < from)
                refuse([
                    {
                        path: 'libreIssuedOn',
                        code: 'before_period',
                        message: say('competency.rule.libreBeforeOwners')
                    }
                ]);
        }

        if (
            await claimedElsewhere(tx, place.caseId, {
                vinKey: checked.vinKey,
                plateKey: plate.key,
                ...(known ? { vehicleId: known.id } : {})
            })
        )
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.arrivalInOpenCase'),
                detailKey: 'competency.rule.arrivalInOpenCase'
            });
        const notices = [
            ...(checked.vinCheck === 'mismatch' ? ['competency.notice.chassisMismatch'] : []),
            // a hold is recorded on its holder's letter, through the encumbrance service: the officer is told, nothing is made
            ...(input.holdsListed === true ? ['competency.notice.arrivalHoldsListed'] : []),
            ...(returning ? returning.notices : [])
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
                ...(known && returning && plateOnReturn
                    ? {
                          // the vehicle that left this region comes back on its own record (task 1.4c3b)
                          returning: {
                              vehicleId: known.id,
                              handoverId: returning.handoverId,
                              releasedOn: returning.releasedOn,
                              ownersChanged: !returning.sameOwners,
                              plate: plateOnReturn
                          }
                      }
                    : {}),
                notices
            }
        };
    }

    /**
     * The vehicle of this region that left it and comes back (task 1.4c3b, ADR-0060). Refused while this region's own release outside
     * still stands (its owner cancels it at the releasing office, DVC-16) and when no owners are on record for it (it left before
     * ADR-0058 kept them); owners other than the register's need the day they took it, after the day the register's began. What the
     * document says of the vehicle that differs from the register, and a hold the register still carries, are notices: nothing of the
     * register is changed by the document.
     */
    private async checkReturning(
        tx: Tx,
        known: KnownVehicle,
        owners: RegisterInput['owners'],
        input: TransferArrivalInput,
        federal: string | undefined
    ) {
        const path = federal && known.federalVehicleId === federal.toUpperCase() ? 'federalVehicleId' : 'chassisNumber';
        const standing = await this.handovers.standing(tx, known.id);
        if (standing && standing.validUntil >= addisDay())
            refuse([{ path, code: 'release_standing', message: say('competency.rule.arrivalReleaseStanding') }]);
        const state = await this.registry.checkReturn(tx, known.id, owners);
        if (!state.openPeriod)
            refuse([{ path, code: 'no_owners_on_record', message: say('competency.rule.arrivalNoOwnersOnRecord') }]);
        // ADR-0058: a vehicle transferred out has the release it left on; with none there is nothing to come back on
        if (!standing) return refuse([{ path, code: 'no_release', message: say('competency.rule.arrivalNoRelease') }]);
        if (!state.sameOwners) {
            const since = input.ownersSince;
            if (!since || since > addisDay() || since <= (state.openPeriod?.since ?? ''))
                refuse([
                    { path: 'ownersSince', code: 'before_period', message: say('competency.rule.arrivalOwnersSince') }
                ]);
            // the register's owners held it until it left: new owners cannot have taken it before that day
            else if (since < standing.releasedOn)
                refuse([
                    {
                        path: 'ownersSince',
                        code: 'before_departure',
                        message: say('competency.rule.arrivalOwnersBeforeDeparture')
                    }
                ]);
        }
        const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        const differs =
            !same(state.vehicle.make, input.make) ||
            !same(state.vehicle.model, input.model) ||
            state.vehicle.modelYear !== input.modelYear ||
            state.vehicle.use !== input.use;
        return {
            state,
            sameOwners: state.sameOwners,
            handoverId: standing.id,
            releasedOn: standing.releasedOn,
            notices: [
                'competency.notice.arrivalReturning',
                ...(differs ? ['competency.notice.arrivalFactsDiffer'] : []),
                ...(state.openHolds > 0 ? ['competency.notice.arrivalReturningHolds'] : [])
            ]
        };
    }

    /**
     * The chassis or the federal id is one the register already knows. An active vehicle is on the register; one taken off or reported
     * stolen is not registered again here; one transferred out is a vehicle of this region that comes back (task 1.4c3b): it is
     * returned, and it must be the vehicle both the chassis and the federal id name.
     */
    private async checkNotKnown(
        tx: Tx,
        regionId: string,
        vinKey: string | undefined,
        federal: string | undefined
    ): Promise<KnownVehicle | undefined> {
        if (vinKey === undefined && federal === undefined) return undefined;
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
        if (!known) return undefined;
        const path = byChassis ? 'chassisNumber' : 'federalVehicleId';
        if (known.status === 'transferred_out') {
            // the federal id alone names it, or the chassis names a vehicle with another federal id: not the vehicle the document says
            if (!byChassis || (federal !== undefined && known.federalVehicleId !== null && !byFederal))
                refuse([
                    {
                        path: 'federalVehicleId',
                        code: 'other_vehicle',
                        message: say('competency.rule.arrivalFederalIdOther')
                    }
                ]);
            return known;
        }
        const KEYS = {
            active: 'competency.rule.arrivalOnRegister',
            deregistered: 'competency.rule.arrivalNotReturnable',
            stolen: 'competency.rule.arrivalStolen'
        } as const satisfies Record<string, Words>;
        return refuse([{ path, code: known.status, message: say(KEYS[known.status]) }]);
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
        if (made) return this.madeBy(tx, place.caseId, made.vehicleId, made.id, made.returned);
        const frozen = factObject(facts, 'transferArrival');
        if (typeof frozen?.filedOn !== 'string') throw missingFact('transferArrival');
        const plate = await plateOf(tx, this.vehicleRecords, input.plate);
        const returning = factObject(frozen, 'returning');
        if (returning) return this.registerReturn(tx, place, returning, plate, input);
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
        return this.madeBy(tx, place.caseId, vehicle.id, arrival.id, false);
    }

    /**
     * The vehicle of this region that left it comes back on its own record (task 1.4c3b): the reviewed command brings it to the
     * case's office, then what the document says changes the register only where it must: other owners, another region's plate and
     * a libre other than the one in force are recorded, the same ones change nothing. The record is the vehicle's, so the arrival
     * is written for it with the release it came back on.
     */
    private async registerReturn(
        tx: Tx,
        place: CasePlace,
        returning: Record<string, unknown>,
        plate: Awaited<ReturnType<typeof plateOf>>,
        input: TransferArrivalInput
    ) {
        const vehicleId = returning.vehicleId;
        if (typeof vehicleId !== 'string') throw missingFact('transferArrival.returning');
        const handoverId = returning.handoverId;
        if (typeof handoverId !== 'string') throw missingFact('transferArrival.returning');
        // the day it left is read from the release itself, not from the facts: new owners cannot have taken it before then
        const [release] = await tx
            .select({ releasedOn: vehicleHandovers.releasedOn })
            .from(vehicleHandovers)
            .where(eq(vehicleHandovers.id, handoverId));
        if (!release) throw missingFact('transferArrival.returning');
        await this.arrivals.acceptReturn(tx, place.caseId);
        const given = this.registerInput(input, place.caseId);
        const moved = await this.registry.returnOwners(tx, place.ctx, vehicleId, {
            owners: given.owners,
            since: input.ownersSince ?? addisDay(),
            notBefore: release.releasedOn,
            caseId: place.caseId,
            ...(given.note ? { note: given.note } : {})
        });
        // the federal id the document gives, when the register has none: the national system's id is set once
        const federal = input.federalVehicleId?.trim();
        if (federal) {
            const [row] = await tx
                .select({ federalVehicleId: vehicles.federalVehicleId })
                .from(vehicles)
                .where(eq(vehicles.id, vehicleId));
            if (row?.federalVehicleId === null)
                await this.registry.recordFederalId(tx, place.ctx, vehicleId, federal.toUpperCase());
        }
        if (returning.plate === 'new')
            await this.registry.recordPlate(tx, place.ctx, vehicleId, {
                text: plate.text,
                source: plate.format === 'legacy' ? 'legacy' : 'manual',
                since: addisDay(),
                endedReason: 'transferred'
            });
        const number = libreKey(input.libreNumber);
        const [inForce] = await tx
            .select({ number: libres.number })
            .from(libres)
            .where(and(eq(libres.vehicleId, vehicleId), eq(libres.status, 'issued')));
        if (inForce?.number !== number)
            await this.registry.recordLibre(tx, place.ctx, vehicleId, {
                number,
                issuedOn: input.libreIssuedOn,
                caseId: place.caseId,
                ...(moved.cancelled ? { replacesId: moved.cancelled.id } : {})
            });
        const arrival = await this.arrivals.record(tx, place.ctx, {
            vehicleId,
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
            ...(input.holdsListed === true && input.holdsNote?.trim() ? { holdsNote: input.holdsNote.trim() } : {}),
            returned: true,
            handoverId
        });
        return this.madeBy(tx, place.caseId, vehicleId, arrival.id, true);
    }

    /** What the case made, as facts: the vehicle, its libre (a returning vehicle's, the one in force) and the arrival's record. */
    private async madeBy(tx: Tx, caseId: string, vehicleId: string, arrivalId: string, returned: boolean) {
        const [libre] = await tx
            .select({ id: libres.id, number: libres.number })
            .from(libres)
            .where(
                and(eq(libres.vehicleId, vehicleId), returned ? eq(libres.status, 'issued') : eq(libres.caseId, caseId))
            );
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
