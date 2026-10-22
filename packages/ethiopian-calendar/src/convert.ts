/**
 * Gregorian ↔ Ethiopian through the Julian Day Number (JDN): each calendar converts to and from the count of days, so the
 * two never meet directly. The Ethiopian calendar has 12 months of 30 days and Pagume (month 13) of 5 days, 6 in a leap
 * year; a year is leap when it leaves 3 when divided by 4 (the year before a Gregorian leap year). Years count from the
 * Incarnation era (Amete Mihret, "ዓ.ም"). Proleptic in both directions: valid for any date this system will meet.
 */

export interface CalendarDate {
    year: number;
    /** 1–12 Gregorian; 1–13 Ethiopian (13 is Pagume) */
    month: number;
    day: number;
}

/** A date of the Ethiopian calendar: `month` 1 is Meskerem, 13 is Pagume. */
export type EthiopianDate = CalendarDate;
export type GregorianDate = CalendarDate;

/** The JDN of Meskerem 1, year 1 (Amete Mihret), less one. */
const ETHIOPIAN_EPOCH = 1_724_220;

export const isEthiopianLeapYear = (year: number): boolean => ((year % 4) + 4) % 4 === 3;

export const daysInEthiopianMonth = (year: number, month: number): number =>
    month < 13 ? 30 : isEthiopianLeapYear(year) ? 6 : 5;

export const isGregorianLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const integer = (n: number) => Number.isInteger(n);

export function isValidEthiopianDate({ year, month, day }: EthiopianDate): boolean {
    return (
        integer(year) &&
        integer(month) &&
        integer(day) &&
        month >= 1 &&
        month <= 13 &&
        day >= 1 &&
        day <= daysInEthiopianMonth(year, month)
    );
}

export function isValidGregorianDate({ year, month, day }: GregorianDate): boolean {
    if (!integer(year) || !integer(month) || !integer(day) || month < 1 || month > 12 || day < 1) return false;
    const days = [31, isGregorianLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= (days[month - 1] ?? 0);
}

function assertValid(valid: boolean, what: string, date: CalendarDate) {
    if (!valid) throw new RangeError(`Not a valid ${what} date: ${date.year}-${date.month}-${date.day}`);
}

/** The JDN of a proleptic Gregorian date (Fliegel and Van Flandern). */
export function gregorianToJdn(date: GregorianDate): number {
    assertValid(isValidGregorianDate(date), 'Gregorian', date);
    const a = Math.floor((14 - date.month) / 12);
    const y = date.year + 4800 - a;
    const m = date.month + 12 * a - 3;
    return (
        date.day +
        Math.floor((153 * m + 2) / 5) +
        365 * y +
        Math.floor(y / 4) -
        Math.floor(y / 100) +
        Math.floor(y / 400) -
        32045
    );
}

export function jdnToGregorian(jdn: number): GregorianDate {
    const a = jdn + 32044;
    const b = Math.floor((4 * a + 3) / 146097);
    const c = a - Math.floor((146097 * b) / 4);
    const d = Math.floor((4 * c + 3) / 1461);
    const e = c - Math.floor((1461 * d) / 4);
    const m = Math.floor((5 * e + 2) / 153);
    return {
        year: 100 * b + d - 4800 + Math.floor(m / 10),
        month: m + 3 - 12 * Math.floor(m / 10),
        day: e - Math.floor((153 * m + 2) / 5) + 1
    };
}

export function ethiopianToJdn(date: EthiopianDate): number {
    assertValid(isValidEthiopianDate(date), 'Ethiopian', date);
    return ETHIOPIAN_EPOCH + 365 * (date.year - 1) + Math.floor(date.year / 4) + 30 * (date.month - 1) + date.day;
}

export function jdnToEthiopian(jdn: number): EthiopianDate {
    const year = Math.floor((4 * (jdn - ETHIOPIAN_EPOCH - 1) + 1463) / 1461);
    const dayOfYear = jdn - ethiopianToJdn({ year, month: 1, day: 1 });
    return { year, month: Math.floor(dayOfYear / 30) + 1, day: (dayOfYear % 30) + 1 };
}

export const toEthiopian = (date: GregorianDate): EthiopianDate => jdnToEthiopian(gregorianToJdn(date));
export const toGregorian = (date: EthiopianDate): GregorianDate => jdnToGregorian(ethiopianToJdn(date));

/** 0 Sunday … 6 Saturday. */
export const weekday = (jdn: number): number => (jdn + 1) % 7;

/** Days between two Ethiopian dates (`to` − `from`). */
export const ethiopianDaysBetween = (from: EthiopianDate, to: EthiopianDate): number =>
    ethiopianToJdn(to) - ethiopianToJdn(from);

/** The Ethiopian date `days` days after (or before) `date`. */
export const addEthiopianDays = (date: EthiopianDate, days: number): EthiopianDate =>
    jdnToEthiopian(ethiopianToJdn(date) + days);
