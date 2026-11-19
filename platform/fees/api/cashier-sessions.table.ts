/**
 * Cashier sessions and the daily closing (task 1.12, ADR-0063; contracts/cashier-sessions.ts).
 *
 *   cashier_sessions        one cashier at one office on one business day: opened with a float or by the first payment, its
 *                           figures frozen by the first count, closed by a balanced or an approved count (class T at the
 *                           office). Moves, frozen columns and the closed state are checked by triggers (migration 0094).
 *   cashier_session_counts  every count of the till: a balanced one closes the session; one with a difference waits for
 *                           another person's decision, and a rejected one is followed by a new count (class T; only the
 *                           decision changes, once).
 *
 * A payment names its session (`payments.session_id`, a key on the session's cashier and office); the checks, the keys and the
 * triggers are written by hand in the migration.
 */
import { sql } from 'drizzle-orm';
import {
    bigint,
    date,
    index,
    integer,
    jsonb,
    smallint,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';

import type { CountState, SessionState } from '../contracts/cashier-sessions';
import { feesSchema } from './fees.table';

export const cashierSessions = withRls(
    audited(
        feesSchema.table(
            'cashier_sessions',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                handlingUnitId: uuid('handling_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the handling unit */
                orgPath: ltree('org_path').notNull().default(''),
                cashierId: uuid('cashier_id').notNull(),
                /** the Africa/Addis_Ababa day (Gregorian in storage) */
                businessDay: date('business_day').notNull(),
                openingFloatSantim: bigint('opening_float_santim', { mode: 'bigint' })
                    .notNull()
                    .default(sql`0`),
                openedVia: text('opened_via').$type<'explicit' | 'payment'>().notNull(),
                state: text('state').$type<SessionState>().notNull().default('open'),
                /** the first count freezes these (null while the session is open) */
                tillClosedAt: timestamp('till_closed_at', { withTimezone: true }),
                cashReceiptsSantim: bigint('cash_receipts_santim', { mode: 'bigint' }),
                bankSlipSantim: bigint('bank_slip_santim', { mode: 'bigint' }),
                receiptCount: integer('receipt_count'),
                expectedCashSantim: bigint('expected_cash_santim', { mode: 'bigint' }),
                /** the count that closed it (the key is in the migration) */
                closingCountId: uuid('closing_count_id'),
                closedAt: timestamp('closed_at', { withTimezone: true })
            },
            (t) => [
                unique('cashier_sessions_id_cashier_unit_uq').on(t.id, t.cashierId, t.handlingUnitId),
                // one open session per cashier, office and day
                uniqueIndex('cashier_sessions_open_uq')
                    .on(t.handlingUnitId, t.cashierId, t.businessDay)
                    .where(sql`state = 'open'`),
                index('cashier_sessions_unit_idx').on(t.handlingUnitId, t.state, t.businessDay),
                index('cashier_sessions_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const cashierSessionCounts = withRls(
    audited(
        feesSchema.table(
            'cashier_session_counts',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                handlingUnitId: uuid('handling_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the handling unit */
                orgPath: ltree('org_path').notNull().default(''),
                sessionId: uuid('session_id')
                    .notNull()
                    .references(() => cashierSessions.id),
                attempt: smallint('attempt').notNull(),
                /** the session's cashier (copied: the separation of duties is checked on the row) */
                cashierId: uuid('cashier_id').notNull(),
                countedSantim: bigint('counted_santim', { mode: 'bigint' }).notNull(),
                denominations: jsonb('denominations').$type<{ valueSantim: number; count: number }[]>(),
                expectedSantim: bigint('expected_santim', { mode: 'bigint' }).notNull(),
                differenceSantim: bigint('difference_santim', { mode: 'bigint' }).notNull(),
                note: text('note'),
                countedBy: uuid('counted_by').notNull(),
                state: text('state').$type<CountState>().notNull(),
                decidedBy: uuid('decided_by'),
                decidedAt: timestamp('decided_at', { withTimezone: true }),
                decisionNote: text('decision_note')
            },
            (t) => [
                unique('cashier_session_counts_attempt_uq').on(t.sessionId, t.attempt),
                unique('cashier_session_counts_id_session_uq').on(t.id, t.sessionId),
                // one count waits for a decision at a time
                uniqueIndex('cashier_session_counts_pending_uq')
                    .on(t.sessionId)
                    .where(sql`state = 'pending'`),
                index('cashier_session_counts_inbox_idx')
                    .on(t.state, t.createdAt)
                    .where(sql`state = 'pending'`),
                index('cashier_session_counts_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);
