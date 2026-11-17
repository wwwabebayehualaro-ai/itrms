/**
 * The transfer of a vehicle between two offices of the region (task 1.4c, DVC-14 and DVC-15, ADR-0057). The transfer out, filed
 * where the vehicle is handled, names the office it goes to and, paid and approved, releases it; the transfer in, filed there,
 * receives it, and the register's reviewed command moves the vehicle and its live records (VehicleHandovers). Each step checks
 * what it relies on again; the register's command checks it once more, as the last word.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { AppError, ValidationError } from '@itrms/kernel/errors';
import { SettingsService } from '@itrms/kernel/settings';
import { vehicles, VehicleHandovers } from '@itrms/vehicles/api';

import {
    addisDay,
    DEFAULT_VEHICLE_TRANSFER_DAYS,
    TRANSFER_IN_SERVICE,
    transferInspectionEntrySchema,
    VEHICLE_TRANSFER_REINSPECT_SETTING,
    VEHICLE_TRANSFER_VALID_DAYS_SETTING
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { daysAfter } from './bolo-validity';
import { actForHandlingOffice, claimedElsewhere, lockVehicleClaim } from './handling-office';
import type { CasePlace } from './licences.service';

type Words = keyof typeof am;
type Facts = Readonly<Record<string, unknown>>;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

const refuse = (path: string, code: string, key: Words): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message: say(key) }] });
};

const notEligible = (key: Words): never => {
    throw new ValidationError('not_eligible', { detail: say(key), detailKey: key });
};

const factObject = (facts: Facts, key: string): Record<string, unknown> | undefined => {
    const value = facts[key];
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** What the transfer out's request names (see vehicle-transfer.effects.ts). */
export type TransferOutInput = { vehicle: string; toOffice: string };
/** What the transfer in's request names. */
export type TransferInInput = { vehicle: string };

@Injectable()
export class VehicleTransferService {
    constructor(
        @Inject(VehicleHandovers) private readonly handovers: VehicleHandovers,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    // ---- the transfer out (DVC-14) ----

    /**
     * The vehicle is on the register and handled by the office the case is filed in, and the office it goes to is another
     * active office of the region that takes vehicles in (DVC-15); no other open request claims it, and no release of it stands.
     * The encumbrance check (`vehicles.checkEncumbrances:zone-transfer-out`) is named beside this effect.
     */
    async checkOut(tx: Tx, place: CasePlace, input: TransferOutInput, facts: Facts = {}) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.transferOutNotActive');
        if (vehicle.handlingUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'other_office', 'competency.rule.transferOutOtherOffice');
        if (input.toOffice === place.handlingUnitId)
            return refuse('toOffice', 'same_office', 'competency.rule.transferOutSameOffice');
        let seen;
        try {
            seen = await this.handovers.check(tx, place.ctx, vehicle.id, input.toOffice, TRANSFER_IN_SERVICE);
        } catch (error) {
            if (error instanceof AppError && error.detailKey === 'vehicles.errors.handover_not_offered')
                return refuse('toOffice', 'not_offered', 'competency.rule.transferOutNotOffered');
            throw error;
        }
        // the owners the filing saw: a vehicle that changed hands since is a new request's
        const saw = text(factObject(facts, 'transferOut')?.ownershipId);
        if (saw && factObject(facts, 'transferOut')?.vehicleId === vehicle.id && saw !== seen.openPeriodId)
            return refuse('vehicle', 'owners_changed', 'competency.rule.transferOutOwnersChanged');
        await lockVehicleClaim(tx, vehicle.id);
        if (await claimedElsewhere(tx, place.caseId, { vehicleId: vehicle.id, vinKey: seen.vinKey }))
            return notEligible('competency.rule.transferOutInOpenCase');
        return {
            // the vehicle's id here is what the register's open-case lookup claims it by (migration 0086)
            transferOut: { vehicleId: vehicle.id, toUnitId: input.toOffice, ownershipId: seen.openPeriodId }
        };
    }

