/**
 * Business dates in Africa/Addis_Ababa (architecture.md §13): instants are stored in UTC, but "today", a due date and a
 * fiscal year are those of Addis Ababa, UTC+3 all year (Ethiopia has no daylight saving time). Plain arithmetic, so the
 * package depends on no time-zone data.
 */
import {
    gregorianToJdn,
    jdnToEthiopian,
    toEthiopian,
    toGregorian,
    type EthiopianDate,
    type GregorianDate
} from './convert';
import { fiscalQuarterOf, fiscalYearOf } from './fiscal';

export const ADDIS_ABABA_OFFSET_MINUTES = 180;
const OFFSET_MS = ADDIS_ABABA_OFFSET_MINUTES * 60_000;

/** The Gregorian date of an instant in Addis Ababa. */
export function addisDate(instant: Date): GregorianDate {
    const t = new Date(instant.getTime() + OFFSET_MS);
    if (Number.isNaN(t.getTime())) throw new RangeError('Not a valid instant');
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** The Ethiopian date of an instant in Addis Ababa. */
export const addisEthiopianDate = (instant: Date): EthiopianDate => toEthiopian(addisDate(instant));

/** The instant a business day starts: midnight in Addis Ababa (21:00 UTC the day before). */
export function startOfAddisDay(date: GregorianDate): Date {
    // checks the date as it converts
    gregorianToJdn(date);
    // setUTCFullYear, not Date.UTC: Date.UTC reads the years 0–99 as 1900–1999
    const midnightUtc = new Date(0);
    midnightUtc.setUTCFullYear(date.year, date.month - 1, date.day);
    return new Date(midnightUtc.getTime() - OFFSET_MS);
}

/** The instant an Ethiopian business day starts in Addis Ababa (a date entered Ethiopian, stored as an instant). */
export const ethiopianDayStart = (date: EthiopianDate): Date => startOfAddisDay(toGregorian(date));

/** The Ethiopian fiscal year of an instant (Addis Ababa): `efy(new Date())`. */
export const efy = (instant: Date): number => fiscalYearOf(addisEthiopianDate(instant));

/** The fiscal quarter of an instant (Addis Ababa), 1–4. */
export const fiscalQuarter = (instant: Date): number => fiscalQuarterOf(addisEthiopianDate(instant));

/** Today's Ethiopian date in Addis Ababa. */
export const ethiopianToday = (now: Date = new Date()): EthiopianDate => addisEthiopianDate(now);

/** The Ethiopian date `days` after an instant's Addis date (due dates, SLA ends). */
export const ethiopianDateAfter = (instant: Date, days: number): EthiopianDate =>
    jdnToEthiopian(gregorianToJdn(addisDate(instant)) + days);
