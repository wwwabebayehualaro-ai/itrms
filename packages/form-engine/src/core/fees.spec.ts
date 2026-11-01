/**
 * Fee rules worked out (ADR-0041, task 0.22a): golden cases of a licence renewal with penalty months and of a
 * replacement, half-up shares, the reasons a fee cannot be worked out, and the money staying whole santim.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { feeRuleSchema, type FeeRuleInput } from '@itrms/schemas';

import { checkFeeRule, evaluateFee, feeAnswerContract, type FeeResult } from './';
import { evalFormula } from './runtime/formula';

const t = (en: string) => ({ am: en, en });
const rule = (input: FeeRuleInput) => feeRuleSchema.parse(input);

/** A renewal: a fee by grade, a penalty per started month after expiry (at most 24), more after a year, a lost card. */
const RENEWAL = rule({
    schemaVersion: 1,
    inputs: {
        grade: { kind: 'choice' },
        expiry: { kind: 'date' },
        lost: { kind: 'boolean', required: false }
    },
    lines: [
        {
            key: 'base',
            label: t('Renewal'),
            kind: 'table',
            input: 'grade',
            rows: [
                { value: 'auto', amount: '30000' },
                { value: 'public-1', amount: '45000' }
            ]
        },
        {
            key: 'penalty',
            label: t('Late renewal, per started month'),
            kind: 'perUnit',
            amount: '5000',
            quantity: 'startedMonths(input.expiry, asOf)',
            maxUnits: 24,
            when: 'days(input.expiry, asOf) > 0'
        },
        {
            key: 'overAYear',
            label: t('Expired more than a year'),
            kind: 'fixed',
            amount: '20000',
            when: 'days(input.expiry, asOf) > 365'
        },
        { key: 'card', label: t('Replacement card'), kind: 'fixed', amount: '15000', when: 'input.lost' }
    ],
    demo: true
});

/** A replacement: a fee by item, a share for the service of urgent printing. */
const REPLACEMENT = rule({
    schemaVersion: 1,
    inputs: { item: { kind: 'choice' }, urgent: { kind: 'boolean', required: false } },
    lines: [
        {
            key: 'item',
            label: t('Replacement'),
            kind: 'table',
            input: 'item',
            rows: [
                { value: 'libre', amount: '25000' },
                { value: 'bolo', amount: '10000' }
            ]
        },
        { key: 'urgent', label: t('Urgent'), kind: 'percent', of: ['item'], basisPoints: 5000, when: 'input.urgent' }
    ]
});

const complete = (r: FeeResult) => {
    if (r.status !== 'complete') throw new Error(`not complete: ${JSON.stringify(r)}`);
    return r;
};
const renewal = (expiry: string, asOf: string, extra: Record<string, unknown> = {}) =>
    complete(evaluateFee(RENEWAL, { answers: { grade: 'auto', expiry, ...extra }, asOf }));
const keys = (r: { lines: { key: string }[] }) => r.lines.map((l) => l.key);

describe('a renewal (golden)', () => {
    it('charges no penalty on the day of expiry, one month from the next day to the 30th, then one per started month', () => {
        expect(keys(renewal('2026-01-01', '2026-01-01'))).toEqual(['base']);
        expect(renewal('2026-01-01', '2026-01-01').total).toBe(30000n);
        const month = (asOf: string) => renewal('2026-01-01', asOf).lines.find((l) => l.key === 'penalty');
        expect(month('2026-01-02')).toMatchObject({ quantity: 1, amount: 5000n });
        expect(month('2026-01-31')).toMatchObject({ quantity: 1, amount: 5000n });
        expect(month('2026-02-01')).toMatchObject({ quantity: 2, amount: 10000n });
        expect(month('2026-03-03')).toMatchObject({ quantity: 3, amount: 15000n });
    });

    it('caps the months, and adds the over-a-year line after 365 days', () => {
        const late = renewal('2023-01-01', '2026-01-01');
        expect(keys(late)).toEqual(['base', 'penalty', 'overAYear']);
        expect(late.lines[1]).toMatchObject({ quantity: 24, amount: 120000n });
        expect(late.total).toBe(30000n + 120000n + 20000n);
        expect(keys(renewal('2025-01-01', '2026-01-01'))).toEqual(['base', 'penalty']);
        expect(keys(renewal('2025-01-01', '2026-01-02'))).toEqual(['base', 'penalty', 'overAYear']);
    });

    it('charges a lost card, and its grade', () => {
        const lost = complete(
            evaluateFee(RENEWAL, {
                answers: { grade: 'public-1', expiry: '2026-05-01', lost: true },
                asOf: '2026-04-01'
            })
        );
        expect(lost.lines.map((l) => [l.key, l.amount])).toEqual([
            ['base', 45000n],
            ['card', 15000n]
        ]);
        expect(lost.total).toBe(60000n);
    });

    it('reads the form keys the service version maps the inputs to', () => {
        const mapped = evaluateFee(RENEWAL, {
            answers: { licenceGrade: 'auto', expiryDate: '2026-01-01' },
            asOf: '2026-01-01',
            inputMap: { grade: 'licenceGrade', expiry: 'expiryDate' }
        });
        expect(complete(mapped).total).toBe(30000n);
    });
});

