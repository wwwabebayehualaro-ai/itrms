/**
 * The back-capture of a paper vehicle file, MIG-01 (ADR-0054, task 1.13): what a capture must meet, and the step that puts the
 * vehicle on the register once a second person has verified it against the paper. The paper file's facts are taken in back-capture
 * mode: its original dates, the plate the vehicle carries and the libre it holds, as the file records them; what the file does not
 * give stays missing. The register's commands are the vehicles slice's; the effects are thin over this.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ForbiddenError, ValidationError } from '@itrms/kernel/errors';
import { PlateStock, plateAssignments, vehicles, VehicleRegistry, VehiclesService } from '@itrms/vehicles/api';
import { federalVehicleIdSchema, parsePlate, parseVin, type vehicleRegisterSchema } from '@itrms/vehicles/contracts';
import { cases } from '@itrms/workflow/api';
import type { z } from 'zod';

import { addisDay } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
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

const refuse = (errors: Refusal[]): never => {
    throw new ValidationError('validation_failed', { errors });
};

@Injectable()
export class BackCaptureService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(PlateStock) private readonly stock: PlateStock,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService
    ) {}

    /** The register's command for the capture, in back-capture mode. `verifiedBy` only when the second person verifies. */
    private registerInput(place: CasePlace, input: BackCaptureInput, verifiedBy?: string): RegisterInput {
        const federal = input.federalVehicleId?.trim();
        return {
            ...this.registration.registerInput(input, { firstRegisteredOn: input.firstRegisteredOn }),
            ...(federal ? { federalVehicleId: federal, federalIdSource: 'manual' as const } : {}),
            since: input.ownersSince ?? input.firstRegisteredOn,
            acquiredBy: 'back_capture',
            caseId: place.caseId,
            migration: {
                source: 'back_capture',
                paperReference: input.paperReference.trim(),
                caseId: place.caseId,
                ...(verifiedBy ? { verifiedBy } : {})
            }
        };
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
     * vehicle has, and no other open request for the same chassis or plate. Nothing is written.
     */
    async check(tx: Tx, place: CasePlace, input: BackCaptureInput) {
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
        const checked = await this.registry.checkRegistration(tx, place.ctx, this.registerInput(place, input));

        const [carried] = await tx
            .select({ id: plateAssignments.id })
            .from(plateAssignments)
            .where(
                and(
                    eq(plateAssignments.regionId, place.regionId),
                    eq(plateAssignments.plateKey, plate.key),
                    isNull(plateAssignments.until)
                )
            );
        if (carried) refuse([{ path: 'plate', code: 'duplicate', message: say('competency.rule.plateOnRegister') }]);
        // a national plate still in the stock was never handed over: it is issued from the stock, not captured
        if (plate.format === 'national' && (await this.stock.inStock(tx, place.regionId, plate.key)))
            refuse([{ path: 'plate', code: 'in_stock', message: say('competency.rule.plateInStock') }]);
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
        // the vehicle is made only when the capture is verified: an open registration or capture of the same chassis or plate
        // would otherwise both get there
        const [other] = await tx
            .select({ id: cases.id })
            .from(cases)
            .where(
                and(
                    isNull(cases.closedAt),
                    ne(cases.id, place.caseId),
                    or(
                        sql`${cases.facts}#>>'{registration,vinKey}' = ${checked.vinKey}`,
                        sql`${cases.facts}#>>'{backCapture,vinKey}' = ${checked.vinKey}`,
                        sql`${cases.facts}#>>'{backCapture,plateKey}' = ${plate.key}`
                    )
                )
            )
            .limit(1);
        if (other)
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
     * The second person checked the capture against the paper file: the vehicle joins the register, handled by this office, as
     * migrated (its source, the paper reference, this case and the verifier), with its current owners from the day the file says,
     * the plate it carries and the libre they hold. Run again it returns the vehicle it made.
     */
    async capture(tx: Tx, place: CasePlace, input: BackCaptureInput) {
        if (place.ctx.unitId !== place.handlingUnitId)
            throw new ForbiddenError({ detailKey: 'competency.errors.act_from_handling_office' });
        const [made] = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(eq(vehicles.migrationCaseId, place.caseId));
        if (made) return { vehicle: { id: made.id } };
        const verifier = place.ctx.userId;
        if (!verifier) throw new ForbiddenError();
        this.checkDates(input);
        const plate = await this.plateOf(tx, input.plate);
        const vehicle = await this.registry.register(tx, place.ctx, this.registerInput(place, input, verifier));
        await this.registry.recordPlate(tx, place.ctx, vehicle.id, {
            text: plate.text,
            source: plate.format === 'legacy' ? 'legacy' : 'manual',
            since: input.plateSince ?? input.firstRegisteredOn
        });
        if (input.libreNumber?.trim())
            await this.registry.recordLibre(tx, place.ctx, vehicle.id, {
                number: input.libreNumber.trim(),
                issuedOn: input.libreIssuedOn ?? input.ownersSince ?? input.firstRegisteredOn,
                caseId: place.caseId
            });
        return { vehicle: { id: vehicle.id } };
    }
}
