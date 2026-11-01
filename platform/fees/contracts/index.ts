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

/** The value schemas of the slice's settings (the settings registry checks every value against them). */
export const FEES_SETTINGS = {
    [FEE_APPROVER_ROLES_SETTING]: z
        .array(z.string().regex(/^[a-z][a-z0-9_.]{1,62}$/))
        .min(1)
        .max(10)
} as const;
