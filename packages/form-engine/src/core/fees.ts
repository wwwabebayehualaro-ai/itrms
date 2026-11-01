/**
 * A fee worked out from its rule (architecture.md §9, ADR-0041; task 0.22a), UI-free: the API's preview and its filing
 * run this same function, so the figure a clerk is shown is the one the case keeps.
 *
 * Money is `bigint` santim throughout: an amount comes from the rule's text and is only ever added to, multiplied by a
 * whole quantity, capped, or shared out by basis points (rounded half up to the santim, once, on its line; ADR-0014).
 * A formula gives a condition or a whole quantity, never an amount.
 */
import { MAX_SANTIM, type EffectContract, type FeeLine, type FeeRule, type I18nText, type Money } from '@itrms/schemas';

import { contractInput, valueOfKind } from './contract';
import { checkFormula, evalCondition, evalFormula, formulaReferences } from './runtime/formula';
import { getByPath } from './runtime/path';

export interface FeeLineResult {
    key: string;
    label: I18nText;
    /** the units charged (a per-unit or percent line), else null */
    quantity: number | null;
    amount: Money;
}

export type FeeProblemCode = 'invalid_input' | 'formula_failed' | 'quantity_not_whole' | 'no_rate' | 'too_large';

export type FeeResult =
    | { status: 'complete'; lines: FeeLineResult[]; total: Money }
    /** a required input has no value yet: the inputs' keys */
    | { status: 'incomplete'; missing: string[] }
    | { status: 'failed'; problems: { line?: string; input?: string; code: FeeProblemCode }[] };

export interface FeeContext {
    /** the request's answers, as filing settles them */
    answers: Readonly<Record<string, unknown>>;
    /** the case's facts (for inputs `from: 'fact'`) */
    facts?: Readonly<Record<string, unknown>>;
    /** the day the fee is worked out (ISO, Addis Ababa): set by the server, never by a client */
    asOf: string;
    /** the service version's mapping of the rule's inputs to the form's keys (a key maps to itself by default) */
    inputMap?: Readonly<Record<string, string>>;
}

/** The rule's inputs read from the request's answers, as an effect's input contract (a service version checks the form). */
export function feeAnswerContract(rule: FeeRule): EffectContract {
    return Object.fromEntries(
        Object.entries(rule.inputs)
            .filter(([, i]) => i.from === 'answer')
            .map(([key, i]) => [key, { kind: i.kind, required: i.required }])
    );
}

/** The fee of a rule over a request's answers and its case's facts. */
export function evaluateFee(rule: FeeRule, context: FeeContext): FeeResult {
    const answers = contractInput(feeAnswerContract(rule), context.answers, context.inputMap);
    const input: Record<string, unknown> = { ...answers.input };
    const missing = [...answers.missing];
    const problems: { line?: string; input?: string; code: FeeProblemCode }[] = answers.invalid.map((key) => ({
        input: key,
        code: 'invalid_input'
    }));
    for (const [key, i] of Object.entries(rule.inputs)) {
        if (i.from !== 'fact' || i.fact === undefined) continue;
        const value = getByPath(context.facts ?? {}, i.fact);
        if (value === undefined || value === null || value === '') {
            if (i.required) missing.push(key);
        } else if (!valueOfKind(i.kind, value)) problems.push({ input: key, code: 'invalid_input' });
        else input[key] = value;
    }
    if (problems.length) return { status: 'failed', problems };
    if (missing.length) return { status: 'incomplete', missing: missing.sort() };

    const scope = { input, asOf: context.asOf };
    const charged = new Map<string, Money>();
    const lines: FeeLineResult[] = [];
    for (const line of rule.lines) {
        if (line.when !== undefined) {
            const holds = evalCondition(line.when, scope);
            if (holds === undefined) return failed(line, 'formula_failed');
            if (!holds) continue;
        }
        const worked = amountOf(line, input, scope, charged);
        if ('code' in worked) return failed(line, worked.code);
        if (worked.amount > MAX_SANTIM) return failed(line, 'too_large');
        charged.set(line.key, worked.amount);
        if (worked.amount > 0n)
            lines.push({ key: line.key, label: line.label, quantity: worked.quantity, amount: worked.amount });
    }
    const total = lines.reduce((sum, l) => sum + l.amount, 0n);
    if (total > MAX_SANTIM) return { status: 'failed', problems: [{ code: 'too_large' }] };
    return { status: 'complete', lines, total };
}

