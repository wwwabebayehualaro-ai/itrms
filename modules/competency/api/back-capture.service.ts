/**
 * The back-capture of a paper vehicle file, MIG-01 (ADR-0054, task 1.13): what a capture must meet, and the step that puts the
 * vehicle on the register once a second person has verified it against the paper. The paper file's facts are taken in back-capture
 * mode: its original dates, the plate the vehicle carries and the libre it holds, as the file records them; what the file does not
 * give stays missing. The register's commands are the vehicles slice's; the effects are thin over this.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ForbiddenError, ValidationError } from '@itrms/kernel/errors';
import { stationeryItems } from '@itrms/fees/api';
import { parseStationeryKey } from '@itrms/fees/contracts';
import { libres, PlateStock, plateAssignments, vehicles, VehicleRegistry, VehiclesService } from '@itrms/vehicles/api';
import { federalVehicleIdSchema, parsePlate, parseVin, type vehicleRegisterSchema } from '@itrms/vehicles/contracts';
import { cases } from '@itrms/workflow/api';
import type { z } from 'zod';

import { addisDay } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { actForHandlingOffice, claimedElsewhere } from './handling-office';
import type { CasePlace } from './licences.service';
import { VehicleRegistrationService, type RegistrationInput } from './registration.service';

type Words = keyof typeof am;
type RegisterInput = z.input<typeof vehicleRegisterSchema>;

/** A refusal in the language of the person acting: this is what they read at the desk. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

/** The capture's answers an effect reads, by contract path (see back-capture.effects.ts): the vehicle's, and the paper file's. */
export type BackCaptureInput = RegistrationInput & {
    /** the paper file's own reference, as it is shelved */
    paperReference: string;
    /** the day the vehicle was first registered, from the file (Gregorian, entered in the Ethiopian calendar) */
    firstRegisteredOn: string;
    /** the day the current owners took it, when the file says (default: the first registration) */
    ownersSince?: string;
    federalVehicleId?: string;
    /** the plate the vehicle carries: an old regional plate or a national one */
    plate: string;
    plateSince?: string;
    /** the libre the current owners hold: its booklet's serial and the day it was issued */
    libreNumber?: string;
    libreIssuedOn?: string;
};

type Refusal = { path: string; code: string; message: string };

/**
 * Where a capture is checked: a case's place, or a sheet's row (task 1.13b), which has no case of its own. The office is the
 * capturing office.
 */
export type CapturePlace = Omit<CasePlace, 'caseId'> & { caseId: string | null };

/** How the vehicle came from paper: a case verified by its second person, or a sheet's row committed by its own. */
export type PaperOrigin =
    | { source: 'back_capture'; caseId: string; verifiedBy?: string }
    | { source: 'import'; importRowId: string; verifiedBy?: string };

/**
 * An id a check needs the shape of and never writes: the owner of a sheet's row that the commit will make, and the row a dry run's
 * check stands for.
 */
export const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

const refuse = (errors: Refusal[]): never => {
    throw new ValidationError('validation_failed', { errors });
};

/** A libre number as the register keeps it: a booklet serial folded (upper case, no spaces or hyphens), anything else trimmed. */
const libreKey = (text: string): string => parseStationeryKey(text)?.key ?? text.trim();

