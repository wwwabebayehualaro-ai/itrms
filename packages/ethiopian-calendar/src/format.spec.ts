import { describe, expect, it } from 'vitest';

import {
    addisDate,
    efy,
    ethiopianDateAfter,
    ethiopianDayStart,
    fiscalQuarter,
    fiscalQuarterOf,
    fiscalYearOf,
    fiscalYearRange,
    formatEthiopian,
    formatEthiopianLong,
    formatEthiopianTime,
    startOfAddisDay,
    toEthiopicNumeral,
    toEthiopianTime
} from './index';

const date = { year: 2019, month: 2, day: 12 }; // Tikimt 12, 2019 (22 October 2026)

describe('formatting, per language', () => {
    it('writes the long form', () => {
        expect(
            Object.fromEntries(
                (['am', 'en', 'wal-Latn', 'om', 'ti'] as const).map((l) => [
                    l,
                    formatEthiopianLong(date, { language: l })
                ])
            )
        ).toMatchInlineSnapshot(`
          {
            "am": "ጥቅምት 12 ቀን 2019 ዓ.ም",
            "en": "12 Tikimt 2019 E.C.",
            "om": "Onkoloolessa 12, 2019 A.L.I.",
            "ti": "ጥቅምቲ 12 ዕለት 2019 ዓ.ም",
            "wal-Latn": "12 Tikimt 2019 E.C.",
          }
        `);
    });

    it('writes numbers, weekdays, quoted text and Ethiopic numerals', () => {
        expect(formatEthiopian(date, 'dd/MM/yyyy')).toBe('12/02/2019');
        expect(formatEthiopian(date, "EEEE, d MMMM yyyy 'o''clock'", { language: 'en' })).toBe(
            "Thursday, 12 Tikimt 2019 o'clock"
        );
        expect(formatEthiopian(date, 'EEEE MMMM d yyyy G', { language: 'am', numerals: 'ethiopic' })).toBe(
            'ሐሙስ ጥቅምት ፲፪ ፳፻፲፱ ዓ.ም'
        );
        // 2018 is not a leap year: no Pagume 6
        expect(() => formatEthiopian({ year: 2018, month: 13, day: 6 }, 'd')).toThrow(RangeError);
    });

    it('writes Ethiopic numerals', () => {
        expect([1, 9, 10, 12, 99, 100, 101, 200, 1000, 2018, 10_000, 12_345, 1_000_000].map(toEthiopicNumeral)).toEqual(
            ['፩', '፱', '፲', '፲፪', '፺፱', '፻', '፻፩', '፪፻', '፲፻', '፳፻፲፰', '፼', '፼፳፫፻፵፭', '፻፼']
        );
        // ፩ before a ፼ that is not the leading one: these must not read like 1 000 000, 2 000 000 and 10⁸
        expect([1_010_000, 2_010_000, 100_010_000, 10_100].map(toEthiopicNumeral)).toEqual([
            '፻፩፼',
            '፪፻፩፼',
            '፼፩፼',
            '፼፻'
        ]);
        expect(() => toEthiopicNumeral(0)).toThrow(RangeError);
    });

    it('refuses a pattern it cannot read', () => {
        expect(() => formatEthiopian(date, 'MMM')).toThrow(/pattern/);
        expect(() => formatEthiopian(date, "'today d")).toThrow(/pattern/);
        expect(formatEthiopian(date, "'today' d")).toBe('today 12');
    });
});

describe('the fiscal year (Hamle 1 – Sene 30)', () => {
    it('is named by the year it ends in, with its quarters', () => {
        expect(fiscalYearOf({ year: 2018, month: 10, day: 30 })).toBe(2018);
        expect(fiscalYearOf({ year: 2018, month: 11, day: 1 })).toBe(2019);
        expect(fiscalYearRange(2019)).toEqual({
            start: { year: 2018, month: 11, day: 1 },
            end: { year: 2019, month: 10, day: 30 }
        });
        const quarters = Array.from({ length: 13 }, (_, i) => fiscalQuarterOf({ year: 2019, month: i + 1, day: 1 }));
        // Meskerem … Pagume
        expect(quarters).toEqual([1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 1, 1, 1]);
    });

    it('of an instant is the one of its Addis Ababa date', () => {
        expect(efy(new Date('2026-07-07T20:59:00Z'))).toBe(2018); // 23:59 on Sene 30 in Addis
        expect(efy(new Date('2026-07-07T21:00:00Z'))).toBe(2019); // 00:00 on Hamle 1 in Addis
        expect(fiscalQuarter(new Date('2026-10-22T09:00:00Z'))).toBe(2);
    });
});

describe('Addis Ababa business dates', () => {
    it('take the date and the day start in UTC+3', () => {
        expect(addisDate(new Date('2026-10-21T21:30:00Z'))).toEqual({ year: 2026, month: 10, day: 22 });
        expect(startOfAddisDay({ year: 2026, month: 10, day: 22 }).toISOString()).toBe('2026-10-21T21:00:00.000Z');
        expect(startOfAddisDay({ year: 50, month: 3, day: 1 }).toISOString()).toBe('0050-02-28T21:00:00.000Z');
        expect(ethiopianDayStart({ year: 2019, month: 2, day: 12 }).toISOString()).toBe('2026-10-21T21:00:00.000Z');
        expect(ethiopianDateAfter(new Date('2026-10-22T09:00:00Z'), 30)).toEqual({ year: 2019, month: 3, day: 12 });
    });
});

describe('the Ethiopian clock', () => {
    it('counts the hours from 06:00', () => {
        expect(toEthiopianTime(7, 30)).toEqual({ hour: 1, minute: 30, period: 'morning' });
        expect(toEthiopianTime(12, 0)).toEqual({ hour: 6, minute: 0, period: 'afternoon' });
        expect(toEthiopianTime(18, 0)).toEqual({ hour: 12, minute: 0, period: 'evening' });
        expect(toEthiopianTime(0, 5)).toEqual({ hour: 6, minute: 5, period: 'night' });
        expect(formatEthiopianTime(7, 30)).toBe('1:30 ጠዋት');
        expect(formatEthiopianTime(19, 15, 'en')).toBe('1:15 evening');
        expect(() => toEthiopianTime(24, 0)).toThrow(RangeError);
    });
});
