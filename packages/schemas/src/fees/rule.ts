/**
 * A fee rule (architecture.md §9, ADR-0041; task 0.22a): what a service charges, as lines worked out from the request's
 * answers and the case's facts. A rule is versioned and approved before a service version may name it; a case keeps the
 * figure worked out when it was filed.
 *
 * Money never passes through a formula: amounts are santim text in the rule. A formula gives only a condition (`when`)
 * or a whole quantity (months, items); the evaluator (`packages/form-engine/core`) multiplies santim by it as `bigint`.
 * Formulas read `input.<key>` (the rule's inputs) and `asOf` (the day the fee is worked out, in Addis Ababa).
 */
import { z } from 'zod';

import { CONTRACT_PATH } from '../forms/effectContract';
import { i18nTextSchema } from '../i18n';
import { santimTextSchema } from '../money';

/** The kinds of value an input may be (a subset of the form engine's value kinds). */
export const FEE_INPUT_KINDS = ['text', 'number', 'boolean', 'date', 'ethdate', 'choice', 'multi'] as const;
export type FeeInputKind = (typeof FEE_INPUT_KINDS)[number];

const key = z.string().regex(CONTRACT_PATH, 'is not a key');
const formula = z.string().trim().min(1).max(500);
const factPath = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}(\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,4}$/, 'is not a fact');

export const feeInputSchema = z
    .strictObject({
        kind: z.enum(FEE_INPUT_KINDS),
        /** the fee cannot be worked out without it (default); a request is not filed without it */
        required: z.boolean().default(true),
        /** an answer of the request (default, through the service version's input map), or a fact of the case */
        from: z.enum(['answer', 'fact']).default('answer'),
        /** the fact's path, for `from: 'fact'` */
        fact: factPath.optional()
    })
    .superRefine((i, ctx) => {
        if ((i.from === 'fact') !== (i.fact !== undefined))
            ctx.addIssue({
                code: 'custom',
                path: ['fact'],
                message: 'a fact input names its fact, an answer input none'
            });
    });
export type FeeInput = z.input<typeof feeInputSchema>;

const lineBase = {
    /** the line's key, unique in the rule (a later percent line names it) */
    key,
    label: i18nTextSchema,
    /** the line is charged only when this holds */
    when: formula.optional()
};
/** A quantity's limits: at most `maxUnits` units, at most `maxAmount` santim on the line. */
const caps = {
    maxUnits: z.number().int().min(1).max(10_000).optional(),
    maxAmount: santimTextSchema.optional()
};
const tableValue = z.union([z.string().min(1).max(100), z.number().int(), z.boolean()]);

export const feeLineSchema = z.discriminatedUnion('kind', [
    z.strictObject({ ...lineBase, kind: z.literal('fixed'), amount: santimTextSchema }),
    z.strictObject({
        ...lineBase,
        kind: z.literal('table'),
        /** the input whose value picks the amount (each selected value's, summed, for a multiple choice) */
        input: key,
        rows: z
            .array(z.strictObject({ value: tableValue, amount: santimTextSchema }))
            .min(1)
            .max(100),
        /** the amount for a value no row names (otherwise such a value cannot be charged) */
        otherwise: santimTextSchema.optional()
    }),
    z.strictObject({
        ...lineBase,
        kind: z.literal('perUnit'),
        amount: santimTextSchema,
        /** a whole number of units: `startedMonths(input.expiry, asOf)` (30-day months) or `startedEthMonths(…)` */
        quantity: formula,
        ...caps
    }),
    z.strictObject({
        ...lineBase,
        kind: z.literal('percent'),
        /** the earlier lines it is a share of */
        of: z.array(key).min(1).max(20),
        /** the share in basis points (1 % = 100); rounded half up to the santim, once, on the line */
        basisPoints: z.number().int().min(1).max(100_000),
        quantity: formula.optional(),
        ...caps
    })
]);
export type FeeLine = z.infer<typeof feeLineSchema>;

/** Which day a fee worked out again for a corrected request counts to (a rule's choice, product owner 2026-11-01). */
export const FEE_REASSESS_AS_OF = ['filing', 'reassessment'] as const;

export const feeRuleSchema = z
    .strictObject({
        schemaVersion: z.literal(1),
        inputs: z.record(key, feeInputSchema).refine((r) => Object.keys(r).length <= 30, 'at most 30 inputs'),
        lines: z.array(feeLineSchema).min(1).max(20),
        /** a corrected request's fee counts to the day it was filed (default), or to the day it is worked out again */
        reassessAsOf: z.enum(FEE_REASSESS_AS_OF).default('filing'),
        /** the amounts are placeholders, not the regional schedule (shown as such) */
        demo: z.boolean().default(false),
        /** the legal source of the amounts ("Regulation 572/2025, schedule 2") */
        basis: z.string().trim().max(300).optional()
    })
    .superRefine((r, ctx) => {
        const seen = new Set<string>();
        r.lines.forEach((line, i) => {
            if (seen.has(line.key))
                ctx.addIssue({ code: 'custom', path: ['lines', i, 'key'], message: 'is the key of another line' });
            if (line.kind === 'table') {
                if (!Object.hasOwn(r.inputs, line.input))
                    ctx.addIssue({ code: 'custom', path: ['lines', i, 'input'], message: 'is no input of the rule' });
                const values = line.rows.map((row) => JSON.stringify(row.value));
                if (new Set(values).size !== values.length)
                    ctx.addIssue({ code: 'custom', path: ['lines', i, 'rows'], message: 'names a value twice' });
            }
            if (line.kind === 'percent')
                line.of.forEach((of, j) => {
                    if (!seen.has(of))
                        ctx.addIssue({
                            code: 'custom',
                            path: ['lines', i, 'of', j],
                            message: 'is no earlier line of the rule'
                        });
                });
            seen.add(line.key);
        });
    });
export type FeeRule = z.infer<typeof feeRuleSchema>;
export type FeeRuleInput = z.input<typeof feeRuleSchema>;
