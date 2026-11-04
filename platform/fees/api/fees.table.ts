/**
 * Fee rules and the fees cases keep (architecture.md §9, ADR-0041; task 0.22a).
 *
 *   fee_rules            a rule by key, owned at the region's root (class C: every unit reads the bureau's rules; only the
 *                        root writes them).
 *   fee_rule_versions    immutable, content-hashed versions (class C). No UPDATE or DELETE: grants and a trigger refuse them.
 *   fee_rule_approvals   the decision on a version (maker-checker, SEC-AC-6): one per version, append-only; a service version
 *                        may name only an approved one.
 *   case_fees            the fee a case was assessed, append-only (class T at the handling unit): number 1 when the request
 *                        is filed, one more each time a correction changes it; the newest holds. 0.22b's payment order
 *                        reads it.
 *   case_fee_lines       its lines, in santim.
 *
 *   payment_orders …     an order to pay a case's fee, its payments, receipts and reversals (task 0.22b, below).
 *
 * Money is `bigint` santim (ADR-0014). The audit log holds a version's hash, never its content.
 */
import { sql } from 'drizzle-orm';
import {
    bigint,
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import type { I18nText } from '@itrms/schemas';

export const feesSchema = pgSchema('fees');

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

const handled = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    orgPath: ltree('org_path').notNull().default('')
});

