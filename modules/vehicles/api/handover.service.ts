/**
 * A vehicle handed from one office to another of the region (task 1.4c, ADR-0057). The source releases it to the destination (a
 * row each office can read, class R of the source); the destination receives it, and the reviewed command
 * `vehicles.accept_handover` (migration 0086) moves the vehicle and its live rows in the receiving transaction: neither office can
 * move a vehicle under the class R policy. The checks here say why a step cannot go on in the person's words; the command checks
 * the same things again, as the last word. Every row the command wrote is audited here, in the same transaction.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { insertAudited, recordEvent, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { orgUnits } from '@itrms/kernel/tables';

import { vehicleHandovers, vehicleOwnerships, vehicles } from './vehicles.table';
import { withinScope } from './support';

type Handover = typeof vehicleHandovers.$inferSelect;

/** What a release needs to know and the receipt checks again: the vehicle's open period and its key. */
export interface HandoverCheck {
    openPeriodId: string;
    vinKey: string;
    toUnitId: string;
}

/** The constraint a refused receipt named, if the reviewed command refused it. */
function refusedBy(error: unknown): string | undefined {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint } = e as { code?: string; constraint?: string };
        if (code === '23514' && constraint?.startsWith('handover_')) return constraint;
        if (code === '42501') return 'handover_not_yours';
    }
    return undefined;
}

@Injectable()
export class VehicleHandovers {
    /**
     * Whether the caller's office may release the vehicle to `toUnitId`: it handles it, the vehicle is on the register with owners,
     * and the destination is another active office of the region that offers `service` (the transfer in). Nothing is written.
     */
    async check(tx: Tx, ctx: DbContext, vehicleId: string, toUnitId: string, service: string): Promise<HandoverCheck> {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId));
        if (!vehicle) throw new NotFoundError();
        if (!withinScope(vehicle.handlingOrgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        if (vehicle.status !== 'active')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.not_on_register' });
        const [open] = await tx
            .select({ id: vehicleOwnerships.id })
            .from(vehicleOwnerships)
            .where(and(eq(vehicleOwnerships.vehicleId, vehicleId), sql`${vehicleOwnerships.until} is null`));
        if (!open) throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.no_owners' });
        if (toUnitId === vehicle.handlingUnitId)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.handover_same_office' });
        // the destination: an active office of the region given the transfer in (a sibling is answered by the reviewed lookup)
        const { rows } = await tx.execute<{ ok: boolean }>(
            sql`select vehicles.handover_destination(${toUnitId}::uuid, ${service}) as ok`
        );
        if (rows[0]?.ok !== true)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.handover_not_offered' });
        return { openPeriodId: open.id, vinKey: vehicle.vinKey, toUnitId };
    }

    /**
     * The release (the transfer out's giving step): the vehicle is the destination's to receive until `validUntil`. A release of
     * the vehicle that lapsed unused is expired first; run again for the same case it returns the release it made.
     */
    async release(
        tx: Tx,
        ctx: DbContext,
        given: {
            vehicleId: string;
            toUnitId: string;
            caseId: string;
            ownershipId: string;
            on: string;
            validUntil: string;
        }
    ): Promise<Handover> {
        const [made] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.caseId, given.caseId));
        if (made) return made;
        const lapsed = await tx
            .select()
            .from(vehicleHandovers)
            .where(
                and(
                    eq(vehicleHandovers.vehicleId, given.vehicleId),
                    eq(vehicleHandovers.status, 'released'),
                    lt(vehicleHandovers.validUntil, given.on)
                )
            );
        for (const row of lapsed)
            await updateAudited(tx, vehicleHandovers, row.id, row.rowVersion, { status: 'expired' });
        const [unit] = await tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(eq(orgUnits.id, ctx.unitId ?? ''));
        if (!unit) throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        return insertAudited(tx, vehicleHandovers, {
            regionId: ctx.regionId ?? '',
            vehicleId: given.vehicleId,
            ownershipId: given.ownershipId,
            fromUnitId: unit.id,
            toUnitId: given.toUnitId,
            caseId: given.caseId,
            releasedOn: given.on,
            releasedBy: ctx.userId ?? null,
            validUntil: given.validUntil
        });
    }

    /** The release standing for the vehicle, if any: whatever its day (the caller says whether it lapsed). */
    async standing(tx: Tx, vehicleId: string): Promise<Handover | undefined> {
        const [row] = await tx
            .select()
            .from(vehicleHandovers)
            .where(and(eq(vehicleHandovers.vehicleId, vehicleId), eq(vehicleHandovers.status, 'released')));
        return row;
    }

    /** The release a receipt by this case made, if it was received already. */
    async receivedBy(tx: Tx, caseId: string): Promise<Handover | undefined> {
        const [row] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.inCaseId, caseId));
        return row;
    }

    /**
     * The receipt (the transfer in's giving step): the reviewed command moves the vehicle and its live rows to the destination, and
     * each row it wrote is audited here as an event of the move. Run again for the same case it moves nothing more.
     */
    async accept(tx: Tx, handoverId: string, caseId: string): Promise<{ moved: number }> {
        let rows: { tbl: string; row_id: string }[];
        try {
            ({ rows } = await tx.execute<{ tbl: string; row_id: string }>(
                sql`select tbl, row_id from vehicles.accept_handover(${handoverId}::uuid, ${caseId}::uuid)`
            ));
        } catch (error) {
            const constraint = refusedBy(error);
            if (!constraint) throw error;
            throw new ConflictError('invalid_transition', { detailKey: `vehicles.errors.${constraint}`, cause: error });
        }
        for (const row of rows)
            await recordEvent(tx, {
                type: 'vehicles.handover_moved',
                rowId: row.row_id,
                data: { table: row.tbl, handoverId, caseId }
            });
        return { moved: rows.length };
    }
}
