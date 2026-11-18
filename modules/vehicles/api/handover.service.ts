/**
 * A vehicle handed from one office to another of the region (task 1.4c, ADR-0057). The source releases it to the destination (a
 * row each office can read, class R of the source); the destination receives it, and the reviewed command
 * `vehicles.accept_handover` (migration 0086) moves the vehicle and its live rows in the receiving transaction: neither office can
 * move a vehicle under the class R policy. The checks here say why a step cannot go on in the person's words; the command checks
 * the same things again, as the last word. Every row the command wrote is audited here, in the same transaction.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { insertAudited, recordEvent, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { orgUnits } from '@itrms/kernel/tables';

import {
    libres,
    plateAssignments,
    plateMovements,
    plates,
    vehicleHandovers,
    vehicleOwners,
    vehicleOwnerships,
    vehicles
} from './vehicles.table';
import { withinScope } from './support';

type Handover = typeof vehicleHandovers.$inferSelect;

/** The tables the reviewed command moves rows of, by the name it returns: each move is audited against its own table. */
export const TABLES: Record<string, PgTable | undefined> = {
    'vehicles.vehicles': vehicles,
    'vehicles.vehicle_ownerships': vehicleOwnerships,
    'vehicles.vehicle_owners': vehicleOwners,
    'vehicles.plate_assignments': plateAssignments,
    'vehicles.libres': libres,
    'vehicles.plates': plates,
    'vehicles.plate_movements': plateMovements,
    'vehicles.vehicle_handovers': vehicleHandovers
};

/** What a release needs to know and the receipt checks again: the vehicle's open period and its key. */
export interface HandoverCheck {
    openPeriodId: string;
    vinKey: string;
    makeKey: string | null;
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

/** Whether the register refused a cancellation by a check of the handover (the trigger, or the table's own constraints). */
function refusedCancel(error: unknown): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint } = e as { code?: string; constraint?: string };
        if (code === '23514' && (constraint?.startsWith('handover_') || constraint?.startsWith('vehicle_handovers_')))
            return true;
    }
    return false;
}

@Injectable()
export class VehicleHandovers {
    /**
     * Whether the caller's office may release the vehicle to `toUnitId`: it handles it, the vehicle is on the register with owners,
     * and the destination is another active office of the region that offers `service` (the transfer in). Nothing is written.
     */
    async check(tx: Tx, ctx: DbContext, vehicleId: string, toUnitId: string, service: string): Promise<HandoverCheck> {
        const { vehicle, openPeriodId } = await this.checkVehicle(tx, ctx, vehicleId);
        if (toUnitId === vehicle.handlingUnitId)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.handover_same_office' });
        // the destination: an active office of the region given the transfer in (a sibling is answered by the reviewed lookup)
        const { rows } = await tx.execute<{ ok: boolean }>(
            sql`select vehicles.handover_destination(${toUnitId}::uuid, ${service}) as ok`
        );
        if (rows[0]?.ok !== true)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.handover_not_offered' });
        return { openPeriodId, vinKey: vehicle.vinKey, makeKey: vehicle.makeKey, toUnitId };
    }

    /**
     * Whether the caller's office may release the vehicle outside the region (ADR-0058): the vehicle part of `check`, with no
     * destination to look up. Nothing is written.
     */
    async checkOutside(
        tx: Tx,
        ctx: DbContext,
        vehicleId: string
    ): Promise<{ openPeriodId: string; vinKey: string; makeKey: string | null }> {
        const { vehicle, openPeriodId } = await this.checkVehicle(tx, ctx, vehicleId);
        return { openPeriodId, vinKey: vehicle.vinKey, makeKey: vehicle.makeKey };
    }

