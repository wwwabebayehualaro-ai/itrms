/**
 * The printed number of a paper licence (task 1.6b, ADR-0051 §4): its shape, and whether it is one ITRMS gives itself, which a
 * paper licence cannot carry.
 */
import { describe, expect, it } from 'vitest';

import {
    COMPETENCY_SETTINGS,
    foldLicenceNumber,
    inLicenceRange,
    isPaperLicenceNumber,
    lapseOf,
    LICENCE_CAPTURE_EXPIRED_DEFAULT,
    LICENCE_CAPTURE_EXPIRED_SETTING
} from '../contracts';

const REGIONAL = { scope: 'region', regionCode: '06', firstNumber: 50_000 } as const;

describe('a printed licence number', () => {
    it('is letters, digits, "-" or "/", up to 30', () => {
        for (const ok of ['06-01234', '1-004512', 'WOL/DL/000012', 'ሀ-12'])
            expect(isPaperLicenceNumber(ok), ok).toBe(true);
        for (const bad of ['', '06 01234', '06-01234!', 'x'.repeat(31), '06_1234'])
            expect(isPaperLicenceNumber(bad), bad).toBe(false);
        expect(foldLicenceNumber(' wol/dl/000012 ')).toBe('WOL/DL/000012');
    });

    it('is inside the regional range from the first number on, in the region’s code only', () => {
        expect(inLicenceRange('06-50000', REGIONAL)).toBe(true);
        expect(inLicenceRange('06-73215', REGIONAL)).toBe(true);
        expect(inLicenceRange('06-49999', REGIONAL)).toBe(false);
        expect(inLicenceRange('06-01234', REGIONAL)).toBe(false);
        // another region's code, an old booklet's grade prefix, a number with letters after the code
        expect(inLicenceRange('07-73215', REGIONAL)).toBe(false);
        expect(inLicenceRange('1-73215', REGIONAL)).toBe(false);
        expect(inLicenceRange('06-7A215', REGIONAL)).toBe(false);
    });

    it('is inside an office’s own series in either scope, and a region without its code reserves nothing else', () => {
        expect(inLicenceRange('WOL-BODITI/DL/000012', REGIONAL)).toBe(true);
        expect(inLicenceRange('wol-boditi/dl/000012', { scope: 'unit' })).toBe(true);
        expect(inLicenceRange('WOL-BODITI/DL/12', { scope: 'unit' })).toBe(false);
        expect(inLicenceRange('06-73215', { scope: 'unit' })).toBe(false);
        expect(inLicenceRange('06-73215', { scope: 'region' })).toBe(false);
    });
});

describe('an expired paper licence (Proclamation 1074/2018 Art. 19(5))', () => {
    it('is expired after its last day, and more than a year late only after the year’s last day', () => {
        expect(lapseOf('2026-11-20', '2026-11-20')).toEqual({ expired: false, lateOverYear: false });
        expect(lapseOf('2026-11-19', '2026-11-20')).toEqual({ expired: true, lateOverYear: false });
        expect(lapseOf('2025-11-20', '2026-11-20')).toEqual({ expired: true, lateOverYear: false });
        expect(lapseOf('2025-11-19', '2026-11-20')).toEqual({ expired: true, lateOverYear: true });
    });

    it('is taken by default, and the region may refuse the late ones or every one', () => {
        const schema = COMPETENCY_SETTINGS[LICENCE_CAPTURE_EXPIRED_SETTING];
        expect(LICENCE_CAPTURE_EXPIRED_DEFAULT).toBe('accept');
        for (const ok of ['accept', 'refuse_late', 'refuse']) expect(schema.safeParse(ok).success, ok).toBe(true);
        for (const bad of ['', 'never', true, 1]) expect(schema.safeParse(bad).success, String(bad)).toBe(false);
    });
});
