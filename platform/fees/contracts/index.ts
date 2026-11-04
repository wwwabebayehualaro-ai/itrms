/**
 * Public contracts of @itrms/fees (code-structure.md §4; ADR-0041, task 0.22a): fee rules and their versions, the
 * preview of a request's fee, and the fee a case keeps. Amounts are santim as text (`santimTextSchema`).
 */
import { answersSchema } from '@itrms/forms/contracts';
import { feeRuleSchema, i18nTextSchema, santimTextSchema } from '@itrms/schemas';
import { z } from 'zod';

/** A fee rule's key: `dvc-04-renewal`. */
export const FEE_RULE_KEY = /^[a-z][a-z0-9-]{1,62}$/;

/** The region setting naming the roles that may approve a fee rule version (product owner, 2026-11-01). */
export const FEE_APPROVER_ROLES_SETTING = 'fees.rules.approverRoles';

/** The service version's input map entry holding the fee rule's inputs (task 0.21d's `inputMap`). */
export const FEE_INPUTS = 'fees.rule';

/** The effect that works a corrected request's fee out again. */
export const FEE_ASSESS_EFFECT = 'fees.assess';

export const feeRuleCreateSchema = z.strictObject({
    key: z.string().regex(FEE_RULE_KEY, 'is not a fee rule key'),
    name: i18nTextSchema,
    document: feeRuleSchema
});
export type FeeRuleCreate = z.input<typeof feeRuleCreateSchema>;

export const feeRuleVersionInputSchema = z.strictObject({ document: feeRuleSchema });

export const feeRuleDecisionSchema = z.strictObject({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(3).max(500).optional()
});

export const feeRuleVersionOutSchema = z.object({
    id: z.uuid(),
    ruleId: z.uuid(),
    number: z.number().int(),
    document: feeRuleSchema,
    demo: z.boolean(),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    status: z.enum(['pending', 'approved', 'rejected']),
    decidedBy: z.uuid().nullable(),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
    reason: z.string().nullable()
});
export type FeeRuleVersionOut = z.infer<typeof feeRuleVersionOutSchema>;

export const feeRuleOutSchema = z.object({
    id: z.uuid(),
    key: z.string(),
    name: i18nTextSchema,
    active: z.boolean(),
    latestVersion: feeRuleVersionOutSchema.nullable()
});
export type FeeRuleOut = z.infer<typeof feeRuleOutSchema>;

/** A rule checked without saving it: its schema, then its formulas. */
export const feeRuleCheckSchema = z.object({
    problems: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
});

export const feeLineOutSchema = z.object({
    key: z.string(),
    label: i18nTextSchema,
    /** the units charged (a per-unit or percent line), else null */
    quantity: z.number().int().nullable(),
    amountSantim: santimTextSchema
});
export type FeeLineOut = z.infer<typeof feeLineOutSchema>;

/** A request's fee as filing would work it out now (nothing stored). */
export const feePreviewInputSchema = z.strictObject({
    serviceCode: z.string().regex(/^[A-Z]{2,5}-\d{2}$/, 'is not a service code'),
    answers: answersSchema.default({})
});

export const FEE_PREVIEW_STATUSES = ['none', 'complete', 'incomplete', 'unavailable'] as const;

export const feePreviewSchema = z.object({
    /** none: the service charges nothing; unavailable: its rule cannot be worked out (`problem` says why) */
    status: z.enum(FEE_PREVIEW_STATUSES),
    serviceVersionId: z.uuid(),
    feeRuleVersionId: z.uuid().nullable(),
    /** the day it was worked out (Addis Ababa) */
    asOf: z.iso.date(),
    demo: z.boolean(),
    /** the form keys the fee reads: a change to another answer never changes it */
    inputKeys: z.array(z.string()),
    lines: z.array(feeLineOutSchema),
    totalSantim: santimTextSchema.nullable(),
    /** the form keys still wanting an answer, for `incomplete` */
    missing: z.array(z.string()),
    problem: z.string().nullable()
});
export type FeePreview = z.infer<typeof feePreviewSchema>;

/** What the counter showed when it filed: a different figure now refuses the filing (409 `fee_changed`). */
export const feeShownSchema = z.strictObject({
    ruleVersionId: z.uuid(),
    totalSantim: santimTextSchema
});
export type FeeShown = z.infer<typeof feeShownSchema>;