@Injectable()
export class BackCaptureService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(PlateStock) private readonly stock: PlateStock,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService
    ) {}

    /** The register's command for the capture, in back-capture mode. `verifiedBy` only when the second person verifies. */
    private registerInput(input: BackCaptureInput, origin: PaperOrigin): RegisterInput {
        const federal = input.federalVehicleId?.trim();
        return {
            ...this.registration.registerInput(input, { firstRegisteredOn: input.firstRegisteredOn }),
            ...(federal ? { federalVehicleId: federal, federalIdSource: 'manual' as const } : {}),
            since: input.ownersSince ?? input.firstRegisteredOn,
            acquiredBy: 'back_capture',
            ...(origin.source === 'back_capture' ? { caseId: origin.caseId } : {}),
            migration: {
                source: origin.source,
                paperReference: input.paperReference.trim(),
                ...(origin.source === 'back_capture' ? { caseId: origin.caseId } : { importRowId: origin.importRowId }),
                ...(origin.verifiedBy ? { verifiedBy: origin.verifiedBy } : {})
            }
        };
    }

    /** The origin a check stands for: the case, or a row (whose id the check does not need). */
    private originOf(place: CapturePlace): PaperOrigin {
        return place.caseId
            ? { source: 'back_capture', caseId: place.caseId }
            : { source: 'import', importRowId: PLACEHOLDER_ID };
    }

    /** The dates of the file, in order: none in the future, none before the first registration, the libre not before its owners. */
    private checkDates(input: BackCaptureInput): void {
        const today = addisDay();
        const first = input.firstRegisteredOn;
        const errors: Refusal[] = [];
        const dates: [string, string | undefined][] = [
            ['firstRegisteredOn', first],
            ['ownersSince', input.ownersSince],
            ['plateSince', input.plateSince],
            ['libreIssuedOn', input.libreIssuedOn]
        ];
        for (const [path, day] of dates) {
            if (day === undefined) continue;
            if (day > today) errors.push({ path, code: 'in_future', message: say('competency.rule.notInFuture') });
            else if (day < first)
                errors.push({
                    path,
                    code: 'before_registration',
                    message: say('competency.rule.beforeFirstRegistration')
                });
        }
        const owners = input.ownersSince ?? first;
        if (input.libreIssuedOn !== undefined && input.libreIssuedOn >= first && input.libreIssuedOn < owners)
            errors.push({
                path: 'libreIssuedOn',
                code: 'before_period',
                message: say('competency.rule.libreBeforeOwners')
            });
        if (input.libreNumber && input.libreIssuedOn === undefined)
            errors.push({ path: 'libreIssuedOn', code: 'required', message: say('competency.rule.libreIssuedOn') });
        if (errors.length > 0) refuse(errors);
    }

    /** The plate the file records, read with the region's old plate codes; refused at its field when it is no plate. */
    private async plateOf(tx: Tx, text: string) {
        const parsed = parsePlate(text, await this.vehicles.legacyRegions(tx));
        if (!parsed) refuse([{ path: 'plate', code: 'invalid_plate', message: say('competency.rule.notAnyPlate') }]);
        return parsed as NonNullable<typeof parsed>;
    }

    // ---- filing ----

    /**
     * What makes a capture acceptable, checked on the server: the register's own checks in back-capture mode (category, chassis
     * number, owners; the chassis not on the register already), the file's dates, a plate no vehicle carries, a federal id no
     * vehicle has, and no other open request for the same chassis or plate. Nothing is written. A sheet's row whose owner the
     * commit will make (`ownersToBeMade`) is checked without its owner, which is not on the register yet.
     */
    async check(tx: Tx, place: CapturePlace, input: BackCaptureInput, options: { ownersToBeMade?: boolean } = {}) {
        this.checkDates(input);
        const plate = await this.plateOf(tx, input.plate);
        const federal = input.federalVehicleId?.trim();
        if (federal) {
            const parsed = federalVehicleIdSchema.safeParse(federal);
            if (!parsed.success)
                refuse(
                    parsed.error.issues.map((i) => ({ path: 'federalVehicleId', code: 'invalid', message: i.message }))
                );
        }
        const vin = parseVin(input.chassisNumber, {
            ...(input.chassisKind === 'other' || input.chassisKind === 'iso3779'
                ? { chassisKind: input.chassisKind }
                : {}),
            modelYear: input.modelYear,
            acceptMismatch: true
        });
        // two captures of one file at the same moment: the second waits for the first's transaction, then sees its facts
        if (vin.ok)
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`competency.vehicle-registration:${vin.vinKey}`}, 0))`
            );
        // and two captures of one plate
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`competency.back-capture:${plate.key}`}, 0))`
        );
        const checked = await this.registry.checkRegistration(
            tx,
            place.ctx,
            this.registerInput(input, this.originOf(place)),
            {
                checkOwners: options.ownersToBeMade !== true
            }
        );

        // a plate another vehicle of the register carries, or carried and gave up (an old plate is never handed out again)
        const [carried] = await tx
            .select({ until: plateAssignments.until })
            .from(plateAssignments)
            .where(and(eq(plateAssignments.regionId, place.regionId), eq(plateAssignments.plateKey, plate.key)))
            .orderBy(sql`${plateAssignments.until} is null desc`)
            .limit(1);
        if (carried)
            refuse([
                carried.until === null
                    ? { path: 'plate', code: 'duplicate', message: say('competency.rule.plateOnRegister') }
                    : { path: 'plate', code: 'plate_ended', message: say('competency.rule.plateEnded') }
            ]);
        // a national plate still in the stock was never handed over: it is issued from the stock, not captured
        if (plate.format === 'national' && (await this.stock.inStock(tx, place.regionId, plate.key)))
            refuse([{ path: 'plate', code: 'in_stock', message: say('competency.rule.plateInStock') }]);
        await this.checkLibre(tx, place, input);
        if (federal) {
            const [holder] = await tx
                .select({ id: vehicles.id })
                .from(vehicles)
                .where(
                    and(eq(vehicles.regionId, place.regionId), eq(vehicles.federalVehicleId, federal.toUpperCase()))
                );
            if (holder)
                refuse([
                    { path: 'federalVehicleId', code: 'duplicate', message: say('competency.rule.federalIdOnRegister') }
                ]);
        }
        // the vehicle is made only when the capture is verified: an open registration or capture of the same chassis or plate,
        // anywhere in the region (task 1.2e), would otherwise both get there
        if (await claimedElsewhere(tx, place.caseId, { vinKey: checked.vinKey, plateKey: plate.key }))
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.captureInOpenCase'),
                detailKey: 'competency.rule.captureInOpenCase'
            });
        return {
            backCapture: {
                vinKey: checked.vinKey,
                chassisNumber: checked.chassisNumber,
                vinCheck: checked.vinCheck,
                plateKey: plate.key,
                paperReference: input.paperReference.trim()
            }
        };
    }

    // ---- the verification ----

    /**
     * The second person checked the capture against the paper file: the vehicle joins the register, handled by the capturing office, as
     * migrated (its source, the paper reference, this case and the verifier), with its current owners from the day the file says,
     * the plate it carries and the libre they hold. Run again it returns the vehicle it made.
     */
    async capture(tx: Tx, place: CasePlace, input: BackCaptureInput) {
        const [made] = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(eq(vehicles.migrationCaseId, place.caseId));
        if (made) return { vehicle: { id: made.id } };
        const verifier = place.ctx.userId;
        if (!verifier) throw new ForbiddenError();
        await this.mayVerify(tx, place, verifier);
        return this.put(tx, place, input, { source: 'back_capture', caseId: place.caseId, verifiedBy: verifier });
    }

    /**
     * A sheet's committed row (task 1.13b): the vehicle joins the register as the capture's does, migrated by import (its row, its
     * paper reference and the second person who committed the sheet). The importer has checked the row again in this transaction.
     */
    async importRow(tx: Tx, place: CapturePlace, input: BackCaptureInput, row: { id: string; committedBy: string }) {
        return this.put(tx, place, input, { source: 'import', importRowId: row.id, verifiedBy: row.committedBy });
    }

    /** Puts the file's vehicle on the register, with the plate it carries and the libre its owners hold. */
    private async put(tx: Tx, place: CapturePlace, input: BackCaptureInput, origin: PaperOrigin) {
        this.checkDates(input);
        const plate = await this.plateOf(tx, input.plate);
        await this.checkLibre(tx, place, input);
        // the vehicle is the capturing office's, whoever verified it: the office's own officer, or the one above it when separation
        // of duties sent the step up (SEC-AC-6)
        const ctx = { ...place.ctx, unitId: place.handlingUnitId };
        const vehicle = await this.registry.register(tx, ctx, this.registerInput(input, origin));
        await this.registry.recordPlate(tx, ctx, vehicle.id, {
            text: plate.text,
            source: plate.format === 'legacy' ? 'legacy' : 'manual',
            since: input.plateSince ?? input.firstRegisteredOn
        });
        if (input.libreNumber?.trim())
            await this.registry.recordLibre(tx, ctx, vehicle.id, {
                number: libreKey(input.libreNumber),
                issuedOn: input.libreIssuedOn ?? input.ownersSince ?? input.firstRegisteredOn,
                ...(place.caseId ? { caseId: place.caseId } : {})
            });
        return { vehicle: { id: vehicle.id } };
    }

    /**
     * Who may verify: someone of the capturing office or an office above it, and never the person who captured the file. The seeded
     * workflow already keeps the capturer off the step; this holds whatever workflow a bureau publishes (ADR-0054, SEC-AC-6).
     */
    private async mayVerify(tx: Tx, place: CasePlace, verifier: string): Promise<void> {
        const [kase] = await tx.select({ startedBy: cases.startedBy }).from(cases).where(eq(cases.id, place.caseId));
        // a case the acting office cannot see (RLS: not its own or below it) is not one it may verify
        if (!kase) throw new ForbiddenError({ detailKey: 'competency.errors.act_from_handling_office' });
        if (kase.startedBy === verifier)
            throw new ForbiddenError({ detailKey: 'competency.errors.verify_own_capture' });
        await actForHandlingOffice(tx, place);
    }

    /**
     * The libre the file records: a booklet serial is kept folded, never one of the stationery's own booklets (those are issued
     * from the stock, not captured), and no other vehicle's libre has it.
     */
    private async checkLibre(tx: Tx, place: CapturePlace, input: BackCaptureInput): Promise<void> {
        const given = input.libreNumber?.trim();
        if (!given) return;
        const parsed = parseStationeryKey(given);
        if (parsed) {
            const [booklet] = await tx
                .select({ id: stationeryItems.id })
                .from(stationeryItems)
                .where(
                    and(
                        eq(stationeryItems.regionId, place.regionId),
                        eq(stationeryItems.kind, 'libre_booklet'),
                        eq(stationeryItems.series, parsed.series),
                        eq(stationeryItems.serial, parsed.serial)
                    )
                )
                .limit(1);
            if (booklet)
                refuse([{ path: 'libreNumber', code: 'in_stock', message: say('competency.rule.libreInStock') }]);
        }
        const [held] = await tx
            .select({ id: libres.id })
            .from(libres)
            .where(and(eq(libres.regionId, place.regionId), eq(libres.number, libreKey(given))))
            .limit(1);
        if (held) refuse([{ path: 'libreNumber', code: 'duplicate', message: say('competency.rule.libreOnRegister') }]);
    }
}