export const feeRules = withRls(
    audited(
        feesSchema.table(
            'fee_rules',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<I18nText>().notNull(),
                active: boolean('active').notNull().default(true),
                /** the newest version */
                latestVersionId: uuid('latest_version_id').references((): AnyPgColumn => feeRuleVersions.id)
            },
            (t) => [
                uniqueIndex('fee_rules_key_uq').on(t.regionId, t.key),
                index('fee_rules_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const feeRuleVersions = withRls(
    audited(
        feesSchema.table(
            'fee_rule_versions',
            {
                ...baseColumns(),
                ...owned(),
                ruleId: uuid('rule_id')
                    .notNull()
                    .references(() => feeRules.id),
                /** 1, 2, 3 … per rule, in the order versions were stored */
                number: integer('number').notNull(),
                contentHash: text('content_hash').notNull(),
                /** the rule (FeeRule, schemaVersion 1) */
                document: jsonb('document').notNull(),
                /** its amounts are placeholders, not the regional schedule */
                demo: boolean('demo').notNull()
            },
            (t) => [
                uniqueIndex('fee_rule_versions_content_uq').on(t.ruleId, t.contentHash),
                uniqueIndex('fee_rule_versions_number_uq').on(t.ruleId, t.number),
                index('fee_rule_versions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['document'] }
    ),
    'config'
);

export const feeRuleApprovals = withRls(
    audited(
        feesSchema.table(
            'fee_rule_approvals',
            {
                ...baseColumns(),
                ...owned(),
                versionId: uuid('version_id')
                    .notNull()
                    .references(() => feeRuleVersions.id),
                decision: text('decision').$type<'approved' | 'rejected'>().notNull(),
                reason: text('reason'),
                /** who decided: never the version's author; null only for the installation's seed */
                decidedBy: uuid('decided_by')
            },
            (t) => [
                uniqueIndex('fee_rule_approvals_version_uq').on(t.versionId),
                index('fee_rule_approvals_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const caseFees = withRls(
    audited(
        feesSchema.table(
            'case_fees',
            {
                ...baseColumns(),
                ...handled(),
                /** the case (workflow.cases; the key is in the migration: this slice sits below the workflow's) */
                caseId: uuid('case_id').notNull(),
                number: integer('number').notNull(),
                reason: text('reason').$type<'filed' | 'amended'>().notNull(),
                feeRuleVersionId: uuid('fee_rule_version_id')
                    .notNull()
                    .references(() => feeRuleVersions.id),
                /** the service version's mapping of the rule's inputs to the form's keys, as it was used */
                inputMap: jsonb('input_map').$type<Record<string, string>>().notNull(),
                /** the day the fee counts to (Addis Ababa) */
                asOf: date('as_of').notNull(),
                /** the request it was worked out from (forms.submissions; the key is in the migration); none: a service without a form */
                submissionId: uuid('submission_id'),
                totalSantim: bigint('total_santim', { mode: 'bigint' }).notNull(),
                demo: boolean('demo').notNull()
            },
            (t) => [
                uniqueIndex('case_fees_number_uq').on(t.caseId, t.number),
                index('case_fees_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const caseFeeLines = withRls(
    audited(
        feesSchema.table(
            'case_fee_lines',
            {
                ...baseColumns(),
                ...handled(),
                caseFeeId: uuid('case_fee_id')
                    .notNull()
                    .references(() => caseFees.id),
                position: integer('position').notNull(),
                key: text('key').notNull(),
                /** I18nText */
                label: jsonb('label').$type<I18nText>().notNull(),
                /** the units charged (a per-unit or percent line), else null */
                quantity: integer('quantity'),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull()
            },
            (t) => [
                uniqueIndex('case_fee_lines_position_uq').on(t.caseFeeId, t.position),
                index('case_fee_lines_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * Payment orders (task 0.22b, ADR-0042): the case's newest fee as an order to pay, its lines copied. One live order per
 * case (a reassessed fee cancels an open order and issues a new one); its state changes (open → settled, back to open on
 * a reversal; cancelled), every change audited. Class T at the handling unit.
 */
export const paymentOrders = withRls(
    audited(
        feesSchema.table(
            'payment_orders',
            {
                ...baseColumns(),
                ...handled(),
                /** the case (workflow.cases; the key is in the migration) */
                caseId: uuid('case_id').notNull(),
                caseNumber: bigint('case_number', { mode: 'number' }).notNull(),
                serviceCode: text('service_code').notNull(),
                serviceName: jsonb('service_name').$type<I18nText>().notNull(),
                caseFeeId: uuid('case_fee_id')
                    .notNull()
                    .references(() => caseFees.id),
                totalSantim: bigint('total_santim', { mode: 'bigint' }).notNull(),
                demo: boolean('demo').notNull(),
                /** at the office's cashier, or elsewhere (a revenue office or a bank, task 0.22c) */
                collection: text('collection').$type<'cashier' | 'elsewhere'>().notNull(),
                dueOn: date('due_on').notNull(),
                state: text('state').$type<'open' | 'settled' | 'cancelled'>().notNull().default('open'),
                /** the payment that settles it (the key is in the migration: the payments name their order) */
                settledPaymentId: uuid('settled_payment_id'),
                /** or the reference of money paid elsewhere that settles it (the key is in the migration) */
                settledExternalRefId: uuid('settled_external_ref_id'),
                cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
                cancelReason: text('cancel_reason').$type<'reassessed' | 'case_closed'>()
            },
            (t) => [
                uniqueIndex('payment_orders_case_live_uq')
                    .on(t.caseId)
                    .where(sql`state <> 'cancelled'`),
                index('payment_orders_queue_idx').on(t.handlingUnitId, t.state, t.createdAt),
                index('payment_orders_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/** An order's lines: copies of its fee's (append-only). */
export const paymentOrderLines = withRls(
    audited(
        feesSchema.table(
            'payment_order_lines',
            {
                ...baseColumns(),
                ...handled(),
                orderId: uuid('order_id')
                    .notNull()
                    .references(() => paymentOrders.id),
                position: integer('position').notNull(),
                key: text('key').notNull(),
                label: jsonb('label').$type<I18nText>().notNull(),
                quantity: integer('quantity'),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull()
            },
            (t) => [
                uniqueIndex('payment_order_lines_position_uq').on(t.orderId, t.position),
                index('payment_order_lines_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * Payments taken at the cashier: the whole total, by cash or a bank deposit slip. Append-only but for the void a reversal
 * sets, once. One live payment per order, and one live use of a bank slip in the region (the database's backstop).
 */
export const payments = withRls(
    audited(
        feesSchema.table(
            'payments',
            {
                ...baseColumns(),
                ...handled(),
                orderId: uuid('order_id')
                    .notNull()
                    .references(() => paymentOrders.id),
                caseId: uuid('case_id').notNull(),
                method: text('method').$type<'cash' | 'bank_slip'>().notNull(),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull(),
                bankCode: text('bank_code'),
                slipReference: text('slip_reference'),
                /** the reference compared: upper case, without spaces or dashes */
                slipReferenceNorm: text('slip_reference_norm'),
                slipDate: date('slip_date'),
                receivedFrom: text('received_from').notNull(),
                receivedBy: uuid('received_by').notNull(),
                voidedAt: timestamp('voided_at', { withTimezone: true }),
                /** the reversal that voided it (the key is in the migration) */
                voidedByReversalId: uuid('voided_by_reversal_id')
            },
            (t) => [
                uniqueIndex('payments_order_live_uq')
                    .on(t.orderId)
                    .where(sql`voided_at IS NULL`),
                uniqueIndex('payments_slip_live_uq')
                    .on(t.regionId, t.bankCode, t.slipReferenceNorm)
                    .where(sql`method = 'bank_slip' AND voided_at IS NULL`),
                index('payments_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * Receipts (append-only): one per payment, numbered by ITRMS's counter (gapless per office and fiscal year) or by the
 * leaf of a pre-printed pad. A reversed receipt keeps its number (ADR-0014); a number is never issued again.
 */
export const receipts = withRls(
    audited(
        feesSchema.table(
            'receipts',
            {
                ...baseColumns(),
                ...handled(),
                paymentId: uuid('payment_id')
                    .notNull()
                    .references(() => payments.id),
                orderId: uuid('order_id')
                    .notNull()
                    .references(() => paymentOrders.id),
                caseId: uuid('case_id').notNull(),
                source: text('source').$type<'itrms' | 'pad'>().notNull(),
                number: text('number').notNull(),
                fiscalYear: integer('fiscal_year'),
                sequence: bigint('sequence', { mode: 'bigint' }),
                padSeries: text('pad_series'),
                padSerial: text('pad_serial'),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull(),
                issuedBy: uuid('issued_by').notNull()
            },
            (t) => [
                uniqueIndex('receipts_payment_uq').on(t.paymentId),
                uniqueIndex('receipts_itrms_uq')
                    .on(t.handlingUnitId, t.fiscalYear, t.sequence)
                    .where(sql`source = 'itrms'`),
                uniqueIndex('receipts_pad_uq')
                    .on(t.handlingUnitId, t.padSeries, t.padSerial)
                    .where(sql`source = 'pad'`),
                index('receipts_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * A receipt's reversal: asked for with a reason, decided once by another person (never the requester nor the cashier who
 * took the money; the database checks it too). Approved, it voids the payment and opens the order again; the receipt keeps
 * its number.
 */
export const receiptReversals = withRls(
    audited(
        feesSchema.table(
            'receipt_reversals',
            {
                ...baseColumns(),
                ...handled(),
                receiptId: uuid('receipt_id')
                    .notNull()
                    .references(() => receipts.id),
                paymentId: uuid('payment_id')
                    .notNull()
                    .references(() => payments.id),
                orderId: uuid('order_id')
                    .notNull()
                    .references(() => paymentOrders.id),
                caseId: uuid('case_id').notNull(),
                reason: text('reason').notNull(),
                requestedBy: uuid('requested_by').notNull(),
                /** the cashier who took the money (the payment's) */
                cashierId: uuid('cashier_id').notNull(),
                state: text('state').$type<'requested' | 'approved' | 'rejected'>().notNull().default('requested'),
                decidedBy: uuid('decided_by'),
                decidedAt: timestamp('decided_at', { withTimezone: true }),
                note: text('note')
            },
            (t) => [
                uniqueIndex('receipt_reversals_live_uq')
                    .on(t.receiptId)
                    .where(sql`state IN ('requested', 'approved')`),
                index('receipt_reversals_inbox_idx').on(t.state, t.createdAt),
                index('receipt_reversals_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * The receipt or reference of money paid elsewhere (a revenue office, a bank), task 0.22c, ADR-0043: entered at the
 * counter, it settles its order only once verified, by a person other than who entered it or by a statement's line. One
 * real reference settles one case: unique per issuer, reference (normalised) and the fiscal year of its date, while it
 * is live. A rejected, revoked or withdrawn one frees the key, and stays on record.
 */
export const externalPaymentRefs = withRls(
    audited(
        feesSchema.table(
            'external_payment_refs',
            {
                ...baseColumns(),
                ...handled(),
                orderId: uuid('order_id')
                    .notNull()
                    .references(() => paymentOrders.id),
                caseId: uuid('case_id').notNull(),
                issuer: text('issuer').notNull(),
                reference: text('reference').notNull(),
                /** the reference compared: its letters and digits in capitals, without leading zeros */
                referenceNorm: text('reference_norm').notNull(),
                fiscalYear: integer('fiscal_year').notNull(),
                paidOn: date('paid_on').notNull(),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }).notNull(),
                receivedFrom: text('received_from').notNull(),
                state: text('state')
                    .$type<'pending_verification' | 'verified' | 'rejected' | 'revoked' | 'withdrawn'>()
                    .notNull()
                    .default('pending_verification'),
                enteredBy: uuid('entered_by').notNull(),
                /** who verified or rejected it; none when a statement's line verified it */
                decidedBy: uuid('decided_by'),
                decidedAt: timestamp('decided_at', { withTimezone: true }),
                verifiedVia: text('verified_via').$type<'person' | 'statement'>(),
                note: text('note'),
                revokedBy: uuid('revoked_by'),
                revokedAt: timestamp('revoked_at', { withTimezone: true }),
                revokeReason: text('revoke_reason')
            },
            (t) => [
                uniqueIndex('external_payment_refs_key_uq')
                    .on(t.regionId, t.issuer, t.referenceNorm, t.fiscalYear)
                    .where(sql`state IN ('pending_verification', 'verified')`),
                uniqueIndex('external_payment_refs_order_live_uq')
                    .on(t.orderId)
                    .where(sql`state IN ('pending_verification', 'verified')`),
                index('external_payment_refs_inbox_idx').on(t.state, t.id),
                index('external_payment_refs_key_idx').on(t.regionId, t.issuer, t.referenceNorm, t.fiscalYear),
                index('external_payment_refs_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * A daily statement from a revenue office or a bank, as it was imported: the file's content kept as evidence, out of the
 * audit log (its hash goes in). The same file is imported once per issuer. Its office's subtree is what it can verify.
 */
export const externalStatements = withRls(
    audited(
        feesSchema.table(
            'external_statements',
            {
                ...baseColumns(),
                ...handled(),
                issuer: text('issuer').notNull(),
                statementDate: date('statement_date').notNull(),
                filename: text('filename').notNull(),
                layout: text('layout').notNull(),
                sha256: text('sha256').notNull(),
                content: text('content').notNull(),
                state: text('state')
                    .$type<'received' | 'matching' | 'processed' | 'failed'>()
                    .notNull()
                    .default('received'),
                failure: text('failure'),
                importedBy: uuid('imported_by').notNull()
            },
            (t) => [
                uniqueIndex('external_statements_file_uq').on(t.regionId, t.issuer, t.sha256),
                index('external_statements_list_idx').on(t.createdAt),
                index('external_statements_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['content'] }
    ),
    'transaction'
);

/**
 * A statement's lines: only what matching needs, never the payer. One live line per issuer, reference and fiscal year in the
 * region: the same money in another statement (they overlap) is a duplicate, on record, and verifies nothing.
 */
export const externalStatementLines = withRls(
    audited(
        feesSchema.table(
            'external_statement_lines',
            {
                ...baseColumns(),
                ...handled(),
                statementId: uuid('statement_id')
                    .notNull()
                    .references(() => externalStatements.id),
                lineNo: integer('line_no').notNull(),
                issuer: text('issuer').notNull(),
                reference: text('reference'),
                referenceNorm: text('reference_norm'),
                fiscalYear: integer('fiscal_year'),
                paidOn: date('paid_on'),
                amountSantim: bigint('amount_santim', { mode: 'bigint' }),
                state: text('state')
                    .$type<'unmatched' | 'matched' | 'amount_mismatch' | 'held' | 'duplicate' | 'invalid'>()
                    .notNull(),
                reason: text('reason'),
                refId: uuid('ref_id').references(() => externalPaymentRefs.id)
            },
            (t) => [
                uniqueIndex('external_statement_lines_no_uq').on(t.statementId, t.lineNo),
                uniqueIndex('external_statement_lines_key_uq')
                    .on(t.regionId, t.issuer, t.referenceNorm, t.fiscalYear)
                    .where(sql`state NOT IN ('duplicate', 'invalid')`),
                index('external_statement_lines_ref_idx').on(t.refId),
                index('external_statement_lines_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);
