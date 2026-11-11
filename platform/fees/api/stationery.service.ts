/**
 * Controlled stationery (task 1.12a; contracts/stationery.ts, architecture.md §9, ADR-0050): a unit that holds stationery
 * (the `holds_stationery` capability, ADR-0026) receives a delivery in a serial range, hands items to a unit directly below
 * it, which accepts them, and takes them back (a recall). An office uses an item of its own stock for one record (`use`,
 * called by the slice that prints or issues on it, never over HTTP), spoils one with a reason, or writes items off. At its
 * closing it records what it counted; what it should hold and did not count is flagged missing.
 *
 * Every command locks the items it moves in series and serial order (two commands over the same items wait for each other;
 * none deadlocks; a caller that uses several locks them first with `lockKeys`), checks every one of them, and either moves
 * them all or none. Each item's change is audited and the
 * command writes one row of the ledger, so a unit's counts reconcile with what it took in (`summary`). The database checks
 * the same machine (the transition trigger), whatever the writer.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
    insertAudited,
    insertManyAudited,
    updateAudited,
    updateManyAudited,
    type DbContext,
    type Tx
} from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { describeUnit, getUnit, unitRefs, withinScope, type UnitRef } from '@itrms/kernel/org';
import { orgUnits } from '@itrms/kernel/tables';
import type { z } from 'zod';

import {
    parseStationeryKey,
    selectionSerials,
    stationeryAcceptanceSchema,
    stationeryAllocationSchema,
    stationeryClosingSchema,
    stationeryKey,
    stationeryListQuerySchema,
    stationeryMovementListQuerySchema,
    stationeryRecallSchema,
    stationeryReceiveSchema,
    stationeryWriteOffSchema,
    type StationeryBatch,
    type StationeryClosing,
    type StationeryItem,
    type StationeryKind,
    type StationeryMovement,
    type StationerySelection,
    type StationeryStatus,
    type StationerySummary,
    type StationerySummaryRow
} from '../contracts';
import { addisToday } from './fees.service';
import { stationeryBatches, stationeryClosings, stationeryItems, stationeryMovements } from './stationery.table';

export const STATIONERY_CAPABILITY = 'holds_stationery';

type ItemRow = typeof stationeryItems.$inferSelect;
type MovementRow = typeof stationeryMovements.$inferSelect;
type Serial = { series: string; serial: number };

/** The most keys a closing lists by name; the counts have them all. */
const LISTED = 200;

const DUPLICATES = {
    stationery_batches_reference_uq: 'fees.errors.duplicate_stationery_reference',
    stationery_items_serial_uq: 'fees.errors.duplicate_stationery_serial',
    stationery_closings_day_uq: 'fees.errors.stationery_closed_today',
    stationery_items_used_for_uq: 'fees.errors.stationery_already_used'
};

function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detailKey: 'fees.errors.choose_office' });
    return value;
}

function checked<S extends z.ZodType>(schema: S, input: z.input<S>): z.output<S> {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    throw new ValidationError('validation_failed', {
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
    });
}

const fieldError = (path: string, code: string, message: string) =>
    new ValidationError('validation_failed', { errors: [{ path, code, message }] });

function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
}

async function guardUnique<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        for (const [constraint, detailKey] of Object.entries(DUPLICATES))
            if (isUniqueViolation(error, constraint))
                throw new ConflictError('duplicate_reference', { detailKey, cause: error });
        throw error;
    }
}

function notFuture(path: string, date: string): void {
    if (date > addisToday()) throw fieldError(path, 'in_future', 'is in the future');
}

const notAvailable = (keys: readonly string[]) =>
    new ConflictError('invalid_transition', {
        detailKey: 'fees.errors.stationery_not_available',
        params: { count: String(keys.length), items: keys.slice(0, 20).join(', ') }
    });

const emptyRef = (id: string): UnitRef => ({ id, code: '', name: {} });
const serialId = (s: Serial) => `${s.series}/${s.serial}`;
const keyOf = (s: Serial) => stationeryKey(s.series, s.serial, 1);

