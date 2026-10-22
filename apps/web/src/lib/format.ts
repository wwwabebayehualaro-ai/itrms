import {
    addisDate,
    CALENDAR_LANGUAGES,
    formatEthiopianLong,
    toEthiopian,
    type CalendarLanguage
} from '@itrms/ethiopian-calendar';

/** Shared display formatters. Use these instead of ad-hoc toLocale* calls so the app formats consistently. */
const LOCALE = 'en-US';

const toDate = (value?: string | number | Date | null) => {
    if (value === undefined || value === null || value === '') return null;
    // a date without a time ("2026-09-15") is that calendar day wherever the reader is; `new Date()` would read it as UTC midnight
    const day = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    const d = day
        ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
        : value instanceof Date
          ? value
          : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

export function formatDate(value?: string | number | Date | null, empty = 'No date') {
    const d = toDate(value);
    return d ? d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }) : empty;
}

export function formatDateTime(value?: string | number | Date | null, empty = 'No date') {
    const d = toDate(value);
    return d
        ? d.toLocaleString(LOCALE, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
          })
        : empty;
}

export function formatCurrency(value: number, currency = 'USD') {
    return value.toLocaleString(LOCALE, { style: 'currency', currency });
}

export function formatBytes(bytes?: number | null) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Locale-aware formatting (task 0.13, i18n-and-languages.md): the person's language and calendar. Money is integer
// santim end to end (CLAUDE.md: never a float): Birr and santim are split with bigint arithmetic, never divided as numbers.

/** Grouping and digits per language: Ethiopic text uses Western digits and commas, as the bureaus write them. */
const NUMBER_LOCALE: Record<string, string> = {
    am: 'en-US',
    en: 'en-US',
    'wal-Latn': 'en-US',
    om: 'en-US',
    ti: 'en-US'
};

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 1234567 → "1,234,567". */
export function formatNumberIn(value: number | bigint, language = 'am'): string {
    return typeof value === 'bigint'
        ? (value < 0n ? '-' : '') + group((value < 0n ? -value : value).toString())
        : value.toLocaleString(NUMBER_LOCALE[language] ?? 'en-US');
}

/**
 * An amount in santim (bigint, or its integer string from the API; never a number, which could be a float) as Birr:
 * "1,234.50 ብር" (Amharic, Tigrinya), "Birr 1,234.50" (English and the others). Anything else shows `empty`.
 */
export function formatMoney(santim: bigint | string, language = 'am', empty = '—'): string {
    if (typeof santim === 'string' && !/^-?\d{1,30}$/.test(santim)) return empty;
    const amount = typeof santim === 'bigint' ? santim : BigInt(santim);
    const negative = amount < 0n;
    const abs = negative ? -amount : amount;
    const value = `${negative ? '-' : ''}${group((abs / 100n).toString())}.${(abs % 100n).toString().padStart(2, '0')}`;
    return language === 'am' || language === 'ti' ? `${value} ብር` : `Birr ${value}`;
}

export type CalendarChoice = 'ethiopian' | 'gregorian';

/** A Gregorian date that exists ("2026-13-45" does not). */
export function isRealDate({ year, month, day }: { year: number; month: number; day: number }): boolean {
    const d = new Date(Date.UTC(2000, month - 1, day));
    d.setUTCFullYear(year);
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const GREGORIAN_LOCALE: Record<string, string> = {
    am: 'am-ET',
    en: 'en-GB',
    'wal-Latn': 'en-GB',
    om: 'om-ET',
    ti: 'ti-ET'
};

/**
 * A date (stored Gregorian: "2026-10-22", or an instant) as the person reads it: Ethiopian by default ("ጥቅምት 12 ቀን
 * 2019 ዓ.ም"), Gregorian when they chose it. An instant is the date of Addis Ababa.
 */
export function formatDay(
    value: string | Date | null | undefined,
    { language = 'am', calendar = 'ethiopian' }: { language?: string; calendar?: CalendarChoice } = {},
    empty = '—'
): string {
    if (value === null || value === undefined || value === '') return empty;
    const day = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    const gregorian = day
        ? { year: Number(day[1]), month: Number(day[2]), day: Number(day[3]) }
        : (() => {
              const d = value instanceof Date ? value : new Date(value);
              return Number.isNaN(d.getTime()) ? null : addisDate(d);
          })();
    if (!gregorian || !isRealDate(gregorian)) return empty;
    if (calendar === 'gregorian')
        return new Date(Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day)).toLocaleDateString(
            GREGORIAN_LOCALE[language] ?? 'en-GB',
            { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
        );
    const lang = (CALENDAR_LANGUAGES as readonly string[]).includes(language) ? (language as CalendarLanguage) : 'am';
    return formatEthiopianLong(toEthiopian(gregorian), { language: lang });
}
