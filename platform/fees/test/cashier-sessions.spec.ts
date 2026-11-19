/**
 * The cashier session's rules that need no database (task 1.12, ADR-0063): a count by denomination is added up in whole
 * santim (BigInt, never a float), the settings accept the region's values and refuse the others, and a count's input is
 * strict.
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_DENOMINATIONS,
    DENOMINATIONS_SETTING,
    FEES_SETTINGS,
    SESSION_APPROVER_ROLES_SETTING,
    countDecisionSchema,
    denominationTotal,
    sessionCountSchema,
    sessionOpenSchema
} from '../contracts';

describe('a count by denomination', () => {
    it('adds up in santim, exactly, however many pieces', () => {
        expect(denominationTotal([])).toBe(0n);
        expect(
            denominationTotal([
                { valueSantim: 20000, count: 3 },
                { valueSantim: 5, count: 7 }
            ])
        ).toBe(60035n);
        // a float would round this
        expect(denominationTotal([{ valueSantim: 99_999_999, count: 999_999 }])).toBe(99_999_899_000_001n);
    });

    it('differs from what is expected by a signed whole number', () => {
        const expected = 40000n;
        expect(39900n - expected).toBe(-100n);
        expect(41000n - expected).toBe(1000n);
    });
});

describe('the settings', () => {
    it('accept the default denominations and roles, and refuse a repeated or non-integer denomination', () => {
        expect(FEES_SETTINGS[DENOMINATIONS_SETTING].safeParse([...DEFAULT_DENOMINATIONS]).success).toBe(true);
        expect(FEES_SETTINGS[DENOMINATIONS_SETTING].safeParse([100, 100]).success).toBe(false);
        expect(FEES_SETTINGS[DENOMINATIONS_SETTING].safeParse([0.5]).success).toBe(false);
        expect(FEES_SETTINGS[SESSION_APPROVER_ROLES_SETTING].safeParse(['finance_officer']).success).toBe(true);
        expect(FEES_SETTINGS[SESSION_APPROVER_ROLES_SETTING].safeParse([]).success).toBe(false);
    });
});

describe('a count and its decision', () => {
    it('take amounts as santim text, nothing more', () => {
        expect(sessionOpenSchema.parse({}).openingFloatSantim).toBe('0');
        expect(sessionOpenSchema.safeParse({ openingFloatSantim: '-1' }).success).toBe(false);
        expect(sessionCountSchema.safeParse({ countedSantim: '39900', note: 'One Birr short' }).success).toBe(true);
        expect(sessionCountSchema.safeParse({ countedSantim: 39900 }).success).toBe(false);
        expect(sessionCountSchema.safeParse({ countedSantim: '1', extra: true }).success).toBe(false);
        expect(countDecisionSchema.safeParse({ decision: 'approved' }).success).toBe(false);
        expect(countDecisionSchema.safeParse({ decision: 'reject', note: 'Count again' }).success).toBe(true);
    });
});
