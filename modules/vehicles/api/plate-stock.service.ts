/**
 * The stock of national plates (task 1.2a; contracts/plate-stock.ts): a unit that holds plate stock (the `holds_plate_stock`
 * capability, ADR-0026) receives a delivery from the federal source, hands plates to a unit directly below it, which accepts
 * them, and takes them back (a recall). The office that registers a vehicle assigns a plate of its own stock to it
 * (`take`, called by the register's commands, never over HTTP); the plate is retired or lost with the vehicle's plate.
 *
 * Every command locks the plates it moves in series and serial order (two commands over the same plates wait for each
 * other; none deadlocks), checks every one of them, and either moves them all or none. Each plate's change is audited and
 * the command writes one row of the ledger, so a unit's counts can be reconciled with what it took in (`summary`). The
 * database checks the same machine (the transition trigger) and that a plate is assigned exactly while a vehicle carries
 * it (the deferred match trigger), whatever the writer.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
import {
    insertAudited,
    insertManyAudited,
    updateAudited,
    updateManyAudited,
    type DbContext,
    type Tx
} from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { describeUnit, getUnit, unitRefs, type UnitRef } from '@itrms/kernel/org';
import { orgUnits } from '@itrms/kernel/tables';
import type { z } from 'zod';

import {
    foldPlate,
    movementListQuerySchema,
    nationalPlateText,
    parsePlate,
    plateAcceptanceSchema,
    plateAllocationSchema,
    plateBatchReceiveSchema,
    plateListQuerySchema,
    plateParts,
    plateRecallSchema,
    plateWriteOffSchema,
    selectionKeys,
    type PlateBatch,
    type PlateEndReason,
    type PlateMovement,
    type PlateSelection,
    type PlateStatus,
    type StockPlate,
    type StockSummary,
    type StockSummaryRow
} from '../contracts';
import { checked, fieldError, guardUnique, notFuture, required, today } from './support';
import { plateAssignments, plateBatches, plateMovements, plates } from './vehicles.table';

export const PLATE_STOCK_CAPABILITY = 'holds_plate_stock';

type PlateRow = typeof plates.$inferSelect;
type MovementRow = typeof plateMovements.$inferSelect;

const DUPLICATES = {
    plate_batches_reference_uq: 'vehicles.errors.duplicate_batch_reference',
    plates_key_uq: 'vehicles.errors.duplicate_plate_in_stock',
    plates_serial_uq: 'vehicles.errors.duplicate_plate_in_stock'
};

const notAvailable = (keys: readonly string[]) =>
    new ConflictError('invalid_transition', {
        detailKey: 'vehicles.errors.plate_not_available',
        params: {
            count: String(keys.length),
            plates: keys
                .slice(0, 20)
                .map((k) => nationalPlateText(k))
                .join(', ')
        }
    });

const emptyRef = (id: string): UnitRef => ({ id, code: '', name: {} });

@Injectable()
export class PlateStock {
    /** A delivery from the federal source, taken in by the acting unit: the batch, its plates in stock, a receipt. */
    async receive(tx: Tx, ctx: DbContext, given: z.input<typeof plateBatchReceiveSchema>): Promise<PlateBatch> {
        const input = checked(plateBatchReceiveSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        notFuture('receivedOn', input.receivedOn);
        const keys = selectionKeys(input.plates);
        // a plate already on a vehicle of the register (back-captured) is not new stock
        const carried = await tx
            .selectDistinct({ key: plateAssignments.plateKey })
            .from(plateAssignments)
            .where(and(eq(plateAssignments.regionId, regionId), inArray(plateAssignments.plateKey, keys)));
        if (carried.length > 0)
            throw new ConflictError('duplicate_reference', {
                detailKey: 'vehicles.errors.plate_on_register',
                params: {
                    plates: carried
                        .slice(0, 20)
                        .map((c) => nationalPlateText(c.key))
                        .join(', ')
                }
            });
        const first = keys[0] ?? '';
        const last = keys[keys.length - 1] ?? '';
        const batch = await guardUnique(
            () =>
                insertAudited(tx, plateBatches, {
                    regionId,
                    receivingUnitId: unitId,
                    reference: input.reference,
                    receivedOn: input.receivedOn,
                    quantity: keys.length,
                    firstKey: first,
                    lastKey: last,
                    note: input.note ?? null
                }),
            DUPLICATES
        );
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: 'receive',
            batchId: batch.id,
            keys,
            occurredOn: input.receivedOn,
            note: input.note
        });
        await guardUnique(
            () =>
                insertManyAudited(
                    tx,
                    plates,
                    keys.map((key) => ({
                        regionId,
                        holderUnitId: unitId,
                        batchId: batch.id,
                        plateKey: key,
                        ...plateParts(key),
                        status: 'in_stock' as const,
                        statusOn: input.receivedOn,
                        lastMovementId: movement.id
                    }))
                ),
            DUPLICATES
        );
        return this.batchOf(tx, batch);
    }

    /** Plates in the acting unit's stock handed to a unit directly below it, which then accepts them. */
    async allocate(tx: Tx, ctx: DbContext, given: z.input<typeof plateAllocationSchema>): Promise<PlateMovement> {
        const input = checked(plateAllocationSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        await this.directChild(tx, unitId, input.toUnitId, 'toUnitId');
        await this.holdsStock(tx, input.toUnitId, 'toUnitId');
        const rows = await this.lockSelection(tx, regionId, input.plates);
        const unfit = rows.filter((p) => p.holderUnitId !== unitId || p.status !== 'in_stock');
        if (unfit.length > 0) throw notAvailable(unfit.map((p) => p.plateKey));
        const movement = await this.record(tx, {
            regionId,
            unitId: input.toUnitId,
            kind: 'allocate',
            fromUnitId: unitId,
            toUnitId: input.toUnitId,
            keys: rows.map((p) => p.plateKey),
            occurredOn: today(),
            note: input.note
        });
        await this.move(tx, rows, {
            holderUnitId: input.toUnitId,
            status: 'allocated',
            lastMovementId: movement.id
        });
        return this.movementOf(tx, movement);
    }

    /** The unit an allocation was sent to takes its plates into stock: all of them, or all but `exceptKeys`. */
    async accept(
        tx: Tx,
        ctx: DbContext,
        allocationId: string,
        given: z.input<typeof plateAcceptanceSchema>
    ): Promise<PlateMovement> {
        const input = checked(plateAcceptanceSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        const [allocation] = await tx.select().from(plateMovements).where(eq(plateMovements.id, allocationId));
        if (allocation?.kind !== 'allocate') throw new NotFoundError();
        if (allocation.toUnitId !== unitId) throw new ForbiddenError({ detailKey: 'vehicles.errors.not_sent_here' });
        await this.holdsStock(tx, unitId);
        const waiting = await tx
            .select()
            .from(plates)
            .where(
                and(
                    eq(plates.regionId, regionId),
                    eq(plates.lastMovementId, allocationId),
                    eq(plates.status, 'allocated'),
                    eq(plates.holderUnitId, unitId)
                )
            )
            .orderBy(asc(plates.series), asc(plates.serial))
            .for('update');
        const except = new Set(input.exceptKeys ?? []);
        const taken = waiting.filter((p) => !except.has(p.plateKey));
        if (taken.length === 0)
            throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.nothing_to_accept' });
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: 'accept',
            ofMovementId: allocationId,
            keys: taken.map((p) => p.plateKey),
            occurredOn: today(),
            note: input.note
        });
        await this.move(tx, taken, { status: 'in_stock', lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /** Plates taken back by the acting unit from a unit directly below it: in its stock, or still waiting to be accepted. */
    async recall(tx: Tx, ctx: DbContext, given: z.input<typeof plateRecallSchema>): Promise<PlateMovement> {
        const input = checked(plateRecallSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        await this.directChild(tx, unitId, input.fromUnitId, 'fromUnitId');
        const rows = await this.lockSelection(tx, regionId, input.plates);
        const unfit = rows.filter(
            (p) => p.holderUnitId !== input.fromUnitId || (p.status !== 'in_stock' && p.status !== 'allocated')
        );
        if (unfit.length > 0) throw notAvailable(unfit.map((p) => p.plateKey));
        const movement = await this.record(tx, {
            regionId,
            unitId: input.fromUnitId,
            kind: 'recall',
            fromUnitId: input.fromUnitId,
            toUnitId: unitId,
            keys: rows.map((p) => p.plateKey),
            occurredOn: today(),
            reason: input.reason
        });
        await this.move(tx, rows, { holderUnitId: unitId, status: 'in_stock', lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /** Plates of the acting unit's stock that will never be issued: void (damaged, misprinted) or lost. */
    async writeOff(tx: Tx, ctx: DbContext, given: z.input<typeof plateWriteOffSchema>): Promise<PlateMovement> {
        const input = checked(plateWriteOffSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        const rows = await this.lockSelection(tx, regionId, input.plates);
        const unfit = rows.filter(
            (p) => p.holderUnitId !== unitId || (p.status !== 'in_stock' && p.status !== 'allocated')
        );
        if (unfit.length > 0) throw notAvailable(unfit.map((p) => p.plateKey));
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: 'write_off',
            keys: rows.map((p) => p.plateKey),
            occurredOn: today(),
            reason: input.reason
        });
        await this.move(tx, rows, { status: input.status, endReason: input.endReason, lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /**
     * A plate of the acting office's stock for a vehicle, assigned (the register's command opens the plate assignment in the
     * same transaction): the plate named, or the office's next free one. Not over HTTP: a case's effect calls it.
     */
    async take(
        tx: Tx,
        ctx: DbContext,
        wanted: { key?: string; vehicleId: string; caseId?: string; on: string }
    ): Promise<PlateRow> {
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        let plate: PlateRow | undefined;
        if (wanted.key) {
            [plate] = await tx
                .select()
                .from(plates)
                .where(and(eq(plates.regionId, regionId), eq(plates.plateKey, wanted.key)))
                .for('update');
            const fits =
                plate?.holderUnitId === unitId &&
                (plate.status === 'in_stock' ||
                    (plate.status === 'reserved' && wanted.caseId !== undefined && plate.caseId === wanted.caseId));
            if (!plate || !fits) throw notAvailable([wanted.key]);
        } else {
            [plate] = await tx
                .select()
                .from(plates)
                .where(
                    and(eq(plates.regionId, regionId), eq(plates.holderUnitId, unitId), eq(plates.status, 'in_stock'))
                )
                .orderBy(asc(plates.series), asc(plates.serial))
                .limit(1)
                .for('update', { skipLocked: true });
            if (!plate) throw new ConflictError('invalid_transition', { detailKey: 'vehicles.errors.no_free_plate' });
        }
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: 'assign',
            keys: [plate.plateKey],
            plateId: plate.id,
            vehicleId: wanted.vehicleId,
            caseId: wanted.caseId,
            occurredOn: wanted.on
        });
        return updateAudited(tx, plates, plate.id, plate.rowVersion, {
            status: 'assigned',
            statusOn: wanted.on,
            vehicleId: wanted.vehicleId,
            caseId: wanted.caseId ?? plate.caseId,
            lastMovementId: movement.id
        });
    }

    /** A vehicle's stock plate leaves it for good: retired (exchanged, retired, transferred out) or lost. */
    async closeAssigned(
        tx: Tx,
        ctx: DbContext,
        plateId: string,
        how: { status: 'retired' | 'lost'; endReason: PlateEndReason; on: string }
    ): Promise<void> {
        const regionId = required(ctx.regionId);
        const [plate] = await tx.select().from(plates).where(eq(plates.id, plateId)).for('update');
        if (!plate) throw new NotFoundError();
        if (plate.status !== 'assigned') throw notAvailable([plate.plateKey]);
        const movement = await this.record(tx, {
            regionId,
            unitId: plate.holderUnitId,
            kind: how.status === 'lost' ? 'lose' : 'retire',
            keys: [plate.plateKey],
            plateId: plate.id,
            vehicleId: plate.vehicleId ?? undefined,
            occurredOn: how.on
        });
        await updateAudited(tx, plates, plate.id, plate.rowVersion, {
            status: how.status,
            statusOn: how.on,
            endReason: how.endReason,
            lastMovementId: movement.id
        });
    }

    /** Whether a national plate key is in the region's stock (then only the stock assigns it). */
    async inStock(tx: Tx, regionId: string, key: string): Promise<boolean> {
        const [row] = await tx
            .select({ id: plates.id })
            .from(plates)
            .where(and(eq(plates.regionId, regionId), eq(plates.plateKey, key)));
        return row !== undefined;
    }

    /**
     * A unit's counts and those of the units directly below it, each with its ledger: what a unit took in (received, plus
     * allocated to it, less recalled from it) is what it holds in any status plus what is below it, and what it handed down
     * (less what it took back) is what is below it. Within the acting unit's subtree only.
     */
    async summary(tx: Tx, ctx: DbContext, unitId?: string): Promise<StockSummary> {
        const regionId = required(ctx.regionId);
        const unit = await getUnit(tx, unitId ?? required(ctx.unitId));
        const scope = ctx.scopePath ?? '';
        if (unit.regionId !== regionId || !(unit.path === scope || unit.path.startsWith(`${scope}.`)))
            throw new NotFoundError();
        const subtree = await tx
            .select({ id: orgUnits.id, path: orgUnits.path, parentId: orgUnits.parentId })
            .from(orgUnits)
            .where(and(eq(orgUnits.regionId, regionId), sql`${orgUnits.path} <@ ${unit.path}::ltree`));
        const held = await tx
            .select({ holder: plates.holderUnitId, status: plates.status, n: sql<number>`count(*)::int` })
            .from(plates)
            .where(and(eq(plates.regionId, regionId), sql`${plates.holderOrgPath} <@ ${unit.path}::ltree`))
            .groupBy(plates.holderUnitId, plates.status);
        const ledger = await tx
            .select({
                kind: plateMovements.kind,
                unitId: plateMovements.unitId,
                from: plateMovements.fromUnitId,
                to: plateMovements.toUnitId,
                n: sql<number>`sum(${plateMovements.quantity})::int`
            })
            .from(plateMovements)
            .where(and(eq(plateMovements.regionId, regionId), sql`${plateMovements.orgPath} <@ ${unit.path}::ltree`))
            .groupBy(plateMovements.kind, plateMovements.unitId, plateMovements.fromUnitId, plateMovements.toUnitId);

        const pathOf = new Map(subtree.map((u) => [u.id, u.path]));
        const below = (of: string, path: string) =>
            held
                .filter((h) => h.holder !== of && (pathOf.get(h.holder) ?? '').startsWith(`${path}.`))
                .reduce((sum, h) => sum + h.n, 0);
        const heldBy = (of: string, status: PlateStatus) =>
            held.filter((h) => h.holder === of && h.status === status).reduce((sum, h) => sum + h.n, 0);
        const sumOf = (pick: (l: (typeof ledger)[number]) => boolean) =>
            ledger.filter(pick).reduce((sum, l) => sum + l.n, 0);

        const children = subtree.filter((u) => u.parentId === unit.id).map((u) => u.id);
        const refs = await unitRefs(tx, [unit.id, ...children]);
        const rowOf = (id: string): StockSummaryRow => {
            const path = pathOf.get(id) ?? '';
            const statuses = {
                inStock: heldBy(id, 'in_stock'),
                inTransit: heldBy(id, 'allocated'),
                reserved: heldBy(id, 'reserved'),
                assigned: heldBy(id, 'assigned'),
                retired: heldBy(id, 'retired'),
                void: heldBy(id, 'void'),
                lost: heldBy(id, 'lost')
            };
            const allocatedDown = below(id, path);
            const received =
                sumOf((l) => l.kind === 'receive' && l.unitId === id) +
                sumOf((l) => l.kind === 'allocate' && l.to === id) -
                sumOf((l) => l.kind === 'recall' && l.from === id);
            const handedDown =
                sumOf((l) => l.kind === 'allocate' && l.from === id) - sumOf((l) => l.kind === 'recall' && l.to === id);
            const holding = Object.values(statuses).reduce((a, b) => a + b, 0);
            return {
                unit: refs.get(id) ?? emptyRef(id),
                received,
                ...statuses,
                allocatedDown,
                ledger: { received, allocatedDown: handedDown },
                reconciled: received === holding + allocatedDown && handedDown === allocatedDown
            };
        };
        return { unit: rowOf(unit.id), children: children.map(rowOf) };
    }

    /** Plates of the stock: one by its key anywhere in the region, else a unit's (the acting one's by default). */
    async list(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof plateListQuerySchema>
    ): Promise<{ items: StockPlate[]; nextCursor: string | null }> {
        const query = checked(plateListQuerySchema, given);
        const regionId = required(ctx.regionId);
        const conditions: (SQL | undefined)[] = [eq(plates.regionId, regionId)];
        if (query.q) {
            conditions.push(eq(plates.plateKey, parsePlate(query.q, [])?.key ?? foldPlate(query.q)));
        } else conditions.push(eq(plates.holderUnitId, query.holderUnitId ?? required(ctx.unitId)));
        if (query.status) conditions.push(eq(plates.status, query.status));
        if (query.series) conditions.push(eq(plates.series, query.series.toUpperCase()));
        if (query.after) conditions.push(gt(plates.plateKey, query.after));
        const rows = await tx
            .select()
            .from(plates)
            .where(and(...conditions))
            .orderBy(asc(plates.plateKey))
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        const refs = await unitRefs(
            tx,
            page.map((p) => p.holderUnitId)
        );
        return {
            items: page.map((p) => ({
                id: p.id,
                key: p.plateKey,
                text: nationalPlateText(p.plateKey),
                status: p.status,
                statusOn: p.statusOn,
                holder: refs.get(p.holderUnitId) ?? emptyRef(p.holderUnitId),
                vehicleId: p.vehicleId,
                caseId: p.caseId,
                endReason: p.endReason
            })),
            nextCursor: rows.length > query.limit ? (page[page.length - 1]?.plateKey ?? null) : null
        };
    }

    /** The ledger the acting unit sees (its subtree's), newest first. */
    async movements(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof movementListQuerySchema>
    ): Promise<{ items: PlateMovement[]; nextCursor: string | null }> {
        const query = checked(movementListQuerySchema, given);
        const regionId = required(ctx.regionId);
        const conditions: (SQL | undefined)[] = [
            eq(plateMovements.regionId, regionId),
            query.unitId ? eq(plateMovements.unitId, query.unitId) : undefined,
            query.kind ? eq(plateMovements.kind, query.kind) : undefined,
            query.after ? lt(plateMovements.id, query.after) : undefined
        ];
        const rows = await tx
            .select()
            .from(plateMovements)
            .where(and(...conditions))
            .orderBy(desc(plateMovements.id))
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        return {
            items: await this.movementsOf(tx, page),
            nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null
        };
    }

    async movement(tx: Tx, id: string): Promise<PlateMovement> {
        const [row] = await tx.select().from(plateMovements).where(eq(plateMovements.id, id));
        if (!row) throw new NotFoundError();
        return this.movementOf(tx, row);
    }

    async batches(tx: Tx, ctx: DbContext): Promise<PlateBatch[]> {
        const rows = await tx
            .select()
            .from(plateBatches)
            .where(eq(plateBatches.regionId, required(ctx.regionId)))
            .orderBy(desc(plateBatches.receivedOn), desc(plateBatches.id))
            .limit(200);
        return Promise.all(rows.map((b) => this.batchOf(tx, b)));
    }

    async batch(tx: Tx, id: string): Promise<PlateBatch> {
        const [row] = await tx.select().from(plateBatches).where(eq(plateBatches.id, id));
        if (!row) throw new NotFoundError();
        return this.batchOf(tx, row);
    }

    // ---- the parts the commands share

    /** The unit holds plate stock (its type's capability), else 403 (or a field error for the unit a command names). */
    private async holdsStock(tx: Tx, unitId: string, field?: string): Promise<void> {
        const unit = await describeUnit(tx, await getUnit(tx, unitId));
        if (unit.capabilities.includes(PLATE_STOCK_CAPABILITY)) return;
        if (field) throw fieldError(field, 'no_plate_stock', 'does not hold plate stock');
        throw new ForbiddenError({ detailKey: 'vehicles.errors.no_plate_stock' });
    }

    /** Stock moves one level at a time, so each level's ledger adds up. */
    private async directChild(tx: Tx, parentId: string, childId: string, field: string): Promise<void> {
        const child = await getUnit(tx, childId).catch(() => undefined);
        if (child?.parentId !== parentId)
            throw fieldError(field, 'not_child_unit', 'is not a unit directly below this one');
    }

    /** The plates a selection names, locked in series and serial order; every one of them must be in the stock. */
    private async lockSelection(tx: Tx, regionId: string, selection: PlateSelection): Promise<PlateRow[]> {
        const keys = selectionKeys(selection);
        const where =
            'keys' in selection
                ? and(eq(plates.regionId, regionId), inArray(plates.plateKey, keys))
                : and(
                      eq(plates.regionId, regionId),
                      eq(plates.series, selection.series),
                      sql`${plates.serial} between ${selection.from} and ${selection.to}`
                  );
        const rows = await tx
            .select()
            .from(plates)
            .where(where)
            .orderBy(asc(plates.series), asc(plates.serial))
            .for('update');
        if (rows.length !== keys.length) {
            const found = new Set(rows.map((p) => p.plateKey));
            throw notAvailable(keys.filter((k) => !found.has(k)));
        }
        return rows;
    }

    /** The same change to every plate (each audited); each must still be at the version it was locked at. */
    private async move(tx: Tx, rows: readonly PlateRow[], changes: Partial<typeof plates.$inferInsert>): Promise<void> {
        await updateManyAudited(
            tx,
            plates,
            rows.map((p) => p.id),
            { statusOn: today(), ...changes },
            new Map(rows.map((p) => [p.id, p.rowVersion]))
        );
    }

    private async record(
        tx: Tx,
        m: {
            regionId: string;
            unitId: string;
            kind: MovementRow['kind'];
            keys: readonly string[];
            occurredOn: string;
            fromUnitId?: string;
            toUnitId?: string;
            batchId?: string;
            ofMovementId?: string;
            plateId?: string;
            vehicleId?: string;
            caseId?: string;
            reason?: string;
            note?: string;
        }
    ): Promise<MovementRow> {
        const sorted = [...m.keys].sort();
        return insertAudited(tx, plateMovements, {
            regionId: m.regionId,
            unitId: m.unitId,
            kind: m.kind,
            fromUnitId: m.fromUnitId ?? null,
            toUnitId: m.toUnitId ?? null,
            batchId: m.batchId ?? null,
            ofMovementId: m.ofMovementId ?? null,
            quantity: sorted.length,
            firstKey: sorted[0] ?? '',
            lastKey: sorted[sorted.length - 1] ?? '',
            plateId: m.plateId ?? null,
            vehicleId: m.vehicleId ?? null,
            caseId: m.caseId ?? null,
            occurredOn: m.occurredOn,
            reason: m.reason ?? null,
            note: m.note ?? null
        });
    }

    private async movementOf(tx: Tx, row: MovementRow): Promise<PlateMovement> {
        const [one] = await this.movementsOf(tx, [row]);
        if (!one) throw new NotFoundError();
        return one;
    }

    private async movementsOf(tx: Tx, rows: readonly MovementRow[]): Promise<PlateMovement[]> {
        const refs = await unitRefs(
            tx,
            rows.flatMap((r) => [r.unitId, r.fromUnitId, r.toUnitId])
        );
        const allocations = rows.filter((r) => r.kind === 'allocate').map((r) => r.id);
        const waiting = allocations.length
            ? await tx
                  .select({ of: plates.lastMovementId, n: sql<number>`count(*)::int` })
                  .from(plates)
                  .where(and(inArray(plates.lastMovementId, allocations), eq(plates.status, 'allocated')))
                  .groupBy(plates.lastMovementId)
            : [];
        const awaiting = new Map(waiting.map((w) => [w.of, w.n]));
        const ref = (id: string | null) => (id ? (refs.get(id) ?? emptyRef(id)) : null);
        return rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            unit: refs.get(r.unitId) ?? emptyRef(r.unitId),
            fromUnit: ref(r.fromUnitId),
            toUnit: ref(r.toUnitId),
            batchId: r.batchId,
            ofMovementId: r.ofMovementId,
            quantity: r.quantity,
            firstKey: r.firstKey,
            lastKey: r.lastKey,
            occurredOn: r.occurredOn,
            reason: r.reason,
            note: r.note,
            awaiting: r.kind === 'allocate' ? (awaiting.get(r.id) ?? 0) : null
        }));
    }

    private async batchOf(tx: Tx, row: typeof plateBatches.$inferSelect): Promise<PlateBatch> {
        const refs = await unitRefs(tx, [row.receivingUnitId]);
        return {
            id: row.id,
            reference: row.reference,
            receivedOn: row.receivedOn,
            receivingUnit: refs.get(row.receivingUnitId) ?? emptyRef(row.receivingUnitId),
            quantity: row.quantity,
            firstKey: row.firstKey,
            lastKey: row.lastKey,
            note: row.note
        };
    }
}
