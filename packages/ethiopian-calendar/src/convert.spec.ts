import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    addEthiopianDays,
    ethiopianToJdn,
    isEthiopianLeapYear,
    isValidEthiopianDate,
    jdnToEthiopian,
    toEthiopian,
    toGregorian,
    weekday,
    gregorianToJdn,
    type GregorianDate
} from './convert';

const g = (year: number, month: number, day: number): GregorianDate => ({ year, month, day });

describe('the reference table', () => {
    it('places Meskerem 1 of 1990–2030 E.C. on 11 September, or 12 September before a Gregorian leap year', () => {
        for (let year = 1990; year <= 2030; year++) {
            const gregorianYear = year + 7;
            const next = gregorianYear + 1;
            const leapNext = (next % 4 === 0 && next % 100 !== 0) || next % 400 === 0;
            expect(toGregorian({ year, month: 1, day: 1 }), `Meskerem 1, ${year}`).toEqual(
                g(gregorianYear, 9, leapNext ? 12 : 11)
            );
        }
    });

    it('matches dates known from history and the feasts', () => {
        const known: [GregorianDate, [number, number, number]][] = [
            [g(1896, 3, 1), [1888, 6, 23]], // the battle of Adwa, Yekatit 23 (1 March 1896; 2 March in today's calendar offset)
            [g(1974, 9, 12), [1967, 1, 2]], // Meskerem 2, 1967
            [g(2007, 9, 12), [2000, 1, 1]], // the Ethiopian millennium
            [g(2023, 9, 12), [2016, 1, 1]],
            [g(2024, 9, 11), [2017, 1, 1]],
            [g(2025, 9, 11), [2018, 1, 1]],
            [g(2025, 1, 7), [2017, 4, 29]], // Gena, Tahsas 29
            [g(2024, 1, 7), [2016, 4, 28]], // Gena after a leap year, Tahsas 28
            [g(2025, 1, 19), [2017, 5, 11]], // Timket, Tir 11
            [g(2024, 1, 20), [2016, 5, 11]], // Timket in a Gregorian leap year
            [g(2023, 9, 11), [2015, 13, 6]], // Pagume 6 of a leap year
            [g(2026, 7, 8), [2018, 11, 1]] // Hamle 1: the fiscal year 2019 begins
        ];
        for (const [gregorian, [year, month, day]] of known) {
            expect(toEthiopian(gregorian), JSON.stringify(gregorian)).toEqual({ year, month, day });
            expect(toGregorian({ year, month, day })).toEqual(gregorian);
        }
    });

    it('knows the weekday: 11 September 2025 was a Thursday', () => {
        expect(weekday(gregorianToJdn(g(2025, 9, 11)))).toBe(4);
    });
});

describe('every day from 1900 to 2100', () => {
    // ICU's Ethiopic calendar, an independent implementation, as the oracle (tests only: the package has no dependency)
    const icu = new Intl.DateTimeFormat('en-u-ca-ethiopic', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        timeZone: 'UTC'
    });
    const viaIcu = (date: GregorianDate) => {
        const parts = Object.fromEntries(
            icu.formatToParts(new Date(Date.UTC(date.year, date.month - 1, date.day))).map((p) => [p.type, p.value])
        );
        return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
    };

    it('round-trips, agrees with ICU, and steps one day at a time', () => {
        const first = gregorianToJdn(g(1900, 1, 1));
        const last = gregorianToJdn(g(2100, 12, 31));
        let previous = jdnToEthiopian(first - 1);
        for (let jdn = first; jdn <= last; jdn++) {
            const ethiopian = jdnToEthiopian(jdn);
            expect(isValidEthiopianDate(ethiopian)).toBe(true);
            if (ethiopianToJdn(ethiopian) !== jdn) throw new Error(`no round trip at JDN ${jdn}`);
            // the next day: the same month, the next month, or Meskerem 1 of the next year
            const next =
                ethiopian.day === previous.day + 1 ||
                (ethiopian.day === 1 && (ethiopian.month === previous.month + 1 || ethiopian.month === 1));
            if (!next) throw new Error(`a jump at JDN ${jdn}`);
            previous = ethiopian;
        }
        // ICU for every 7th day (all of them takes long): the whole span, every weekday and month position
        for (let jdn = first; jdn <= last; jdn += 7) {
            const ethiopian = jdnToEthiopian(jdn);
            const gregorian = toGregorian(ethiopian);
            const expected = viaIcu(gregorian);
            if (JSON.stringify(ethiopian) !== JSON.stringify(expected))
                throw new Error(
                    `${JSON.stringify(gregorian)}: ${JSON.stringify(ethiopian)} ≠ ICU ${JSON.stringify(expected)}`
                );
        }
    });

    it('holds for any day and any shift (property)', () => {
        const day = fc.integer({ min: gregorianToJdn(g(1900, 1, 1)), max: gregorianToJdn(g(2100, 12, 31)) });
        fc.assert(
            fc.property(day, fc.integer({ min: -5000, max: 5000 }), (jdn, shift) => {
                const e = jdnToEthiopian(jdn);
                const moved = addEthiopianDays(e, shift);
                return (
                    ethiopianToJdn(moved) === jdn + shift &&
                    JSON.stringify(toEthiopian(toGregorian(e))) === JSON.stringify(e)
                );
            })
        );
    });
});

describe('leap years and Pagume', () => {
    it('gives Pagume 6 days in a year before a Gregorian leap year, and refuses Pagume 6 otherwise', () => {
        expect(isEthiopianLeapYear(2015)).toBe(true);
        expect(isEthiopianLeapYear(2018)).toBe(false);
        expect(isValidEthiopianDate({ year: 2015, month: 13, day: 6 })).toBe(true);
        expect(isValidEthiopianDate({ year: 2018, month: 13, day: 6 })).toBe(false);
        expect(() => toGregorian({ year: 2018, month: 13, day: 6 })).toThrow(RangeError);
        expect(() => toGregorian({ year: 2018, month: 2, day: 31 })).toThrow(RangeError);
        expect(() => toEthiopian(g(2025, 2, 29))).toThrow(RangeError);
    });
});
