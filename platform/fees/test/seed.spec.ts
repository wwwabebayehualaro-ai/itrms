/**
 * The competency services' demo fee rules (task 0.22a): each parses, its formulas read only its inputs, its amounts are
 * marked as placeholders, and a renewal works out as its lines say (Ethiopian calendar months, at most 24).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFeeRule, evaluateFee } from '@itrms/form-engine/core';
import { describe, expect, it } from 'vitest';

import { parseFeeRules } from '../seed';

const FILE = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'modules',
    'competency',
    'seed',
    'fee-rules.demo.yaml'
);
const rules = parseFeeRules(readFileSync(FILE, 'utf8'));
const rule = (key: string) => {
    const found = rules.find((r) => r.key === key);
    if (!found) throw new Error(`no rule ${key}`);
    return found.document;
};

describe('the demo fee rules', () => {
    it('parse, read only their own inputs, and are marked as placeholders', () => {
        expect(rules.map((r) => r.key)).toEqual([
            'dvc-03-new-licence',
            'dvc-04-renewal',
            'dvc-06-replacement',
            'dvc-01-registration'
        ]);
        for (const r of rules) {
            expect(checkFeeRule(r.document), r.key).toEqual([]);
            expect(r.document.demo, r.key).toBe(true);
        }
    });

    it('work a late renewal out by started Ethiopian month, with the over-a-year line', () => {
        // expiry Tahsas 23, 2018 (2026-01-01): on Megabit 23 (2026-04-01) three months are up; the next day begins a fourth
        const late = evaluateFee(rule('dvc-04-renewal'), {
            answers: { grade: 'automobile', expiry: '2026-01-01' },
            asOf: '2026-04-01'
        });
        expect(late).toMatchObject({
            status: 'complete',
            total: 20000n + 15000n,
            lines: [
                { key: 'base', amount: 20000n },
                { key: 'penalty', quantity: 3, amount: 15000n }
            ]
        });
        expect(
            evaluateFee(rule('dvc-04-renewal'), {
                answers: { grade: 'automobile', expiry: '2026-01-01' },
                asOf: '2026-04-02'
            })
        ).toMatchObject({ lines: [{ key: 'base' }, { key: 'penalty', quantity: 4, amount: 20000n }] });
        const veryLate = evaluateFee(rule('dvc-04-renewal'), {
            answers: { grade: 'public-1', expiry: '2023-01-01', lost: true },
            asOf: '2026-01-01'
        });
        expect(veryLate).toMatchObject({
            status: 'complete',
            total: 25000n + 24n * 5000n + 20000n + 10000n
        });
    });

    it('charge a grade a table does not name by its otherwise amount, and a replacement by its item', () => {
        expect(
            evaluateFee(rule('dvc-03-new-licence'), { answers: { grade: 'heavy-truck' }, asOf: '2026-01-01' })
        ).toMatchObject({ status: 'complete', total: 50000n + 15000n + 10000n });
        expect(
            evaluateFee(rule('dvc-06-replacement'), { answers: { item: 'plate' }, asOf: '2026-01-01' })
        ).toMatchObject({ status: 'complete', total: 35000n });
    });

    it('charge a new registration by the vehicle category, with the plate and the libre', () => {
        expect(
            evaluateFee(rule('dvc-01-registration'), { answers: { categoryKey: 'automobile' }, asOf: '2026-01-01' })
        ).toMatchObject({
            status: 'complete',
            total: 100000n + 50000n + 20000n,
            lines: [{ key: 'base', amount: 100000n }, { key: 'plate' }, { key: 'libre' }]
        });
        expect(
            evaluateFee(rule('dvc-01-registration'), { answers: { categoryKey: 'unlisted' }, asOf: '2026-01-01' })
        ).toMatchObject({ status: 'complete', total: 150000n + 50000n + 20000n });
    });
});
