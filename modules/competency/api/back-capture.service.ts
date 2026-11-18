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
import { PlateStock, vehicles, VehicleRegistry, VehiclesService } from '@itrms/vehicles/api';
import { federalVehicleIdSchema, parseVin, type vehicleRegisterSchema } from '@itrms/vehicles/contracts';
import { cases } from '@itrms/workflow/api';
import { z } from 'zod';

import am from '../messages/am.json';
import en from '../messages/en.json';
import { actForHandlingOffice, claimedElsewhere } from './handling-office';
import type { CasePlace } from './licences.service';
import { MigrationSamplingService } from './migration-sampling.service';
import { checkLibreFree, checkPaperDates, checkPlateFree, libreKey, plateOf, refuse } from './paper-records';
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
    /** the scan of the paper file, as the request's file field holds it (every page is kept on a drawn sample, in order) */
    paperFileScan?: unknown;
};

/** The files of a request's file field, as the form engine stores an answer of it. */
const scanFiles = z.array(z.looseObject({ file_id: z.uuid() }));
/** The most pages a drawn sample keeps (the table's check says the same). */
const MAX_SCAN_PAGES = 20;

/**
 * Where a capture is checked: a case's place, or a sheet's row (task 1.13b), which has no case of its own. The office is the
 * capturing office.
 */
export type CapturePlace = Omit<CasePlace, 'caseId'> & { caseId: string | null };

/** How the vehicle came from paper: a case verified by its second person, or a sheet's row committed by its own. */
export type PaperOrigin =
    | { source: 'back_capture'; caseId: string; verifiedBy?: string }
    | { source: 'import'; importRowId: string; importId: string; importName: string; verifiedBy?: string };

/**
 * An id a check needs the shape of and never writes: the owner of a sheet's row that the commit will make, and the row a dry run's
 * check stands for.
 */
export const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

@Injectable()
export class BackCaptureService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(PlateStock) private readonly stock: PlateStock,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService,
        @Inject(MigrationSamplingService) private readonly sampling: MigrationSamplingService
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
                ...(origin.source === 'back_capture'
                    ? { caseId: origin.caseId }
                    : { importRowId: origin.importRowId, importId: origin.importId, importName: origin.importName }),
                ...(origin.verifiedBy ? { verifiedBy: origin.verifiedBy } : {})
            }
        };
    }

    /** The origin a check stands for: the case, or a row (whose id the check does not need). */
    private originOf(place: CapturePlace): PaperOrigin {
        return place.caseId
            ? { source: 'back_capture', caseId: place.caseId }
            : { source: 'import', importRowId: PLACEHOLDER_ID, importId: PLACEHOLDER_ID, importName: 'sheet' };
    }

    // ---- filing ----

    /**
     * What makes a capture acceptable, checked on the server: the register's own checks in back-capture mode (category, chassis
     * number, owners; the chassis not on the register already), the file's dates, a plate no vehicle carries, a federal id no
     * vehicle has, and no other open request for the same chassis or plate. Nothing is written. A sheet's row whose owner the
     * commit will make (`ownersToBeMade`) is checked without its owner, which is not on the register yet.
     */
    async check(tx: Tx, place: CapturePlace, input: BackCaptureInput, options: { ownersToBeMade?: boolean } = {}) {
        checkPaperDates(input);
        const plate = await plateOf(tx, this.vehicles, input.plate);
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

        await checkPlateFree(tx, this.stock, place.regionId, plate);
        await checkLibreFree(tx, place.regionId, input.libreNumber);
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
        const clerk = await this.mayVerify(tx, place, verifier);
        const captured = await this.put(tx, place, input, {
            source: 'back_capture',
            caseId: place.caseId,
            verifiedBy: verifier
        });
        // sampling QA (task 1.13g): the record counts to the clerk who captured it, and may be drawn for a re-check
        const scan = scanFiles.safeParse(input.paperFileScan);
        await this.sampling.count(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            vehicleId: captured.vehicle.id,
            origin: { source: 'back_capture', caseId: place.caseId },
            clerkId: clerk,
            verifierId: verifier,
            scanFileIds: scan.success ? [...new Set(scan.data.map((f) => f.file_id))].slice(0, MAX_SCAN_PAGES) : []
        });
        return captured;
    }

    /**
     * A sheet's committed row (task 1.13b): the vehicle joins the register as the capture's does, migrated by import (its row, its
     * paper reference and the second person who committed the sheet). The importer has checked the row again in this transaction.
     */
    async importRow(
        tx: Tx,
        place: CapturePlace,
        input: BackCaptureInput,
        row: {
            id: string;
            committedBy: string;
            clerkId: string;
            scanFileId: string | null;
            batch: { id: string; name: string };
        }
    ) {
        const made = await this.put(tx, place, input, {
            source: 'import',
            importRowId: row.id,
            importId: row.batch.id,
            importName: row.batch.name,
            verifiedBy: row.committedBy
        });
        // sampling QA (task 1.13g): the row counts to the clerk who sent the sheet
        await this.sampling.count(tx, {
            regionId: place.regionId,
            handlingUnitId: place.handlingUnitId,
            vehicleId: made.vehicle.id,
            origin: { source: 'import', importRowId: row.id },
            clerkId: row.clerkId,
            verifierId: row.committedBy,
            scanFileIds: row.scanFileId ? [row.scanFileId] : []
        });
        return made;
    }

    /** Puts the file's vehicle on the register, with the plate it carries and the libre its owners hold. */
    private async put(tx: Tx, place: CapturePlace, input: BackCaptureInput, origin: PaperOrigin) {
        checkPaperDates(input);
        const plate = await plateOf(tx, this.vehicles, input.plate);
        await checkLibreFree(tx, place.regionId, input.libreNumber);
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
    private async mayVerify(tx: Tx, place: CasePlace, verifier: string): Promise<string> {
        const [kase] = await tx.select({ startedBy: cases.startedBy }).from(cases).where(eq(cases.id, place.caseId));
        // a case the acting office cannot see (RLS: not its own or below it) is not one it may verify
        if (!kase) throw new ForbiddenError({ detailKey: 'competency.errors.act_from_handling_office' });
        if (kase.startedBy === verifier)
            throw new ForbiddenError({ detailKey: 'competency.errors.verify_own_capture' });
        await actForHandlingOffice(tx, place);
        return kase.startedBy;
    }
}