describe('a replacement (golden)', () => {
    it('charges the item, and an urgent share rounded half up once on its line', () => {
        expect(complete(evaluateFee(REPLACEMENT, { answers: { item: 'bolo' }, asOf: '2026-01-01' })).total).toBe(
            10000n
        );
        const urgent = complete(
            evaluateFee(REPLACEMENT, { answers: { item: 'libre', urgent: true }, asOf: '2026-01-01' })
        );
        expect(urgent.lines.map((l) => [l.key, l.amount])).toEqual([
            ['item', 25000n],
            ['urgent', 12500n]
        ]);
    });

    it('cannot charge an item without a rate', () => {
        expect(evaluateFee(REPLACEMENT, { answers: { item: 'plate' }, asOf: '2026-01-01' })).toEqual({
            status: 'failed',
            problems: [{ line: 'item', code: 'no_rate' }]
        });
    });
});

describe('a share', () => {
    const share = (base: string, basisPoints: number) =>
        complete(
            evaluateFee(
                rule({
                    schemaVersion: 1,
                    inputs: {},
                    lines: [
                        { key: 'base', label: t('Base'), kind: 'fixed', amount: base },
                        { key: 'share', label: t('Share'), kind: 'percent', of: ['base'], basisPoints }
                    ]
                }),
                { answers: {}, asOf: '2026-01-01' }
            )
        ).lines.find((l) => l.key === 'share')?.amount ?? 0n;

    it('rounds half up to the santim', () => {
        expect(share('1', 5000)).toBe(1n);
        expect(share('3', 5000)).toBe(2n);
        expect(share('33333', 250)).toBe(833n);
        expect(share('99999999999999', 100)).toBe(1000000000000n);
    });
});

describe('a fee that cannot be worked out', () => {
    it('is incomplete while a required input has no answer, and names it', () => {
        expect(evaluateFee(RENEWAL, { answers: { grade: 'auto' }, asOf: '2026-01-01' })).toEqual({
            status: 'incomplete',
            missing: ['expiry']
        });
    });

    it('fails on an answer of the wrong kind, a quantity that is not whole, and a total too large', () => {
        expect(evaluateFee(RENEWAL, { answers: { grade: 'auto', expiry: 'soon' }, asOf: '2026-01-01' })).toMatchObject({
            status: 'failed',
            problems: [{ input: 'expiry', code: 'invalid_input' }]
        });
        const halves = rule({
            schemaVersion: 1,
            inputs: { n: { kind: 'number' } },
            lines: [{ key: 'per', label: t('Per'), kind: 'perUnit', amount: '100', quantity: 'input.n / 2' }]
        });
        expect(evaluateFee(halves, { answers: { n: 3 }, asOf: '2026-01-01' })).toMatchObject({
            status: 'failed',
            problems: [{ line: 'per', code: 'quantity_not_whole' }]
        });
        expect(evaluateFee(halves, { answers: { n: -2 }, asOf: '2026-01-01' })).toMatchObject({
            problems: [{ code: 'quantity_not_whole' }]
        });
        const huge = rule({
            schemaVersion: 1,
            inputs: {},
            lines: [
                { key: 'a', label: t('A'), kind: 'fixed', amount: '99999999999999999' },
                { key: 'b', label: t('B'), kind: 'fixed', amount: '1' }
            ]
        });
        expect(evaluateFee(huge, { answers: {}, asOf: '2026-01-01' })).toEqual({
            status: 'failed',
            problems: [{ code: 'too_large' }]
        });
    });

    it('fails on a quantity a case cannot keep (beyond a 32-bit integer)', () => {
        const many = rule({
            schemaVersion: 1,
            inputs: { n: { kind: 'number' } },
            lines: [{ key: 'per', label: t('Per'), kind: 'perUnit', amount: '1', quantity: 'input.n' }]
        });
        expect(evaluateFee(many, { answers: { n: 3_000_000_000 }, asOf: '2026-01-01' })).toEqual({
            status: 'failed',
            problems: [{ line: 'per', code: 'too_large' }]
        });
        expect(evaluateFee(many, { answers: { n: 2_147_483_647 }, asOf: '2026-01-01' })).toMatchObject({
            status: 'complete',
            total: 2_147_483_647n
        });
    });

    it('reads a fact of the case', () => {
        const byFact = rule({
            schemaVersion: 1,
            inputs: { category: { kind: 'choice', from: 'fact', fact: 'vehicle.category' } },
            lines: [
                {
                    key: 'base',
                    label: t('Base'),
                    kind: 'table',
                    input: 'category',
                    rows: [{ value: 'truck', amount: '70000' }]
                }
            ]
        });
        expect(
            complete(
                evaluateFee(byFact, { answers: {}, facts: { vehicle: { category: 'truck' } }, asOf: '2026-01-01' })
            ).total
        ).toBe(70000n);
        expect(evaluateFee(byFact, { answers: {}, asOf: '2026-01-01' })).toEqual({
            status: 'incomplete',
            missing: ['category']
        });
    });
});