    /**
     * The release outside the region (the transfer out's giving step): the vehicle reads `transferred_out` and the release stands
     * as its claim. Nothing else changes (ADR-0058: the owners, plate, libre and stock plate stay). Run again for the same case it
     * returns the release it made.
     */
    async releaseOutside(
        tx: Tx,
        ctx: DbContext,
        given: {
            vehicleId: string;
            caseId: string;
            ownershipId: string;
            on: string;
            validUntil: string;
            destination: { name: string; region: string | null };
        }
    ): Promise<Handover> {
        const [made] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.caseId, given.caseId));
        if (made) return made;
        // the region reads every vehicle; a row-level lock needs the right to update it, so the scope is checked on a plain read first
        const [seen] = await tx.select().from(vehicles).where(eq(vehicles.id, given.vehicleId));
        if (!seen) throw new NotFoundError();
        if (!withinScope(seen.handlingOrgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, given.vehicleId)).for('update');
        if (!vehicle) throw new NotFoundError();
        if (vehicle.status !== 'active')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.not_on_register' });
        if (vehicle.handlingUnitId !== ctx.unitId)
            throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        const [open] = await tx
            .select({ id: vehicleOwnerships.id })
            .from(vehicleOwnerships)
            .where(and(eq(vehicleOwnerships.vehicleId, vehicle.id), sql`${vehicleOwnerships.until} is null`));
        if (open?.id !== given.ownershipId)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.owners_changed' });
        await this.expireLapsed(tx, vehicle.id, given.on);
        const released = await insertAudited(tx, vehicleHandovers, {
            regionId: ctx.regionId ?? '',
            vehicleId: vehicle.id,
            ownershipId: given.ownershipId,
            fromUnitId: vehicle.handlingUnitId,
            toUnitId: null,
            destinationKind: 'outside',
            destinationName: given.destination.name,
            destinationRegion: given.destination.region,
            caseId: given.caseId,
            releasedOn: given.on,
            releasedBy: ctx.userId ?? null,
            validUntil: given.validUntil
        });
        await updateAudited(tx, vehicles, vehicle.id, vehicle.rowVersion, { status: 'transferred_out' });
        return released;
    }

    /** The vehicle part of every release's check: it exists, the caller's office handles it, it is active and has owners. */
    private async checkVehicle(tx: Tx, ctx: DbContext, vehicleId: string) {
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
        return { vehicle, openPeriodId: open.id };
    }

    /** A release of the vehicle that lapsed unused is expired, so a new one may stand. */
    private async expireLapsed(tx: Tx, vehicleId: string, on: string): Promise<void> {
        const lapsed = await tx
            .select()
            .from(vehicleHandovers)
            .where(
                and(
                    eq(vehicleHandovers.vehicleId, vehicleId),
                    eq(vehicleHandovers.status, 'released'),
                    lt(vehicleHandovers.validUntil, on)
                )
            );
        for (const row of lapsed)
            await updateAudited(tx, vehicleHandovers, row.id, row.rowVersion, { status: 'expired' });
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
        await this.expireLapsed(tx, given.vehicleId, given.on);
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

    /**
     * The cancellation of a release (task 1.4c2b, ADR-0059): the releasing office's own case ends it. The release stood: it is
     * `cancelled`, final, and a vehicle released outside the region reads active again. Nothing else changes (ADR-0058: its owners,
     * plate, libre and stock plate were kept). Run again for the same case it returns the release it cancelled.
     */
    async cancel(tx: Tx, ctx: DbContext, given: { handoverId: string; caseId: string; on: string }): Promise<Handover> {
        const [made] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.cancelCaseId, given.caseId));
        if (made) return made;
        const [seen] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.id, given.handoverId));
        if (!seen) throw new NotFoundError();
        if (seen.fromUnitId !== ctx.unitId) throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
        const [handover] = await tx
            .select()
            .from(vehicleHandovers)
            .where(eq(vehicleHandovers.id, given.handoverId))
            .for('update');
        if (!handover || handover.status !== 'released')
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.handover_not_standing' });
        const outside = handover.destinationKind === 'outside';
        let vehicle: typeof vehicles.$inferSelect | undefined;
        if (outside) {
            // as the release: a row-level lock needs the right to update the vehicle, so the scope is checked on a plain read first
            const [plain] = await tx.select().from(vehicles).where(eq(vehicles.id, handover.vehicleId));
            if (!plain) throw new NotFoundError();
            if (!withinScope(plain.handlingOrgPath, ctx.scopePath ?? ''))
                throw new ForbiddenError({ detailKey: 'vehicles.errors.other_office' });
            [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, handover.vehicleId)).for('update');
            if (!vehicle || vehicle.status !== 'transferred_out' || vehicle.handlingUnitId !== handover.fromUnitId)
                throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.handover_not_standing' });
            const [open] = await tx
                .select({ id: vehicleOwnerships.id })
                .from(vehicleOwnerships)
                .where(and(eq(vehicleOwnerships.vehicleId, vehicle.id), sql`${vehicleOwnerships.until} is null`));
            if (open?.id !== handover.ownershipId)
                throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.owners_changed' });
        }
        // the trigger of migration 0088 is the last word (the case, the office, the day, the caller): its refusal is a conflict, not a 500
        try {
            const cancelled = await updateAudited(tx, vehicleHandovers, handover.id, handover.rowVersion, {
                status: 'cancelled',
                cancelCaseId: given.caseId,
                cancelledOn: given.on,
                cancelledBy: ctx.userId ?? null
            });
            if (vehicle) await updateAudited(tx, vehicles, vehicle.id, vehicle.rowVersion, { status: 'active' });
            return cancelled;
        } catch (error) {
            if (!refusedCancel(error)) throw error;
            throw new ConflictError('invalid_transition', {
                detailKey: 'vehicles.errors.handover_not_standing',
                cause: error
            });
        }
    }

    /** The release a receipt by this case made, if it was received already. */
    async receivedBy(tx: Tx, caseId: string): Promise<Handover | undefined> {
        const [row] = await tx
            .select()
            .from(vehicleHandovers)
            .where(and(eq(vehicleHandovers.inCaseId, caseId), eq(vehicleHandovers.status, 'received')));
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
        const [handover] = await tx.select().from(vehicleHandovers).where(eq(vehicleHandovers.id, handoverId));
        for (const row of rows)
            await recordEvent(tx, {
                type: 'vehicles.handover_moved',
                table: TABLES[row.tbl],
                rowId: row.row_id,
                data: { from: handover?.fromUnitId, to: handover?.toUnitId, handoverId, caseId }
            });
        return { moved: rows.length };
    }
}