/** The fee a case keeps: the newest of its assessments (filed, then each correction that changed it). */
export const caseFeeSchema = z.object({
    id: z.uuid(),
    caseId: z.uuid(),
    number: z.number().int(),
    reason: z.enum(['filed', 'amended']),
    feeRuleVersionId: z.uuid(),
    asOf: z.iso.date(),
    demo: z.boolean(),
    lines: z.array(feeLineOutSchema),
    totalSantim: santimTextSchema,
    computedAt: z.iso.datetime({ offset: true })
});
export type CaseFee = z.infer<typeof caseFeeSchema>;

/** The problem codes of the fees API. */
export const FEE_ERROR_CODES = [
    'fee_not_computable',
    'fee_changed',
    'fee_rule_exists',
    'fee_rule_invalid',
    'fee_rule_self_approval',
    'fee_rule_not_approver',
    'fee_rule_decided'
] as const;

// ---- payment orders, payments, receipts and reversals (task 0.22b, ADR-0042) ----

/** The effect that turns a case's fee into a payment order. */
export const CREATE_PAYMENT_ORDER_EFFECT = 'fees.createPaymentOrder';

/** Where an office's receipt numbers come from (product owner, 2026-11-01): ITRMS's counters, or a pre-printed pad. */
export const RECEIPT_SOURCE_SETTING = 'fees.receipts.source';
export const RECEIPT_SOURCES = ['itrms', 'pad'] as const;
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];
/** The roles that may decide a receipt's reversal (never the person who asked, nor the cashier who took the money). */
export const REVERSAL_APPROVER_ROLES_SETTING = 'fees.reversals.approverRoles';
/** The banks a deposit slip may be of. */
export const BANKS_SETTING = 'fees.payments.banks';
/** The counter ITRMS's receipt numbers come from, and its pattern (gapless per office and fiscal year). */
export const RECEIPT_COUNTER = 'fees.receipt';
export const RECEIPT_PATTERN = '{unit}/{seq:06}/{efy}';

const roleList = z
    .array(z.string().regex(/^[a-z][a-z0-9_.]{1,62}$/))
    .min(1)
    .max(10);
export const bankSchema = z.strictObject({ code: z.string().regex(/^[A-Z0-9]{2,12}$/), name: i18nTextSchema });

/** The value schemas of the slice's settings (the settings registry checks every value against them). */
export const FEES_SETTINGS = {
    [FEE_APPROVER_ROLES_SETTING]: roleList,
    [RECEIPT_SOURCE_SETTING]: z.enum(RECEIPT_SOURCES),
    [REVERSAL_APPROVER_ROLES_SETTING]: roleList,
    [BANKS_SETTING]: z.array(bankSchema).min(1).max(100)
} as const;

/**
 * What a case knows of its payment (its fact `payment`; workflows guard on `payment.settled`): the order, whether it is
 * paid, its total, where it is paid. A case without a fee is settled with a total of 0.
 */
export const paymentFactsSchema = z.object({
    orderId: z.uuid().nullable(),
    settled: z.boolean(),
    totalSantim: santimTextSchema,
    collection: z.enum(['cashier', 'elsewhere'])
});
export type PaymentFacts = z.infer<typeof paymentFactsSchema>;

export const PAYMENT_METHODS = ['cash', 'bank_slip'] as const;
export const ORDER_STATES = ['open', 'settled', 'cancelled'] as const;
export const REVERSAL_STATES = ['requested', 'approved', 'rejected'] as const;

/** A payment recorded at the cashier: the whole total (no part payments), by cash or a bank deposit slip. */
export const paymentInputSchema = z
    .strictObject({
        method: z.enum(PAYMENT_METHODS),
        /** the amount the cashier confirms: the order's total (otherwise 409 amount_mismatch) */
        amountSantim: santimTextSchema,
        receivedFrom: z.string().trim().min(2).max(200),
        bankSlip: z
            .strictObject({
                bank: z.string().regex(/^[A-Z0-9]{2,12}$/),
                reference: z.string().trim().min(3).max(40),
                paidOn: z.iso.date()
            })
            .optional(),
        /** the leaf of a pre-printed receipt pad, at an office that issues pad receipts */
        pad: z
            .strictObject({
                series: z.string().regex(/^[A-Z0-9-]{1,16}$/),
                // no leading zeros: `012` and `12` are one leaf of the pad
                serial: z.string().regex(/^[1-9]\d{0,9}$/, 'is a serial without leading zeros')
            })
            .optional()
    })
    .superRefine((p, ctx) => {
        if ((p.method === 'bank_slip') !== (p.bankSlip !== undefined))
            ctx.addIssue({
                code: 'custom',
                path: ['bankSlip'],
                message: 'a bank slip payment names its slip, cash none'
            });
    });
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const reversalRequestSchema = z.strictObject({ reason: z.string().trim().min(10).max(500) });
export const reversalDecisionSchema = z.strictObject({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500).optional()
});