@Injectable()
export class StationeryStock {
    /** A delivery taken in by the acting unit: the batch, its items in stock, a receipt in the ledger. */
    async receive(tx: Tx, ctx: DbContext, given: z.input<typeof stationeryReceiveSchema>): Promise<StationeryBatch> {
        const input = checked(stationeryReceiveSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        notFuture('receivedOn', input.receivedOn);
        const width = input.width ?? String(input.range.to).length;
        const serials = selectionSerials(input.range);
        const keys = serials.map((s) => stationeryKey(s.series, s.serial, width));
        const batch = await guardUnique(() =>
            insertAudited(tx, stationeryBatches, {
                regionId,
                receivingUnitId: unitId,
                kind: input.kind,
                source: input.source,
                reference: input.reference,
                receivedOn: input.receivedOn,
                variant: input.variant ?? null,
                validEfy: input.validEfy ?? null,
                unitCostSantim: input.unitCostSantim === undefined ? null : BigInt(input.unitCostSantim),
                quantity: keys.length,
                firstKey: keys[0] ?? '',
                lastKey: keys[keys.length - 1] ?? '',
                note: input.note ?? null
            })
        );
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: input.kind,
            movement: 'receive',
            batchId: batch.id,
            keys,
            occurredOn: input.receivedOn,
            note: input.note
        });
        await guardUnique(() =>
            insertManyAudited(
                tx,
                stationeryItems,
                serials.map((s, i) => ({
                    regionId,
                    holderUnitId: unitId,
                    batchId: batch.id,
                    kind: input.kind,
                    variant: input.variant ?? null,
                    validEfy: input.validEfy ?? null,
                    series: s.series,
                    serial: s.serial,
                    itemKey: keys[i] ?? '',
                    width,
                    status: 'in_stock' as const,
                    statusOn: input.receivedOn,
                    lastMovementId: movement.id
                }))
            )
        );
        return this.batchOf(tx, batch);
    }

    /** Items of the acting unit's stock handed to a unit directly below it, which then accepts them. */
    async allocate(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof stationeryAllocationSchema>
    ): Promise<StationeryMovement> {
        const input = checked(stationeryAllocationSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        await this.directChild(tx, unitId, input.toUnitId, 'toUnitId');
        await this.holdsStock(tx, input.toUnitId, 'toUnitId');
        const rows = await this.lockSelection(tx, regionId, input.kind, input.items);
        const unfit = rows.filter((r) => r.holderUnitId !== unitId || r.status !== 'in_stock');
        if (unfit.length > 0) throw notAvailable(unfit.map((r) => r.itemKey));
        const movement = await this.record(tx, {
            regionId,
            unitId: input.toUnitId,
            kind: input.kind,
            movement: 'allocate',
            fromUnitId: unitId,
            toUnitId: input.toUnitId,
            keys: rows.map((r) => r.itemKey),
            occurredOn: addisToday(),
            note: input.note
        });
        await this.move(tx, rows, { holderUnitId: input.toUnitId, status: 'allocated', lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /** The unit an allocation was sent to takes its items into stock: all of them, or all but `exceptKeys`. */
    async accept(
        tx: Tx,
        ctx: DbContext,
        allocationId: string,
        given: z.input<typeof stationeryAcceptanceSchema>
    ): Promise<StationeryMovement> {
        const input = checked(stationeryAcceptanceSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        const [allocation] = await tx
            .select()
            .from(stationeryMovements)
            .where(eq(stationeryMovements.id, allocationId));
        if (allocation?.movement !== 'allocate') throw new NotFoundError();
        if (allocation.toUnitId !== unitId) throw new ForbiddenError({ detailKey: 'fees.errors.not_sent_here' });
        await this.holdsStock(tx, unitId);
        const waiting = await tx
            .select()
            .from(stationeryItems)
            .where(
                and(
                    eq(stationeryItems.regionId, regionId),
                    eq(stationeryItems.lastMovementId, allocationId),
                    eq(stationeryItems.status, 'allocated'),
                    eq(stationeryItems.holderUnitId, unitId)
                )
            )
            .orderBy(asc(stationeryItems.series), asc(stationeryItems.serial))
            .for('update');
        const except = new Set((input.exceptKeys ?? []).map((k) => this.serialOf(k)));
        const taken = waiting.filter((r) => !except.has(serialId(r)));
        if (taken.length === 0)
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.nothing_to_accept' });
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: allocation.kind,
            movement: 'accept',
            ofMovementId: allocationId,
            keys: taken.map((r) => r.itemKey),
            occurredOn: addisToday(),
            note: input.note
        });
        await this.move(tx, taken, { status: 'in_stock', lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /** Items taken back by the acting unit from a unit directly below it: in its stock, or still waiting to be accepted. */
    async recall(tx: Tx, ctx: DbContext, given: z.input<typeof stationeryRecallSchema>): Promise<StationeryMovement> {
        const input = checked(stationeryRecallSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        await this.directChild(tx, unitId, input.fromUnitId, 'fromUnitId');
        const rows = await this.lockSelection(tx, regionId, input.kind, input.items);
        const unfit = rows.filter(
            (r) => r.holderUnitId !== input.fromUnitId || (r.status !== 'in_stock' && r.status !== 'allocated')
        );
        if (unfit.length > 0) throw notAvailable(unfit.map((r) => r.itemKey));
        const movement = await this.record(tx, {
            regionId,
            unitId: input.fromUnitId,
            kind: input.kind,
            movement: 'recall',
            fromUnitId: input.fromUnitId,
            toUnitId: unitId,
            keys: rows.map((r) => r.itemKey),
            occurredOn: addisToday(),
            reason: input.reason
        });
        await this.move(tx, rows, { holderUnitId: unitId, status: 'in_stock', lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /** Items of the acting unit's stock that will never be used: void (damaged) or missing (lost, stolen, not found). */
    async writeOff(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof stationeryWriteOffSchema>
    ): Promise<StationeryMovement> {
        const input = checked(stationeryWriteOffSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        const rows = await this.lockSelection(tx, regionId, input.kind, input.items);
        const unfit = rows.filter(
            (r) => r.holderUnitId !== unitId || (r.status !== 'in_stock' && r.status !== 'allocated')
        );
        if (unfit.length > 0) throw notAvailable(unfit.map((r) => r.itemKey));
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: input.kind,
            movement: 'write_off',
            keys: rows.map((r) => r.itemKey),
            occurredOn: addisToday(),
            reason: input.reason
        });
        await this.move(tx, rows, { status: input.status, endReason: input.endReason, lastMovementId: movement.id });
        return this.movementOf(tx, movement);
    }

    /**
     * An item of the acting office's stock used for one record (a licence printed on a blank, a libre written in a booklet):
     * the one named, or the office's next free one of the kind (and variant). Used once: the same record asking again gets
     * the same item back, and an item is never used for two. Not over HTTP: the slice that prints or issues calls it.
     */
    async use(
        tx: Tx,
        ctx: DbContext,
        wanted: {
            kind: StationeryKind;
            key?: string;
            variant?: string;
            usedFor: { table: string; id: string };
            caseId?: string;
            on?: string;
        }
    ): Promise<ItemRow> {
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        const [already] = await tx
            .select()
            .from(stationeryItems)
            .where(
                and(
                    eq(stationeryItems.kind, wanted.kind),
                    eq(stationeryItems.usedForTable, wanted.usedFor.table),
                    eq(stationeryItems.usedForId, wanted.usedFor.id)
                )
            );
        if (already) {
            if (wanted.key && parseStationeryKey(wanted.key) && serialId(already) !== this.serialOf(wanted.key))
                throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.stationery_already_used' });
            return already;
        }
        const item = await this.lockOne(tx, regionId, unitId, wanted.kind, wanted.key, wanted.variant);
        const on = wanted.on ?? addisToday();
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: wanted.kind,
            movement: 'use',
            keys: [item.itemKey],
            caseId: wanted.caseId,
            occurredOn: on
        });
        return guardUnique(() =>
            updateAudited(tx, stationeryItems, item.id, item.rowVersion, {
                status: 'used',
                statusOn: on,
                usedForTable: wanted.usedFor.table,
                usedForId: wanted.usedFor.id,
                caseId: wanted.caseId ?? null,
                lastMovementId: movement.id
            })
        );
    }

    /**
     * Locks the named items of a kind in series and serial order, the order every command locks in, so a caller that then
     * uses or spoils several of them in another order cannot deadlock with a keeper's command over the same run. Items
     * not in the region's stock are left to the command that names them.
     */
    async lockKeys(tx: Tx, ctx: DbContext, kind: StationeryKind, keys: readonly string[]): Promise<void> {
        const serials = keys.map((k) => parseStationeryKey(k)).flatMap((p) => (p ? [p] : []));
        if (serials.length === 0) return;
        await tx
            .select({ id: stationeryItems.id })
            .from(stationeryItems)
            .where(
                and(
                    eq(stationeryItems.regionId, required(ctx.regionId)),
                    eq(stationeryItems.kind, kind),
                    or(
                        ...serials.map((s) =>
                            and(eq(stationeryItems.series, s.series), eq(stationeryItems.serial, s.serial))
                        )
                    )
                )
            )
            .orderBy(asc(stationeryItems.series), asc(stationeryItems.serial))
            .for('update');
    }

    /** An item of the acting office's stock spoiled (a misprint, a torn booklet): kept on record, never used again. */
    async spoil(
        tx: Tx,
        ctx: DbContext,
        wanted: { kind: StationeryKind; key: string; reason: string; caseId?: string; on?: string }
    ): Promise<ItemRow> {
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        if (wanted.reason.trim().length < 3) throw fieldError('reason', 'too_small', 'is too short');
        const item = await this.lockOne(tx, regionId, unitId, wanted.kind, wanted.key);
        const on = wanted.on ?? addisToday();
        const movement = await this.record(tx, {
            regionId,
            unitId,
            kind: wanted.kind,
            movement: 'spoil',
            keys: [item.itemKey],
            caseId: wanted.caseId,
            occurredOn: on,
            reason: wanted.reason.trim()
        });
        return updateAudited(tx, stationeryItems, item.id, item.rowVersion, {
            status: 'spoiled',
            statusOn: on,
            endReason: 'misprinted',
            note: wanted.reason.trim().slice(0, 500),
            caseId: wanted.caseId ?? null,
            lastMovementId: movement.id
        });
    }

    /**
     * The acting office's closing of one kind on one day: the runs it counted set against the items it holds in stock. What
     * it holds and did not count is flagged missing; what it counted and does not hold in stock is flagged unexpected. The
     * closing changes no item: a missing one is written off by the keeper with a reason (`writeOff`), once looked for.
     */
    async close(tx: Tx, ctx: DbContext, given: z.input<typeof stationeryClosingSchema>): Promise<StationeryClosing> {
        const input = checked(stationeryClosingSchema, given);
        const regionId = required(ctx.regionId);
        const unitId = required(ctx.unitId);
        await this.holdsStock(tx, unitId);
        if (input.closedOn !== addisToday())
            throw fieldError('closedOn', 'not_today', 'a count is of today: what the office holds now');
        const held = await tx
            .select({ series: stationeryItems.series, serial: stationeryItems.serial, key: stationeryItems.itemKey })
            .from(stationeryItems)
            .where(
                and(
                    eq(stationeryItems.regionId, regionId),
                    eq(stationeryItems.holderUnitId, unitId),
                    eq(stationeryItems.kind, input.kind),
                    eq(stationeryItems.status, 'in_stock')
                )
            )
            .orderBy(asc(stationeryItems.series), asc(stationeryItems.serial));
        const counted = new Map<string, Serial>();
        for (const range of input.counted)
            for (const s of selectionSerials(range)) {
                if (counted.has(serialId(s))) throw fieldError('counted', 'overlap', 'two counted runs share a serial');
                counted.set(serialId(s), s);
            }
        const heldIds = new Set(held.map(serialId));
        const missing = held.filter((h) => !counted.has(serialId(h))).map((h) => h.key);
        const strays = [...counted.values()].filter((s) => !heldIds.has(serialId(s)));
        // a stray's printed key, when the region has the item (in whatever status or holder)
        const known = strays.length
            ? await tx
                  .select({
                      series: stationeryItems.series,
                      serial: stationeryItems.serial,
                      key: stationeryItems.itemKey
                  })
                  .from(stationeryItems)
                  .where(
                      and(
                          eq(stationeryItems.regionId, regionId),
                          eq(stationeryItems.kind, input.kind),
                          or(
                              ...strays
                                  .slice(0, LISTED)
                                  .map((s) =>
                                      and(eq(stationeryItems.series, s.series), eq(stationeryItems.serial, s.serial))
                                  )
                          )
                      )
                  )
            : [];
        const keyByid = new Map(known.map((k) => [serialId(k), k.key]));
        const unexpected = strays.map((s) => keyByid.get(serialId(s)) ?? keyOf(s));
        const row = await guardUnique(() =>
            insertAudited(tx, stationeryClosings, {
                regionId,
                unitId,
                kind: input.kind,
                closedOn: input.closedOn,
                expected: held.length,
                counted: counted.size,
                missingKeys: missing.slice(0, LISTED),
                missingCount: missing.length,
                unexpectedKeys: unexpected.slice(0, LISTED),
                unexpectedCount: unexpected.length,
                note: input.note ?? null
            })
        );
        return this.closingOf(tx, row);
    }

    async closings(tx: Tx, ctx: DbContext, kind?: StationeryKind, limit = 30): Promise<StationeryClosing[]> {
        const rows = await tx
            .select()
            .from(stationeryClosings)
            .where(
                and(
                    eq(stationeryClosings.regionId, required(ctx.regionId)),
                    eq(stationeryClosings.unitId, required(ctx.unitId)),
                    kind ? eq(stationeryClosings.kind, kind) : undefined
                )
            )
            .orderBy(desc(stationeryClosings.closedOn), desc(stationeryClosings.id))
            .limit(limit);
        return Promise.all(rows.map((r) => this.closingOf(tx, r)));
    }

    /**
     * A unit's counts of one kind and those of the units directly below it, each with its ledger: what a unit took in
     * (received, plus allocated to it, less recalled from it) is what it holds in any status plus what is below it, and what
     * it handed down (less what it took back) is what is below it; deliveries received directly further down count on both
     * sides. Within the acting unit's subtree only.
     */
    async summary(tx: Tx, ctx: DbContext, kind: StationeryKind, unitId?: string): Promise<StationerySummary> {
        const regionId = required(ctx.regionId);
        const unit = await getUnit(tx, unitId ?? required(ctx.unitId));
        if (unit.regionId !== regionId || !withinScope(unit.path, ctx.scopePath ?? '')) throw new NotFoundError();
        const subtree = await tx
            .select({ id: orgUnits.id, path: orgUnits.path, parentId: orgUnits.parentId })
            .from(orgUnits)
            .where(and(eq(orgUnits.regionId, regionId), sql`${orgUnits.path} <@ ${unit.path}::ltree`));
        const held = await tx
            .select({
                holder: stationeryItems.holderUnitId,
                status: stationeryItems.status,
                n: sql<number>`count(*)::int`
            })
            .from(stationeryItems)
            .where(
                and(
                    eq(stationeryItems.regionId, regionId),
                    eq(stationeryItems.kind, kind),
                    sql`${stationeryItems.holderOrgPath} <@ ${unit.path}::ltree`
                )
            )
            .groupBy(stationeryItems.holderUnitId, stationeryItems.status);
        const ledger = await tx
            .select({
                movement: stationeryMovements.movement,
                unitId: stationeryMovements.unitId,
                from: stationeryMovements.fromUnitId,
                to: stationeryMovements.toUnitId,
                n: sql<number>`sum(${stationeryMovements.quantity})::int`
            })
            .from(stationeryMovements)
            .where(
                and(
                    eq(stationeryMovements.regionId, regionId),
                    eq(stationeryMovements.kind, kind),
                    sql`${stationeryMovements.orgPath} <@ ${unit.path}::ltree`
                )
            )
            .groupBy(
                stationeryMovements.movement,
                stationeryMovements.unitId,
                stationeryMovements.fromUnitId,
                stationeryMovements.toUnitId
            );
        const children = subtree.filter((u) => u.parentId === unit.id).map((u) => u.id);
        const lastClosings = await tx
            .selectDistinctOn([stationeryClosings.unitId], {
                unitId: stationeryClosings.unitId,
                closedOn: stationeryClosings.closedOn,
                missing: stationeryClosings.missingCount,
                unexpected: stationeryClosings.unexpectedCount
            })
            .from(stationeryClosings)
            .where(
                and(
                    eq(stationeryClosings.regionId, regionId),
                    eq(stationeryClosings.kind, kind),
                    inArray(stationeryClosings.unitId, [unit.id, ...children])
                )
            )
            .orderBy(stationeryClosings.unitId, desc(stationeryClosings.closedOn));

        const pathOf = new Map(subtree.map((u) => [u.id, u.path]));
        const below = (of: string, path: string) =>
            held
                .filter((h) => h.holder !== of && (pathOf.get(h.holder) ?? '').startsWith(`${path}.`))
                .reduce((sum, h) => sum + h.n, 0);
        const heldBy = (of: string, status: StationeryStatus) =>
            held.filter((h) => h.holder === of && h.status === status).reduce((sum, h) => sum + h.n, 0);
        const sumOf = (pick: (l: (typeof ledger)[number]) => boolean) =>
            ledger.filter(pick).reduce((sum, l) => sum + l.n, 0);
        const refs = await unitRefs(tx, [unit.id, ...children]);
        const holds = new Map<string, boolean>();
        for (const id of [unit.id, ...children])
            holds.set(id, (await describeUnit(tx, await getUnit(tx, id))).capabilities.includes(STATIONERY_CAPABILITY));
        const closingOf = new Map(lastClosings.map((c) => [c.unitId, c]));

        const rowOf = (id: string): StationerySummaryRow => {
            const path = pathOf.get(id) ?? '';
            const statuses = {
                inStock: heldBy(id, 'in_stock'),
                inTransit: heldBy(id, 'allocated'),
                used: heldBy(id, 'used'),
                spoiled: heldBy(id, 'spoiled'),
                void: heldBy(id, 'void'),
                missing: heldBy(id, 'missing')
            };
            const allocatedDown = below(id, path);
            const received =
                sumOf((l) => l.movement === 'receive' && l.unitId === id) +
                sumOf((l) => l.movement === 'allocate' && l.to === id) -
                sumOf((l) => l.movement === 'recall' && l.from === id);
            const handedDown =
                sumOf((l) => l.movement === 'allocate' && l.from === id) -
                sumOf((l) => l.movement === 'recall' && l.to === id);
            const receivedBelow = sumOf(
                (l) => l.movement === 'receive' && (pathOf.get(l.unitId) ?? '').startsWith(`${path}.`)
            );
            const holding = Object.values(statuses).reduce((a, b) => a + b, 0);
            const last = closingOf.get(id);
            return {
                unit: refs.get(id) ?? emptyRef(id),
                holdsStationery: holds.get(id) ?? false,
                received,
                ...statuses,
                allocatedDown,
                ledger: { received, allocatedDown: handedDown },
                reconciled:
                    received + receivedBelow === holding + allocatedDown &&
                    handedDown + receivedBelow === allocatedDown,
                lastClosing: last
                    ? { closedOn: last.closedOn, balanced: last.missing === 0 && last.unexpected === 0 }
                    : null
            };
        };
        return { kind, unit: rowOf(unit.id), children: children.map(rowOf) };
    }

    /** Items: one by its serial anywhere in the region, else a unit's (the acting one's by default). */
    async list(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof stationeryListQuerySchema>
    ): Promise<{ items: StationeryItem[]; nextCursor: string | null }> {
        const query = checked(stationeryListQuerySchema, given);
        const regionId = required(ctx.regionId);
        const conditions: (SQL | undefined)[] = [eq(stationeryItems.regionId, regionId)];
        if (query.q) {
            const parsed = parseStationeryKey(query.q);
            conditions.push(
                parsed
                    ? and(eq(stationeryItems.series, parsed.series), eq(stationeryItems.serial, parsed.serial))
                    : sql`false`
            );
        } else {
            const holderUnitId = query.holderUnitId ?? required(ctx.unitId);
            if (query.holderUnitId) {
                const holder = await getUnit(tx, holderUnitId).catch(() => undefined);
                if (!holder || holder.regionId !== regionId || !withinScope(holder.path, ctx.scopePath ?? ''))
                    throw new NotFoundError();
            }
            conditions.push(eq(stationeryItems.holderUnitId, holderUnitId));
        }
        if (query.kind) conditions.push(eq(stationeryItems.kind, query.kind));
        if (query.variant) conditions.push(eq(stationeryItems.variant, query.variant));
        if (query.status) conditions.push(eq(stationeryItems.status, query.status));
        if (query.after) conditions.push(gt(stationeryItems.itemKey, query.after));
        const rows = await tx
            .select()
            .from(stationeryItems)
            .where(and(...conditions))
            .orderBy(asc(stationeryItems.itemKey))
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        const refs = await unitRefs(
            tx,
            page.map((r) => r.holderUnitId)
        );
        return {
            items: page.map((r) => this.itemOf(r, refs.get(r.holderUnitId) ?? emptyRef(r.holderUnitId))),
            nextCursor: rows.length > query.limit ? (page[page.length - 1]?.itemKey ?? null) : null
        };
    }

    /** The ledger the acting unit sees (its subtree's), newest first. */
    async movements(
        tx: Tx,
        ctx: DbContext,
        given: z.input<typeof stationeryMovementListQuerySchema>
    ): Promise<{ items: StationeryMovement[]; nextCursor: string | null }> {
        const query = checked(stationeryMovementListQuerySchema, given);
        const conditions: (SQL | undefined)[] = [
            eq(stationeryMovements.regionId, required(ctx.regionId)),
            query.kind ? eq(stationeryMovements.kind, query.kind) : undefined,
            query.unitId ? eq(stationeryMovements.unitId, query.unitId) : undefined,
            query.movement ? eq(stationeryMovements.movement, query.movement) : undefined,
            query.after ? lt(stationeryMovements.id, query.after) : undefined
        ];
        const rows = await tx
            .select()
            .from(stationeryMovements)
            .where(and(...conditions))
            .orderBy(desc(stationeryMovements.id))
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        return {
            items: await this.movementsOf(tx, page),
            nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null
        };
    }

    async movement(tx: Tx, id: string): Promise<StationeryMovement> {
        const [row] = await tx.select().from(stationeryMovements).where(eq(stationeryMovements.id, id));
        if (!row) throw new NotFoundError();
        return this.movementOf(tx, row);
    }

    async batches(tx: Tx, ctx: DbContext, kind?: StationeryKind): Promise<StationeryBatch[]> {
        const rows = await tx
            .select()
            .from(stationeryBatches)
            .where(
                and(
                    eq(stationeryBatches.regionId, required(ctx.regionId)),
                    kind ? eq(stationeryBatches.kind, kind) : undefined
                )
            )
            .orderBy(desc(stationeryBatches.receivedOn), desc(stationeryBatches.id))
            .limit(200);
        return Promise.all(rows.map((b) => this.batchOf(tx, b)));
    }

    // ---- the parts the commands share

    /** The unit holds stationery (its type's capability), else 403 (or a field error for the unit a command names). */
    private async holdsStock(tx: Tx, unitId: string, field?: string): Promise<void> {
        const unit = await describeUnit(tx, await getUnit(tx, unitId));
        if (unit.capabilities.includes(STATIONERY_CAPABILITY)) return;
        if (field) throw fieldError(field, 'no_stationery', 'does not hold stationery');
        throw new ForbiddenError({ detailKey: 'fees.errors.no_stationery' });
    }

    /** Stock moves one level at a time, so each level's ledger adds up. */
    private async directChild(tx: Tx, parentId: string, childId: string, field: string): Promise<void> {
        const child = await getUnit(tx, childId).catch(() => undefined);
        if (child?.parentId !== parentId)
            throw fieldError(field, 'not_child_unit', 'is not a unit directly below this one');
    }

    private serialOf(key: string): string {
        const parsed = parseStationeryKey(key);
        return parsed ? serialId(parsed) : key;
    }

    /** One item of the acting office's stock, locked: the one named, or the next free one of the kind (and variant). */
    private async lockOne(
        tx: Tx,
        regionId: string,
        unitId: string,
        kind: StationeryKind,
        key?: string,
        variant?: string
    ): Promise<ItemRow> {
        let item: ItemRow | undefined;
        if (key) {
            const parsed = parseStationeryKey(key);
            if (!parsed) throw fieldError('key', 'invalid_serial', 'is not a serial');
            [item] = await tx
                .select()
                .from(stationeryItems)
                .where(
                    and(
                        eq(stationeryItems.regionId, regionId),
                        eq(stationeryItems.kind, kind),
                        eq(stationeryItems.series, parsed.series),
                        eq(stationeryItems.serial, parsed.serial)
                    )
                )
                .for('update');
            if (!item || item.holderUnitId !== unitId || item.status !== 'in_stock') throw notAvailable([parsed.key]);
            if (variant && item.variant !== variant) throw notAvailable([parsed.key]);
        } else {
            [item] = await tx
                .select()
                .from(stationeryItems)
                .where(
                    and(
                        eq(stationeryItems.regionId, regionId),
                        eq(stationeryItems.holderUnitId, unitId),
                        eq(stationeryItems.kind, kind),
                        eq(stationeryItems.status, 'in_stock'),
                        variant ? eq(stationeryItems.variant, variant) : undefined
                    )
                )
                .orderBy(asc(stationeryItems.series), asc(stationeryItems.serial))
                .limit(1)
                .for('update', { skipLocked: true });
            if (!item) throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.no_free_stationery' });
        }
        return item;
    }

    /** The items a selection names, locked in series and serial order; every one of them must be in the stock. */
    private async lockSelection(
        tx: Tx,
        regionId: string,
        kind: StationeryKind,
        selection: StationerySelection
    ): Promise<ItemRow[]> {
        const serials = selectionSerials(selection);
        const where =
            'keys' in selection
                ? and(
                      eq(stationeryItems.regionId, regionId),
                      eq(stationeryItems.kind, kind),
                      or(
                          ...serials.map((s) =>
                              and(eq(stationeryItems.series, s.series), eq(stationeryItems.serial, s.serial))
                          )
                      )
                  )
                : and(
                      eq(stationeryItems.regionId, regionId),
                      eq(stationeryItems.kind, kind),
                      eq(stationeryItems.series, selection.series),
                      sql`${stationeryItems.serial} between ${selection.from} and ${selection.to}`
                  );
        const rows = await tx
            .select()
            .from(stationeryItems)
            .where(where)
            .orderBy(asc(stationeryItems.series), asc(stationeryItems.serial))
            .for('update');
        if (rows.length !== serials.length) {
            const found = new Set(rows.map(serialId));
            throw notAvailable(serials.filter((s) => !found.has(serialId(s))).map(keyOf));
        }
        return rows;
    }

    /** The same change to every item (each audited); each must still be at the version it was locked at. */
    private async move(
        tx: Tx,
        rows: readonly ItemRow[],
        changes: Partial<typeof stationeryItems.$inferInsert>
    ): Promise<void> {
        await updateManyAudited(
            tx,
            stationeryItems,
            rows.map((r) => r.id),
            { statusOn: addisToday(), ...changes },
            new Map(rows.map((r) => [r.id, r.rowVersion]))
        );
    }

    private async record(
        tx: Tx,
        m: {
            regionId: string;
            unitId: string;
            kind: StationeryKind;
            movement: MovementRow['movement'];
            /** in series and serial order (the order the items were locked in) */
            keys: readonly string[];
            occurredOn: string;
            fromUnitId?: string;
            toUnitId?: string;
            batchId?: string;
            ofMovementId?: string;
            caseId?: string;
            reason?: string;
            note?: string;
        }
    ): Promise<MovementRow> {
        const sorted = m.keys;
        return insertAudited(tx, stationeryMovements, {
            regionId: m.regionId,
            unitId: m.unitId,
            kind: m.kind,
            movement: m.movement,
            fromUnitId: m.fromUnitId ?? null,
            toUnitId: m.toUnitId ?? null,
            batchId: m.batchId ?? null,
            ofMovementId: m.ofMovementId ?? null,
            quantity: sorted.length,
            firstKey: sorted[0] ?? '',
            lastKey: sorted[sorted.length - 1] ?? '',
            caseId: m.caseId ?? null,
            occurredOn: m.occurredOn,
            reason: m.reason ?? null,
            note: m.note ?? null
        });
    }

    private itemOf(r: ItemRow, holder: UnitRef): StationeryItem {
        return {
            id: r.id,
            kind: r.kind,
            variant: r.variant,
            validEfy: r.validEfy,
            key: r.itemKey,
            series: r.series,
            serial: r.serial,
            status: r.status,
            statusOn: r.statusOn,
            holder,
            usedFor: r.usedForTable && r.usedForId ? { table: r.usedForTable, id: r.usedForId } : null,
            caseId: r.caseId,
            endReason: r.endReason
        };
    }

    private async movementOf(tx: Tx, row: MovementRow): Promise<StationeryMovement> {
        const [one] = await this.movementsOf(tx, [row]);
        if (!one) throw new NotFoundError();
        return one;
    }

    private async movementsOf(tx: Tx, rows: readonly MovementRow[]): Promise<StationeryMovement[]> {
        const refs = await unitRefs(
            tx,
            rows.flatMap((r) => [r.unitId, r.fromUnitId, r.toUnitId])
        );
        const allocations = rows.filter((r) => r.movement === 'allocate').map((r) => r.id);
        const waiting = allocations.length
            ? await tx
                  .select({ of: stationeryItems.lastMovementId, n: sql<number>`count(*)::int` })
                  .from(stationeryItems)
                  .where(
                      and(inArray(stationeryItems.lastMovementId, allocations), eq(stationeryItems.status, 'allocated'))
                  )
                  .groupBy(stationeryItems.lastMovementId)
            : [];
        const awaiting = new Map(waiting.map((w) => [w.of, w.n]));
        const ref = (id: string | null) => (id ? (refs.get(id) ?? emptyRef(id)) : null);
        return rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            movement: r.movement,
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
            awaiting: r.movement === 'allocate' ? (awaiting.get(r.id) ?? 0) : null
        }));
    }

    private async batchOf(tx: Tx, row: typeof stationeryBatches.$inferSelect): Promise<StationeryBatch> {
        const refs = await unitRefs(tx, [row.receivingUnitId]);
        return {
            id: row.id,
            kind: row.kind,
            source: row.source,
            variant: row.variant,
            validEfy: row.validEfy,
            unitCostSantim: row.unitCostSantim === null ? null : row.unitCostSantim.toString(),
            reference: row.reference,
            receivedOn: row.receivedOn,
            receivingUnit: refs.get(row.receivingUnitId) ?? emptyRef(row.receivingUnitId),
            quantity: row.quantity,
            firstKey: row.firstKey,
            lastKey: row.lastKey,
            note: row.note
        };
    }

    private async closingOf(tx: Tx, row: typeof stationeryClosings.$inferSelect): Promise<StationeryClosing> {
        const refs = await unitRefs(tx, [row.unitId]);
        return {
            id: row.id,
            kind: row.kind,
            unit: refs.get(row.unitId) ?? emptyRef(row.unitId),
            closedOn: row.closedOn,
            expected: row.expected,
            counted: row.counted,
            missing: row.missingKeys,
            missingCount: row.missingCount,
            unexpected: row.unexpectedKeys,
            unexpectedCount: row.unexpectedCount,
            balanced: row.missingCount === 0 && row.unexpectedCount === 0,
            note: row.note
        };
    }
}