    /** The giving step of the transfer out: the vehicle is released to the office named, for the days the setting gives. */
    async release(tx: Tx, at: CasePlace, facts: Facts) {
        const place = await actForHandlingOffice(tx, at);
        const out = factObject(facts, 'transferOut');
        const vehicleId = text(out?.vehicleId);
        const toUnitId = text(out?.toUnitId);
        const ownershipId = text(out?.ownershipId);
        if (!vehicleId || !toUnitId || !ownershipId) return notEligible('competency.rule.transferOutNotActive');
        const on = addisDay();
        const handover = await this.handovers.release(tx, place.ctx, {
            vehicleId,
            toUnitId,
            caseId: place.caseId,
            ownershipId,
            on,
            validUntil: daysAfter(on, await this.validDays(tx, place.handlingUnitId))
        });
        return { handover: { id: handover.id, validUntil: handover.validUntil, toUnitId: handover.toUnitId } };
    }

    // ---- the transfer in (DVC-15) ----

    /**
     * The vehicle is released to the office the case is filed in, and its release still stands; no other open request claims it.
     * Whether the vehicle is inspected again is the setting's at the filing, kept in the case's facts: changing it later does not
     * change a running case.
     */
    async checkIn(tx: Tx, place: CasePlace, input: TransferInInput, facts: Facts = {}) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.transferOutNotActive');
        if (vehicle.handlingUnitId === place.handlingUnitId)
            return refuse('vehicle', 'handled_here', 'competency.rule.transferInHandledHere');
        const standing = await this.handovers.standing(tx, vehicle.id);
        if (!standing || standing.toUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'not_released', 'competency.rule.transferInNoRelease');
        if (standing.validUntil < addisDay())
            return refuse('vehicle', 'release_lapsed', 'competency.rule.transferInExpired');
        await lockVehicleClaim(tx, vehicle.id);
        if (await claimedElsewhere(tx, place.caseId, { vehicleId: vehicle.id, vinKey: vehicle.vinKey }))
            return notEligible('competency.rule.transferInInOpenCase');
        const earlier = factObject(facts, 'transferIn')?.reinspect;
        const reinspect =
            typeof earlier === 'boolean'
                ? earlier
                : (await this.settings.value<unknown>(tx, place.handlingUnitId, VEHICLE_TRANSFER_REINSPECT_SETTING)) ===
                  true;
        return { transferIn: { vehicleId: vehicle.id, handoverId: standing.id, reinspect } };
    }

    /** The receiving office's inspection, when the setting asks for one: the vehicle is the one its record says. */
    async recordInspection(tx: Tx, at: CasePlace, answers: unknown) {
        await actForHandlingOffice(tx, at);
        const parsed = transferInspectionEntrySchema.safeParse(answers ?? {});
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    code: 'invalid',
                    message: i.message
                }))
            });
        if (!parsed.data.inspectionMatches)
            return refuse('inspectionMatches', 'not_matching', 'competency.rule.transferInspectionNotMatching');
        return { transferInspection: { on: addisDay(), note: parsed.data.inspectionNote ?? null } };
    }

    /**
     * The giving step of the transfer in: the register's command moves the vehicle and its live records to this office, and each row
     * it wrote is audited. Run again for the same case it moves nothing more.
     */
    async receive(tx: Tx, at: CasePlace, facts: Facts) {
        const place = await actForHandlingOffice(tx, at);
        const done = await this.handovers.receivedBy(tx, place.caseId);
        if (done) return { received: { handoverId: done.id, on: done.receivedOn } };
        const handoverId = text(factObject(facts, 'transferIn')?.handoverId);
        if (!handoverId) return refuse('vehicle', 'not_released', 'competency.rule.transferInNoRelease');
        await this.handovers.accept(tx, handoverId, place.caseId);
        return { received: { handoverId, on: addisDay() } };
    }

    /** A number of days the settings give, or the default when the setting is not a whole number in range. */
    private async validDays(tx: Tx, unitId: string): Promise<number> {
        const value = await this.settings.value<unknown>(tx, unitId, VEHICLE_TRANSFER_VALID_DAYS_SETTING);
        const days = z.number().int().min(1).max(60).safeParse(value);
        return days.success ? days.data : DEFAULT_VEHICLE_TRANSFER_DAYS;
    }
}