export const paymentOrderQuerySchema = z.object({
    state: z.enum(ORDER_STATES).default('open'),
    /** a case number */
    q: z.coerce.number().int().positive().optional(),
    /** keyset: the last order's id (orders come oldest first) */
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

const iso = z.iso.datetime({ offset: true });

export const receiptOutSchema = z.object({
    id: z.uuid(),
    paymentId: z.uuid(),
    orderId: z.uuid(),
    caseId: z.uuid(),
    caseNumber: z.number().int(),
    source: z.enum(RECEIPT_SOURCES),
    /** `WOL-BODITI/000001/2019`, or the pad's series and serial */
    number: z.string(),
    amountSantim: santimTextSchema,
    method: z.enum(PAYMENT_METHODS),
    receivedFrom: z.string(),
    serviceCode: z.string(),
    serviceName: i18nTextSchema,
    lines: z.array(feeLineOutSchema),
    unit: z.object({ id: z.uuid(), code: z.string(), name: i18nTextSchema }),
    issuedBy: z.uuid(),
    issuedAt: iso,
    demo: z.boolean(),
    reversed: z.boolean()
});
export type ReceiptOut = z.infer<typeof receiptOutSchema>;

export const paymentOutSchema = z.object({
    id: z.uuid(),
    method: z.enum(PAYMENT_METHODS),
    amountSantim: santimTextSchema,
    receivedFrom: z.string(),
    bank: z.string().nullable(),
    slipReference: z.string().nullable(),
    slipDate: z.iso.date().nullable(),
    receivedBy: z.uuid(),
    receivedAt: iso,
    voided: z.boolean(),
    receiptId: z.uuid().nullable(),
    receiptNumber: z.string().nullable()
});

export const reversalOutSchema = z.object({
    id: z.uuid(),
    receiptId: z.uuid(),
    receiptNumber: z.string(),
    orderId: z.uuid(),
    caseId: z.uuid(),
    caseNumber: z.number().int(),
    amountSantim: santimTextSchema,
    reason: z.string(),
    state: z.enum(REVERSAL_STATES),
    requestedBy: z.uuid(),
    requestedAt: iso,
    cashierId: z.uuid(),
    decidedBy: z.uuid().nullable(),
    decidedAt: iso.nullable(),
    note: z.string().nullable(),
    unit: z.object({ id: z.uuid(), code: z.string(), name: i18nTextSchema })
});
export type ReversalOut = z.infer<typeof reversalOutSchema>;

export const paymentOrderOutSchema = z.object({
    id: z.uuid(),
    caseId: z.uuid(),
    caseNumber: z.number().int(),
    serviceCode: z.string(),
    serviceName: i18nTextSchema,
    state: z.enum(ORDER_STATES),
    collection: z.enum(['cashier', 'elsewhere']),
    totalSantim: santimTextSchema,
    demo: z.boolean(),
    dueOn: z.iso.date(),
    overdue: z.boolean(),
    lines: z.array(feeLineOutSchema),
    unit: z.object({ id: z.uuid(), code: z.string(), name: i18nTextSchema }),
    createdAt: iso,
    cancelReason: z.enum(['reassessed', 'case_closed']).nullable(),
    payments: z.array(paymentOutSchema),
    reversals: z.array(reversalOutSchema),
    /** where this office's receipt numbers come from now */
    receiptSource: z.enum(RECEIPT_SOURCES)
});
export type PaymentOrderOut = z.infer<typeof paymentOrderOutSchema>;

/** The events of the slice: a payment settled an order; a receipt issued (0.23 renders it), reversed (0.23 revokes it). */
export const FEES_EVENTS = {
    'payment.settled.v1': z.object({ orderId: z.uuid(), caseId: z.uuid(), paymentId: z.uuid() }),
    'receipt.issued.v1': z.object({ receiptId: z.uuid(), caseId: z.uuid() }),
    'receipt.reversed.v1': z.object({ receiptId: z.uuid(), caseId: z.uuid(), reversalId: z.uuid() })
} as const;
