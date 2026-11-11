/**
 * Controlled stationery (task 1.12a; contracts/stationery.ts, architecture.md §9, ADR-0050).
 *
 *   stationery_batches    a delivery taken in by a unit (class T of the receiving unit; insert-only).
 *   stationery_items      one pre-printed, serial-numbered form: who holds it and where it is in its life (class R of its
 *                         holder: the region finds a serial, the holder's line writes it). Unique per region, kind, series
 *                         and serial.
 *   stationery_movements  the ledger: one row per command, however many items it moved (class T; insert-only).
 *   stationery_closings   an office's count of one kind on one day, with what it found missing (class T; insert-only).
 *
 * The transitions are checked by a trigger as well (migration 0068), whatever the writer.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';

import {
    STATIONERY_END_REASONS,
    STATIONERY_KINDS,
    STATIONERY_MOVEMENT_KINDS,
    STATIONERY_SOURCES,
    STATIONERY_STATUSES
} from '../contracts/stationery';
import { feesSchema } from './fees.table';

const oneOf = (values: readonly string[]) => sql.raw(`(${values.map((v) => `'${v}'`).join(', ')})`);

export const stationeryBatches = withRls(
    audited(
        feesSchema.table(
            'stationery_batches',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                receivingUnitId: uuid('receiving_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the receiving unit */
                orgPath: ltree('org_path').notNull().default(''),
                kind: text('kind', { enum: STATIONERY_KINDS }).notNull(),
                source: text('source', { enum: STATIONERY_SOURCES }).notNull(),
                reference: text('reference').notNull(),
                receivedOn: date('received_on').notNull(),
                variant: text('variant'),
                validEfy: smallint('valid_efy'),
                /** what one item cost (the bureau's price list), santim (ADR-0014) */
                unitCostSantim: bigint('unit_cost_santim', { mode: 'bigint' }),
                quantity: integer('quantity').notNull(),
                firstKey: text('first_key').notNull(),
                lastKey: text('last_key').notNull(),
                note: text('note')
            },
            (t) => [
                uniqueIndex('stationery_batches_reference_uq').on(t.regionId, t.kind, t.reference),
                index('stationery_batches_org_path_gist').using('gist', t.orgPath),
                check('stationery_batches_kind_check', sql`${t.kind} in ${oneOf(STATIONERY_KINDS)}`),
                check('stationery_batches_source_check', sql`${t.source} in ${oneOf(STATIONERY_SOURCES)}`),
                check(
                    'stationery_batches_variant_check',
                    sql`(${t.variant} is null or ${t.variant} ~ '^[a-z0-9_]{1,20}$') and (${t.validEfy} is null or ${t.validEfy} between 2000 and 2100) and (${t.unitCostSantim} is null or ${t.unitCostSantim} >= 0)`
                ),
                check('stationery_batches_quantity_check', sql`${t.quantity} between 1 and 10000`),
                check(
                    'stationery_batches_text_check',
                    sql`length(${t.reference}) between 1 and 60 and coalesce(length(${t.note}), 0) <= 500`
                )
            ]
        )
    ),
    'transaction'
);

export const stationeryItems = withRls(
    audited(
        feesSchema.table(
            'stationery_items',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                holderUnitId: uuid('holder_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the holder unit */
                holderOrgPath: ltree('holder_org_path').notNull().default(''),
                batchId: uuid('batch_id')
                    .notNull()
                    .references(() => stationeryBatches.id),
                kind: text('kind', { enum: STATIONERY_KINDS }).notNull(),
                /** copied from the batch: what the item is printed for, and the year it is valid for */
                variant: text('variant'),
                validEfy: smallint('valid_efy'),
                series: text('series').notNull(),
                serial: integer('serial').notNull(),
                /** the serial as printed: the series and the zero-padded number */
                itemKey: text('item_key').notNull(),
                width: smallint('width').notNull(),
                status: text('status', { enum: STATIONERY_STATUSES }).notNull().default('in_stock'),
                statusOn: date('status_on').notNull(),
                /** what used it (`competency.licence_print_batch_items`, `vehicles.libres` …) */
                usedForTable: text('used_for_table'),
                usedForId: uuid('used_for_id'),
                caseId: uuid('case_id'),
                endReason: text('end_reason', { enum: STATIONERY_END_REASONS }),
                note: text('note'),
                /** the movement that last moved it (an allocation it waits on is how the unit below accepts it) */
                lastMovementId: uuid('last_movement_id')
            },
            (t) => [
                uniqueIndex('stationery_items_serial_uq').on(t.regionId, t.kind, t.series, t.serial),
                uniqueIndex('stationery_items_used_for_uq')
                    .on(t.kind, t.usedForTable, t.usedForId)
                    .where(sql`used_for_id is not null`),
                // the next free item of a unit, its counts and its runs
                index('stationery_items_holder_status_idx').on(
                    t.regionId,
                    t.holderUnitId,
                    t.kind,
                    t.status,
                    t.variant,
                    t.series,
                    t.serial
                ),
                index('stationery_items_holder_gist').using('gist', t.holderOrgPath),
                index('stationery_items_last_movement_idx').on(t.lastMovementId),
                index('stationery_items_key_idx').on(t.regionId, t.itemKey),
                check('stationery_items_kind_check', sql`${t.kind} in ${oneOf(STATIONERY_KINDS)}`),
                check('stationery_items_status_check', sql`${t.status} in ${oneOf(STATIONERY_STATUSES)}`),
                check(
                    'stationery_items_key_check',
                    sql`${t.series} ~ '^[A-Z]{0,6}$' and ${t.serial} between 1 and 99999999 and ${t.width} between 1 and 8 and ${t.itemKey} = ${t.series} || lpad(${t.serial}::text, ${t.width}, '0')`
                ),
                check(
                    'stationery_items_used_check',
                    sql`(${t.status} = 'used') = (${t.usedForId} is not null and ${t.usedForTable} is not null)`
                ),
                check(
                    'stationery_items_end_check',
                    sql`(${t.endReason} is null) = (${t.status} not in ('spoiled', 'void', 'missing')) and (${t.endReason} is null or ${t.endReason} in ${oneOf(STATIONERY_END_REASONS)})`
                ),
                check('stationery_items_note_check', sql`coalesce(length(${t.note}), 0) <= 500`)
            ]
        )
    ),
    'registry',
    'holder_org_path'
);

