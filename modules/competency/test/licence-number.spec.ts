import { formatNumber } from '@itrms/kernel/numbering';
import { describe, expect, it } from 'vitest';

import {
    BLOOD_GROUPS,
    cardSerialQuery,
    foldCardSerial,
    isCardSerial,
    LICENCE_NUMBERING_DEFAULT,
    licenceHealthRecordSchema,
    licenceNumberingSchema,
    licenceSchema,
    regionalCounterSetup,
    regionalLicencePattern
} from '../contracts';

describe('the regional licence number (task 1.6, ADR-0051)', () => {
    it('is the region code and five digits of its one sequence', () => {
        const pattern = regionalLicencePattern('06');
        expect(formatNumber(pattern, { unit: 'WOL-BODITI', seq: 1n, efy: 2019 })).toBe('06-00001');
        expect(formatNumber(pattern, { unit: 'WOL', seq: 123456n, efy: 2019 })).toBe('06-123456');
    });

    it('starts after the first number of the range the region reserves', () => {
        expect(regionalCounterSetup({ scope: 'region', regionCode: '06', firstNumber: 50001 })).toEqual({
            pattern: '06-{seq:05}',
            startAfter: 50000n
        });
        expect(regionalCounterSetup({ scope: 'region', regionCode: '06', firstNumber: 1 })).toMatchObject({
            startAfter: 0n
        });
    });

    it('is not set up for a region that has not given its code and first number', () => {
        expect(LICENCE_NUMBERING_DEFAULT).toEqual({ scope: 'region' });
        expect(regionalCounterSetup(LICENCE_NUMBERING_DEFAULT)).toMatchObject({
            problem: expect.stringMatching(/regionCode and firstNumber/) as unknown
        });
        expect(regionalCounterSetup({ scope: 'region', regionCode: '06' })).toHaveProperty('problem');
        expect(regionalCounterSetup({ scope: 'region', firstNumber: 1 })).toHaveProperty('problem');
        // per office: no regional counter at all
        expect(regionalCounterSetup({ scope: 'unit' })).toBeNull();
    });

    it('takes a two-digit code and a positive first number only', () => {
        expect(licenceNumberingSchema.safeParse({ scope: 'region', regionCode: '06', firstNumber: 1 }).success).toBe(
            true
        );
        for (const bad of [
            { scope: 'region', regionCode: '6', firstNumber: 1 },
            { scope: 'region', regionCode: '006', firstNumber: 1 },
            { scope: 'region', regionCode: 'AB', firstNumber: 1 },
            { scope: 'region', regionCode: '06', firstNumber: 0 },
            { scope: 'region', regionCode: '06', firstNumber: 1.5 },
            { scope: 'zone' },
            { scope: 'unit', extra: true }
        ])
            expect(licenceNumberingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
});

describe('the card serial (task 1.6, ADR-0064 §3)', () => {
    it('is 1–20 letters, digits or dashes, checked without a pattern', () => {
        for (const good of ['A', 'PC01', 'DL-2019-000123', 'x'.repeat(20)]) expect(isCardSerial(good), good).toBe(true);
        for (const bad of ['', 'x'.repeat(21), 'PC 01', 'PC%', 'PC_1', 'ሀ1', 'PC/1', "PC'1"])
            expect(isCardSerial(bad), bad).toBe(false);
    });

    it('is searched folded to capitals, and refused when it could be a wildcard', () => {
        expect(cardSerialQuery.parse(' pc03 ')).toBe('PC03');
        expect(foldCardSerial(' dl-1 ')).toBe('DL-1');
        expect(cardSerialQuery.safeParse('PC%').success).toBe(false);
        // a long run of the same character is answered at once (no backtracking to wait on)
        expect(cardSerialQuery.safeParse(`${'-'.repeat(19)}!`).success).toBe(false);
    });
});

describe('the blood group (task 1.6, ADR-0052)', () => {
    it('is one of the eight groups', () => {
        expect(BLOOD_GROUPS).toEqual(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
        expect(licenceHealthRecordSchema.safeParse({ bloodGroup: 'AB-' }).success).toBe(true);
        expect(licenceHealthRecordSchema.safeParse({ bloodGroup: 'ab-' }).success).toBe(false);
        expect(licenceHealthRecordSchema.safeParse({ bloodGroup: 'O+', note: 'x' }).success).toBe(false);
    });

    it('never has a place in a licence as the register shows it: only whether one is on record', () => {
        const keys = Object.keys(licenceSchema.shape);
        expect(keys).toContain('bloodGroupOnRecord');
        expect(keys.filter((k) => k.toLowerCase().includes('blood'))).toEqual([
            'bloodGroupOnRecord',
            'bloodGroupCollected'
        ]);
    });
});
