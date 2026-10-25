/**
 * Days the way the stored form keeps them: ISO Gregorian ("YYYY-MM-DD", an instant for a date with a time), shown Ethiopian.
 * The Ethiopian conversion is packages/ethiopian-calendar's; this only reads and words a stored day.
 */
import {
    CALENDAR_LANGUAGES,
    formatEthiopian,
    formatEthiopianLong,
    isValidGregorianDate,
    SHORT_PATTERN,
    toEthiopian,
    type CalendarLanguage
} from '@itrms/ethiopian-calendar';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" and a real Gregorian day (2026-02-30 is not one: it is not rolled over to March). */
export function isIsoDay(v: unknown): v is string {
    const m = typeof v === 'string' ? DAY.exec(v) : null;
    return !!m && isValidGregorianDate({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
}

/** A day the way `Calendar` stores it, or any instant `Date` reads: null when it is neither (blank included). */
export function parseDate(v: unknown): Date | null {
    if (v === undefined || v === null || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const day = typeof v === 'string' ? DAY.exec(v) : null;
    const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
}

const calendarLanguage = (language: string | undefined): CalendarLanguage =>
    CALENDAR_LANGUAGES.find((l) => l === language) ?? 'am';

/**
 * An ISO day (or the day of an instant) as an Ethiopian date: "12/01/2019" (day/month/year), or with `long` the words
 * ("ጥቅምት 12 ቀን 2019 ዓ.ም"). A language the calendar has no names for reads Amharic. '' when it is not a day.
 */
export function ethiopianDateText(iso: unknown, opts: { language?: string; long?: boolean } = {}): string {
    const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(iso) : null;
    const greg = m && { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    if (!greg || !isValidGregorianDate(greg)) return '';
    const options = { language: calendarLanguage(opts.language) };
    const date = toEthiopian(greg);
    return opts.long ? formatEthiopianLong(date, options) : formatEthiopian(date, SHORT_PATTERN, options);
}