export const stationeryMovements = withRls(
    audited(
        feesSchema.table(
            'stationery_movements',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** the lower unit of the movement (the child of an allocation or a recall, else the holder) */
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                kind: text('kind', { enum: STATIONERY_KINDS }).notNull(),
                movement: text('movement', { enum: STATIONERY_MOVEMENT_KINDS }).notNull(),
                fromUnitId: uuid('from_unit_id').references(() => orgUnits.id),
                toUnitId: uuid('to_unit_id').references(() => orgUnits.id),
                batchId: uuid('batch_id').references(() => stationeryBatches.id),
                /** an acceptance: the allocation it accepts */
                ofMovementId: uuid('of_movement_id'),
                quantity: integer('quantity').notNull(),
                firstKey: text('first_key').notNull(),
                lastKey: text('last_key').notNull(),
                caseId: uuid('case_id'),
                occurredOn: date('occurred_on').notNull(),
                reason: text('reason'),
                note: text('note')
            },
            (t) => [
                index('stationery_movements_org_path_gist').using('gist', t.orgPath),
                index('stationery_movements_unit_idx').on(t.regionId, t.unitId, t.kind, t.movement),
                index('stationery_movements_of_idx').on(t.ofMovementId),
                check('stationery_movements_kind_check', sql`${t.kind} in ${oneOf(STATIONERY_KINDS)}`),
                check('stationery_movements_movement_check', sql`${t.movement} in ${oneOf(STATIONERY_MOVEMENT_KINDS)}`),
                check('stationery_movements_quantity_check', sql`${t.quantity} between 1 and 10000`),
                check(
                    'stationery_movements_units_check',
                    sql`(${t.movement} in ('allocate', 'recall')) = (${t.fromUnitId} is not null and ${t.toUnitId} is not null)`
                ),
                check(
                    'stationery_movements_batch_check',
                    sql`(${t.movement} = 'receive') = (${t.batchId} is not null)`
                ),
                check(
                    'stationery_movements_accept_check',
                    sql`(${t.movement} = 'accept') = (${t.ofMovementId} is not null)`
                ),
                check(
                    'stationery_movements_reason_check',
                    sql`(${t.movement} not in ('recall', 'write_off', 'spoil') or length(${t.reason}) >= 3) and coalesce(length(${t.reason}), 0) <= 500 and coalesce(length(${t.note}), 0) <= 500`
                )
            ]
        )
    ),
    'transaction'
);

export const stationeryClosings = withRls(
    audited(
        feesSchema.table(
            'stationery_closings',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                kind: text('kind', { enum: STATIONERY_KINDS }).notNull(),
                closedOn: date('closed_on').notNull(),
                expected: integer('expected').notNull(),
                counted: integer('counted').notNull(),
                missingKeys: text('missing_keys').array().notNull(),
                missingCount: integer('missing_count').notNull(),
                unexpectedKeys: text('unexpected_keys').array().notNull(),
                unexpectedCount: integer('unexpected_count').notNull(),
                note: text('note')
            },
            (t) => [
                uniqueIndex('stationery_closings_day_uq').on(t.unitId, t.kind, t.closedOn),
                index('stationery_closings_org_path_gist').using('gist', t.orgPath),
                check('stationery_closings_kind_check', sql`${t.kind} in ${oneOf(STATIONERY_KINDS)}`),
                check(
                    'stationery_closings_counts_check',
                    sql`${t.expected} >= 0 and ${t.counted} >= 0 and ${t.missingCount} >= cardinality(${t.missingKeys}) and ${t.unexpectedCount} >= cardinality(${t.unexpectedKeys}) and cardinality(${t.missingKeys}) <= 200 and cardinality(${t.unexpectedKeys}) <= 200`
                ),
                check('stationery_closings_note_check', sql`coalesce(length(${t.note}), 0) <= 500`)
            ]
        )
    ),
    'transaction'
);
