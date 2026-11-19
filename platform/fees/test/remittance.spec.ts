/**
 * The remittance's arithmetic (task 1.12d, ADR-0063 §5), without a database: the accounts the fee lines are booked to, the
 * golden lines and totals, the late reversals as negative lines under the receipt's frozen account, and what goes to the bank.
 */
import { describe, expect, it } from 'vitest';

import {
    ACCOUNTS_SETTING,
    accountsSettingSchema,
    DEFAULT_ACCOUNTS,
    FEES_SETTINGS,
    type AccountsSetting
} from '../contracts';
import { bookTo, buildRemittance, depositFigures, groupLines } from '../api/remittance-build';

const name = (en: string) => ({ am: en, en });
const ACCOUNTS: AccountsSetting = {
    demo: true,
    default: { code: '9999', budgetCategory: 'DEF', name: name('Default') },
    lines: { licence: { code: '1101', budgetCategory: 'REV', name: name('Licence fees') } }
};

const R1 = '00000000-0000-4000-8000-000000000001';
const R2 = '00000000-0000-4000-8000-000000000002';
const V1 = '00000000-0000-4000-8000-0000000000a1';

describe('the accounts setting', () => {
    it('is a registered setting, and its default is a placeholder flagged demo', () => {
        expect(FEES_SETTINGS[ACCOUNTS_SETTING].safeParse(DEFAULT_ACCOUNTS).success).toBe(true);
        expect(DEFAULT_ACCOUNTS.demo).toBe(true);
        expect(accountsSettingSchema.safeParse({ ...ACCOUNTS, extra: 1 }).success).toBe(false);
        expect(accountsSettingSchema.safeParse({ ...ACCOUNTS, lines: { 'Bad Key': ACCOUNTS.default } }).success).toBe(
            false
        );
    });

    it('books a line to its own account, else the default, flagged', () => {
        expect(bookTo(ACCOUNTS, 'licence')).toMatchObject({ accountCode: '1101', mappedByDefault: false });
        expect(bookTo(ACCOUNTS, 'card')).toMatchObject({ accountCode: '9999', mappedByDefault: true });
        // a key of the prototype chain is no account
        expect(bookTo(ACCOUNTS, 'constructor')).toMatchObject({ accountCode: '9999', mappedByDefault: true });
    });
});

describe('buildRemittance', () => {
    const receipts = [
        { receiptId: R1, orderLinePosition: 1, lineKey: 'licence', method: 'cash' as const, amountSantim: 40000n },
        { receiptId: R1, orderLinePosition: 2, lineKey: 'card', method: 'cash' as const, amountSantim: 5000n },
        { receiptId: R2, orderLinePosition: 1, lineKey: 'licence', method: 'bank_slip' as const, amountSantim: 40000n }
    ];

    it('gives the golden lines and totals: the total is the receipts less the late reversals', () => {
        const built = buildRemittance(
            receipts,
            [
                {
                    reversalId: V1,
                    receiptId: R1,
                    orderLinePosition: 1,
                    lineKey: 'licence',
                    method: 'cash',
                    amountSantim: 40000n
                }
            ],
            ACCOUNTS
        );
        expect(built.totals).toEqual({ revenueTotal: 45000n, cash: 45000n, bankSlip: 40000n, reversal: -40000n });
        expect(
            built.lines.map((l) => [
                l.kind,
                l.receiptId.slice(-1),
                l.orderLinePosition,
                l.accountCode,
                l.mappedByDefault,
                String(l.amountSantim)
            ])
        ).toEqual([
            ['receipt', '1', 1, '1101', false, '40000'],
            ['receipt', '1', 2, '9999', true, '5000'],
            ['receipt', '2', 1, '1101', false, '40000'],
            ['reversal', '1', 1, '1101', false, '-40000']
        ]);
        expect(built.totals.revenueTotal).toBe(built.lines.reduce((sum, l) => sum + l.amountSantim, 0n));
    });

    it('books a reversal of an earlier remittance under the account frozen then, never worked out again', () => {
        const frozen = { accountCode: '0001', budgetCategory: 'OLD', accountName: name('Old'), mappedByDefault: false };
        const built = buildRemittance(
            [],
            [
                {
                    reversalId: V1,
                    receiptId: R1,
                    orderLinePosition: 1,
                    lineKey: 'licence',
                    method: 'cash',
                    amountSantim: 100n,
                    frozen
                }
            ],
            ACCOUNTS
        );
        expect(built.lines[0]).toMatchObject({ kind: 'reversal', accountCode: '0001', amountSantim: -100n });
        expect(built.totals).toEqual({ revenueTotal: -100n, cash: 0n, bankSlip: 0n, reversal: -100n });
    });

    it('refuses a reversal with no booked receipt line, and a receipt line that is not positive', () => {
        expect(() =>
            buildRemittance(
                [],
                [
                    {
                        reversalId: V1,
                        receiptId: R1,
                        orderLinePosition: 1,
                        lineKey: 'x',
                        method: 'cash',
                        amountSantim: 1n
                    }
                ],
                ACCOUNTS
            )
        ).toThrow(/no booked receipt line/);
        expect(() =>
            buildRemittance(
                [{ receiptId: R1, orderLinePosition: 1, lineKey: 'x', method: 'cash', amountSantim: 0n }],
                [],
                ACCOUNTS
            )
        ).toThrow();
    });

    it('groups by account code and budget category', () => {
        const built = buildRemittance(
            receipts,
            [
                {
                    reversalId: V1,
                    receiptId: R1,
                    orderLinePosition: 1,
                    lineKey: 'licence',
                    method: 'cash',
                    amountSantim: 40000n
                }
            ],
            ACCOUNTS
        );
        expect(
            groupLines(built.lines).map((g) => [
                g.accountCode,
                g.mappedByDefault,
                String(g.receipt),
                String(g.reversal),
                g.lineCount
            ])
        ).toEqual([
            ['1101', false, '80000', '-40000', 3],
            ['9999', true, '5000', '0', 1]
        ]);
    });
});

describe('what goes to the bank', () => {
    it('is the counted cash less the floats, and the difference is counted less expected (signed)', () => {
        expect(
            depositFigures([
                { openingFloatSantim: 5000n, expectedSantim: 45000n, countedSantim: 44500n },
                { openingFloatSantim: 0n, expectedSantim: 10000n, countedSantim: 10000n }
            ])
        ).toEqual({ depositDue: 49500n, difference: -500n });
        expect(depositFigures([])).toEqual({ depositDue: 0n, difference: 0n });
    });
});