describe('the money', () => {
    it('stays whole santim, and the total is the sum of the lines', () => {
        fc.assert(
            fc.property(
                fc.array(fc.bigInt({ min: 1n, max: 10n ** 12n }), { minLength: 1, maxLength: 5 }),
                fc.integer({ min: 0, max: 400 }),
                fc.integer({ min: 1, max: 100_000 }),
                (amounts, days, basisPoints) => {
                    const r = rule({
                        schemaVersion: 1,
                        inputs: { from: { kind: 'date' } },
                        lines: [
                            ...amounts.map((a, i) => ({
                                key: `f${i}`,
                                label: t('F'),
                                kind: 'fixed' as const,
                                amount: a.toString()
                            })),
                            {
                                key: 'months',
                                label: t('M'),
                                kind: 'perUnit' as const,
                                amount: '333',
                                quantity: 'startedEthMonths(input.from, asOf)'
                            },
                            {
                                key: 'share',
                                label: t('S'),
                                kind: 'percent' as const,
                                of: amounts.map((_, i) => `f${i}`),
                                basisPoints
                            }
                        ]
                    });
                    const asOf = new Date(Date.UTC(2026, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
                    const out = complete(evaluateFee(r, { answers: { from: '2026-01-01' }, asOf }));
                    expect(out.lines.every((l) => typeof l.amount === 'bigint' && l.amount > 0n)).toBe(true);
                    expect(out.total).toBe(out.lines.reduce((s, l) => s + l.amount, 0n));
                }
            )
        );
    });
});

describe('started months', () => {
    it('counts 30-day months', () => {
        expect(evalFormula("startedMonths('2026-01-01', '2026-01-01')", {})).toBe(0);
        expect(evalFormula("startedMonths('2026-01-01', '2025-12-01')", {})).toBe(0);
        expect(evalFormula("startedMonths('2026-01-01', '2026-01-31')", {})).toBe(1);
        expect(evalFormula("startedMonths('2026-01-01', '2026-02-01')", {})).toBe(2);
        expect(evalFormula("startedMonths('soon', '2026-02-01')", {})).toBeNull();
    });

    it('counts Ethiopian calendar months, Pagume as a month', () => {
        // 2026-01-01 is Tahsas 23, 2018; a month is up on Tir 23
        expect(evalFormula("startedEthMonths('2026-01-01', '2026-01-02')", {})).toBe(1);
        expect(evalFormula("startedEthMonths('2026-01-01', '2026-01-31')", {})).toBe(1);
        expect(evalFormula("startedEthMonths('2026-01-01', '2026-02-01')", {})).toBe(2);
        // Nehase 30, 2018 (2026-09-05) to Pagume 5 (2026-09-10): one month, up on Pagume's last day
        expect(evalFormula("startedEthMonths('2026-09-05', '2026-09-10')", {})).toBe(1);
        expect(evalFormula("startedEthMonths('2026-09-05', '2026-09-11')", {})).toBe(2);
    });
});

describe('a rule checked', () => {
    it('reads only its own inputs and asOf', () => {
        expect(checkFeeRule(RENEWAL)).toEqual([]);
        const bad = rule({
            schemaVersion: 1,
            inputs: { n: { kind: 'number' } },
            lines: [
                { key: 'a', label: t('A'), kind: 'fixed', amount: '1', when: 'form.secret > 0' },
                { key: 'b', label: t('B'), kind: 'perUnit', amount: '1', quantity: 'nope(input.n)' }
            ]
        });
        expect(checkFeeRule(bad).map((p) => [p.path, p.code])).toEqual([
            ['lines.0.when', 'unknown_reference'],
            ['lines.1.quantity', 'formula_invalid']
        ]);
    });

    it('refuses a share of a later line, a table on no input, a repeated key', () => {
        const parsed = feeRuleSchema.safeParse({
            schemaVersion: 1,
            inputs: {},
            lines: [
                { key: 'a', label: t('A'), kind: 'percent', of: ['b'], basisPoints: 100 },
                { key: 'b', label: t('B'), kind: 'table', input: 'x', rows: [{ value: 'y', amount: '1' }] },
                { key: 'b', label: t('B'), kind: 'fixed', amount: '1' }
            ]
        });
        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual([
            'lines.0.of.0',
            'lines.1.input',
            'lines.2.key'
        ]);
    });

    it('names its answer inputs as a contract', () => {
        expect(feeAnswerContract(RENEWAL)).toEqual({
            grade: { kind: 'choice', required: true },
            expiry: { kind: 'date', required: true },
            lost: { kind: 'boolean', required: false }
        });
    });
});
