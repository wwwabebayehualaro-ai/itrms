/**
 * The remittance (task 1.12d, ADR-0063 §5; contracts/remittances.ts).
 *
 *   remittances          the office's deposit of the closed sessions up to a day: the totals, the number from the office's counter,
 *                        and, once recorded, the bank deposit slip (class T at the office). Only the deposit fields change, once.
 *   remittance_sessions  the closed sessions it covers; a session is on one remittance only (append-only).
 *   remittance_lines     the frozen copies: a line per order line of each receipt, under the finance bureau's account code, and
 *                        a negative line per order line of a receipt reversed after the till was counted (append-only).
 *
 * A deferred check in the database keeps the total equal to the receipts of the covered sessions less those reversals
 * (migration 0095); the checks, the keys and the triggers are written by hand there.
 */
import { sql } from 'drizzle-orm';
import {
    bigint,
    boolean,
    date,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import type { I18nText } from '@itrms/schemas';

import type { RemittanceLineKind, RemittanceState } from '../contracts/remittances';
import { cashierSessions } from './cashier-sessions.table';
import { feesSchema, receiptReversals, receipts } from './fees.table';

const handled = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    orgPath: ltree('org_path').notNull().default('')
});

export const remittances = withRls(
    audited(
        feesSchema.table(
            'remittances',
            {
                ...baseColumns(),
                ...handled(),
                /** `WOL-BODITI/RM/00001/2019` (the office's counter `fees.remittance`) */
                number: text('number').notNull(),
                fiscalYear: integer('fiscal_year').notNull(),
                sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
                /** the earliest business day covered, and the day it was prepared up to */
                periodFrom: date('period_from').notNull(),
                periodTo: date('period_to').notNull(),
                state: text('state').$type<RemittanceState>().notNull().default('prepared'),
                revenueTotalSantim: bigint('revenue_total_santim', { mode: 'bigint' }).notNull(),
                cashSantim: bigint('cash_santim', { mode: 'bigint' }).notNull(),
                bankSlipSantim: bigint('bank_slip_santim', { mode: 'bigint' }).notNull(),
                /** the reversals after the till closed: zero or less (Finance refunds them) */
                reversalSantim: bigint('reversal_santim', { mode: 'bigint' }).notNull(),
                /** counted less expected over the covered sessions (signed) */
                differenceSantim: bigint('difference_santim', { mode: 'bigint' }).notNull(),
                /** the counted cash less the floats that stay in the tills: what goes to the bank */
                depositDueSantim: bigint('deposit_due_santim', { mode: 'bigint' }).notNull(),
                preparedBy: uuid('prepared_by').notNull(),
                preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
                depositBank: text('deposit_bank'),
                depositReference: text('deposit_reference'),
                /** the reference compared: upper case, without spaces */
                depositReferenceNorm: text('deposit_reference_norm'),
                depositedOn: date('deposited_on'),
                depositedAmountSantim: bigint('deposited_amount_santim', { mode: 'bigint' }),
                depositedBy: uuid('deposited_by'),
                depositedAt: timestamp('deposited_at', { withTimezone: true }),
                /** the accounts are placeholders (the region's setting says so) */
                demo: boolean('demo').notNull()
            },
            (t) => [
                unique('remittances_id_unit_uq').on(t.id, t.handlingUnitId),
                uniqueIndex('remittances_sequence_uq').on(t.handlingUnitId, t.fiscalYear, t.sequence),
                uniqueIndex('remittances_number_uq').on(t.handlingUnitId, t.number),
                uniqueIndex('remittances_deposit_reference_uq')
                    .on(t.handlingUnitId, t.depositReferenceNorm)
                    .where(sql`deposit_reference_norm IS NOT NULL`),
                index('remittances_unit_idx').on(t.handlingUnitId, t.state, t.createdAt),
                index('remittances_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const remittanceSessions = withRls(
    audited(
        feesSchema.table(
            'remittance_sessions',
            {
                ...baseColumns(),
                ...handled(),
                remittanceId: uuid('remittance_id').notNull(),
                sessionId: uuid('session_id')
                    .notNull()
                    .references(() => cashierSessions.id)
            },
            (t) => [
                // a session is remitted at most once (the backstop of two prepares at once)
                uniqueIndex('remittance_sessions_session_uq').on(t.sessionId),
                index('remittance_sessions_remittance_idx').on(t.remittanceId),
                index('remittance_sessions_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const remittanceLines = withRls(
    audited(
        feesSchema.table(
            'remittance_lines',
            {
                ...baseColumns(),
                ...handled(),
                remittanceId: uuid('remittance_id').notNull(),
                kind: text('kind').$type<RemittanceLineKind>().notNull(),
                receiptId: uuid('receipt_id')
                    .notNull()
                    .references(() => receipts.id),
                /** the reversal a negative line is of; none for a receipt's line */
                reversalId: uuid('reversal_id').references(() => receiptReversals.id),
                orderLinePosition: integer('order_line_position').notNull(),
                lineKey: text('line_key').notNull(),
                /** the finance bureau's account, as the setting named it when this was prepared */
                accountCode: text('account_code').notNull(),
                budgetCategory: text('budget_category').notNull(),
                accountName: jsonb('account_name').$type<I18nText>().notNull(),
                /** the line has no account of its own in the setting: the default account took it */
                mappedByDefault: boolean('mapped_by_default').notNull(),
                paymentMethod: text('payment_method').$type<'cash' | 'bank_slip'>().notNull(),
                /** positive for a receipt, negative for a reversal after the till closed */
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull()
            },
            (t) => [
                uniqueIndex('remittance_lines_receipt_uq')
                    .on(t.receiptId, t.orderLinePosition)
                    .where(sql`kind = 'receipt'`),
                uniqueIndex('remittance_lines_reversal_uq')
                    .on(t.reversalId, t.orderLinePosition)
                    .where(sql`kind = 'reversal'`),
                index('remittance_lines_remittance_idx').on(t.remittanceId),
                index('remittance_lines_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);
