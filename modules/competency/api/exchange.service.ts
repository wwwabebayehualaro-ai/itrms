/**
 * The plate exchange, DVC-12 (task 1.2c, Directive 1050/2025): what a request must meet, and the step that puts a national plate of
 * the office's stock on a vehicle that still carries its old regional plate. The old plate is retired the same day and points at the
 * one that replaced it (the register's own plate history). The plate is held from the final approval and handed over by the
 * registration's effects (VehicleRegistrationService.reservePlate, assignPlate, releasePlate); this adds the check and the federal id.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, ValidationError } from '@itrms/kernel/errors';
import { plateAssignments, plates, vehicles, VehicleRegistry } from '@itrms/vehicles/api';
import { cases } from '@itrms/workflow/api';

import { exchangeEntrySchema } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import type { CasePlace } from './licences.service';
import { VehicleRegistrationService } from './registration.service';

type Words = keyof typeof am;

/** A refusal in the language of the person acting: this is what they read at the counter. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

/** The request's answers an effect reads, by contract path (see exchange.effects.ts). */
export type ExchangeInput = {
    /** the vehicle, picked from the register */
    vehicle: string;
    /** its use, as the old plate's code says it (what the fee is worked out from) */
    use: string;
};

const refuse = (path: string, code: string, key: Words): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message: say(key) }] });
};

@Injectable()
export class PlateExchangeService {
    constructor(
        @Inject(VehicleRegistry) private readonly registry: VehicleRegistry,
        @Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService
    ) {}

    // ---- filing ----

    /**
     * What makes an exchange acceptable, checked on the server: the vehicle is on the register, handled by the office the case is
     * in (its plate comes from that office's stock), carries an old plate (regional or special), its use is the one the fee was
     * worked out from, and no other open request is exchanging it. Nothing is written.
     */
    async check(tx: Tx, place: CasePlace, input: ExchangeInput) {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicle));
        if (!vehicle || vehicle.status !== 'active')
            return refuse('vehicle', 'not_active', 'competency.rule.exchangeNotActive');
        if (vehicle.handlingUnitId !== place.handlingUnitId)
            return refuse('vehicle', 'other_office', 'competency.rule.exchangeOtherOffice');
        const [current] = await tx
            .select()
            .from(plateAssignments)
            .where(and(eq(plateAssignments.vehicleId, vehicle.id), isNull(plateAssignments.until)));
        // an old regional plate: the special ones (diplomatic, police, defence, machinery) are not the zone's to exchange
        if (!current || current.format !== 'legacy')
            return refuse('vehicle', 'no_old_plate', 'competency.rule.exchangeNoOldPlate');
        if (input.use !== vehicle.use) return refuse('use', 'mismatch', 'competency.rule.exchangeUse');
        // two requests for one vehicle filed at the same moment: the second waits for the first's transaction, then sees its facts
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`competency.plate-exchange:${vehicle.id}`}, 0))`
        );
        const [other] = await tx
            .select({ id: cases.id })
            .from(cases)
            .where(
                and(
                    isNull(cases.closedAt),
                    ne(cases.id, place.caseId),
                    sql`${cases.facts}#>>'{exchange,vehicleId}' = ${vehicle.id}`
                )
            )
            .limit(1);
        if (other)
            throw new ValidationError('not_eligible', {
                detail: say('competency.rule.exchangeInOpenCase'),
                detailKey: 'competency.rule.exchangeInOpenCase'
            });
        return {
            vehicle: { id: vehicle.id },
            exchange: { vehicleId: vehicle.id, oldPlateKey: current.plateKey, oldPlateText: current.plateText }
        };
    }

    // ---- the exchange ----

    /**
     * The officer hands over the national plate: the federal vehicle id the national system gave is recorded on the vehicle when
     * given, then the held plate (or the one named, of the office's stock) goes on it and the old plate is retired, linked to it.
     * Run again it returns the plate it gave.
     */
    async exchange(tx: Tx, place: CasePlace, facts: Readonly<Record<string, unknown>>, answers: unknown) {
        if (place.ctx.unitId !== place.handlingUnitId)
            throw new ForbiddenError({ detailKey: 'competency.errors.act_from_handling_office' });
        const parsed = exchangeEntrySchema.safeParse(answers ?? {});
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    code: 'invalid',
                    message: i.message
                }))
            });
        const vehicle = facts.vehicle as { id?: unknown } | undefined;
        if (typeof vehicle?.id !== 'string')
            throw new ConflictError('contract_unmet', {
                detailKey: 'competency.errors.registration_missing_fact',
                params: { key: 'vehicle' }
            });
        // the vehicle still carries the old plate the request was checked with, or already the plate this case gave it (a step
        // run again): a vehicle whose plate changed since is not exchanged blind
        const oldPlateKey = (facts.exchange as { oldPlateKey?: unknown } | undefined)?.oldPlateKey;
        const [current] = await tx
            .select({ key: plateAssignments.plateKey, caseId: plates.caseId, status: vehicles.status })
            .from(plateAssignments)
            .innerJoin(vehicles, eq(vehicles.id, plateAssignments.vehicleId))
            .leftJoin(plates, eq(plates.id, plateAssignments.plateId))
            .where(and(eq(plateAssignments.vehicleId, vehicle.id), isNull(plateAssignments.until)));
        if (!current || current.status !== 'active' || (current.key !== oldPlateKey && current.caseId !== place.caseId))
            throw new ConflictError('invalid_transition', { detailKey: 'competency.rule.exchangeNoOldPlate' });
        if (parsed.data.federalVehicleId)
            await this.registry.recordFederalId(tx, place.ctx, vehicle.id, parsed.data.federalVehicleId);
        return this.registration.assignPlate(tx, place, facts, { replacementPlate: parsed.data.replacementPlate });
    }
}