const failed = (line: FeeLine, code: FeeProblemCode): FeeResult => ({
    status: 'failed',
    problems: [{ line: line.key, code }]
});

/** The most units a line charges (a case keeps the quantity as a 32-bit integer). */
const MAX_UNITS = 2_147_483_647;

/** A whole, non-negative number of units, or the reason it is not one. */
function units(src: string | undefined, scope: Record<string, unknown>): number | { code: FeeProblemCode } {
    if (src === undefined) return 1;
    const q = evalFormula(src, scope);
    if (q === undefined || q === null) return { code: 'formula_failed' };
    if (typeof q !== 'number' || !Number.isSafeInteger(q) || q < 0) return { code: 'quantity_not_whole' };
    if (q > MAX_UNITS) return { code: 'too_large' };
    return q;
}

/** Caps a line: at most `maxUnits` units, at most `maxAmount` santim. */
const capped = (amount: Money, maxAmount: string | undefined): Money =>
    maxAmount !== undefined && amount > BigInt(maxAmount) ? BigInt(maxAmount) : amount;

function amountOf(
    line: FeeLine,
    input: Record<string, unknown>,
    scope: Record<string, unknown>,
    charged: ReadonlyMap<string, Money>
): { amount: Money; quantity: number | null } | { code: FeeProblemCode } {
    switch (line.kind) {
        case 'fixed':
            return { amount: BigInt(line.amount), quantity: null };
        case 'table': {
            const value = input[line.input];
            // an optional input left out charges nothing on its line
            if (value === undefined) return { amount: 0n, quantity: null };
            let amount = 0n;
            for (const v of Array.isArray(value) ? value : [value]) {
                const row = line.rows.find((r) => r.value === v || String(r.value) === String(v));
                const rate = row?.amount ?? line.otherwise;
                if (rate === undefined) return { code: 'no_rate' };
                amount += BigInt(rate);
            }
            return { amount, quantity: null };
        }
        case 'perUnit': {
            const q = units(line.quantity, scope);
            if (typeof q !== 'number') return q;
            const n = line.maxUnits !== undefined ? Math.min(q, line.maxUnits) : q;
            return { amount: capped(BigInt(line.amount) * BigInt(n), line.maxAmount), quantity: n };
        }
        case 'percent': {
            const q = units(line.quantity, scope);
            if (typeof q !== 'number') return q;
            const n = line.maxUnits !== undefined ? Math.min(q, line.maxUnits) : q;
            const base = line.of.reduce((sum, key) => sum + (charged.get(key) ?? 0n), 0n);
            // half up to the santim, once, before the line's cap
            const share = (base * BigInt(line.basisPoints) * BigInt(n) + 5000n) / 10000n;
            return { amount: capped(share, line.maxAmount), quantity: n };
        }
    }
}

export interface FeeRuleProblem {
    /** the rule's path: `lines.2.quantity` */
    path: string;
    code: 'formula_invalid' | 'unknown_reference';
    message: string;
}

/**
 * A rule's formulas checked (beyond its schema): each parses, uses known functions, and reads only the rule's own inputs
 * (`input.<key>`) and `asOf`.
 */
export function checkFeeRule(rule: FeeRule): FeeRuleProblem[] {
    const problems: FeeRuleProblem[] = [];
    const check = (path: string, src: string | undefined) => {
        if (src === undefined) return;
        const problem = checkFormula(src);
        if (problem) {
            problems.push({ path, code: 'formula_invalid', message: problem });
            return;
        }
        for (const ref of formulaReferences(src)) {
            const m = /^input\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(ref);
            if (ref === 'asOf' || (m?.[1] !== undefined && Object.hasOwn(rule.inputs, m[1]))) continue;
            problems.push({ path, code: 'unknown_reference', message: `"${ref}" is not an input of the rule or asOf` });
        }
    };
    rule.lines.forEach((line, i) => {
        check(`lines.${i}.when`, line.when);
        if (line.kind === 'perUnit' || line.kind === 'percent') check(`lines.${i}.quantity`, line.quantity);
    });
    return problems;
}
