/**
 * The arithmetic of the reconciliation report (task 1.13h): plate-code groups, what is missing and the migrated share.
 */
import { describe, expect, it } from 'vitest';

import { missingOf, plateCodeOf, sumsOf } from '../api/reconciliation';

describe('plateCodeOf', () => {
    it('maps the old regional use codes to themselves', () => {
        expect([1, 2, 3, 4, 5, 35].map(plateCodeOf)).toEqual(['1', '2', '3', '4', '5', '35']);
    });
    it('puts anything else in other: no plate, a national plate, another code', () => {
        expect(plateCodeOf(null)).toBe('other');
        expect(plateCodeOf(undefined)).toBe('other');
        expect(plateCodeOf(6)).toBe('other');
        expect(plateCodeOf(0)).toBe('other');
    });
});

describe('missingOf', () => {
    it('is paper minus verified, never below zero', () => {
        expect(missingOf(10, 4)).toBe(6);
        expect(missingOf(3, 5)).toBe(0);
        expect(missingOf(0, 0)).toBe(0);
    });
    it('is unknown without a paper count', () => {
        expect(missingOf(null, 7)).toBeNull();
    });
});

describe('sumsOf', () => {
    it('adds the counted codes and measures the share over them only', () => {
        const sums = sumsOf([
            { paper: 10, verified: 4 },
            { paper: 5, verified: 6 },
            { paper: null, verified: 100 }
        ]);
        // code 2's surplus (6 of 5) does not make up for code 1's missing files
        expect(sums).toEqual({ verified: 110, paper: 15, missing: 6, share: 9 / 15 });
    });
    it('has no paper, missing or share when no code is counted', () => {
        expect(sumsOf([{ paper: null, verified: 3 }])).toEqual({
            verified: 3,
            paper: null,
            missing: null,
            share: null
        });
        expect(sumsOf([])).toEqual({ verified: 0, paper: null, missing: null, share: null });
    });
    it('has no share for a counted zero', () => {
        expect(sumsOf([{ paper: 0, verified: 0 }]).share).toBeNull();
    });
});
