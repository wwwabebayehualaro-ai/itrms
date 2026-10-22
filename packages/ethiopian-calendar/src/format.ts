/**
 * Formatting an Ethiopian date with a pattern (i18n-and-languages.md: dates are entered and shown Ethiopian, stored
 * Gregorian). Tokens:
 *   yyyy year · M month · MM month, two digits · MMMM month name · d day · dd day, two digits · EEEE weekday · G era;
 *   text in single quotes is copied as it is ('' for a quote). Letters outside quotes are tokens, each a whole run of
 *   letters ("dd/MM/yyyy", not "ddMMyyyy"); anything else is refused rather than misread.
 * Numbers may be written in Ethiopic numerals.
 */
import { ethiopianToJdn, weekday, type EthiopianDate } from './convert';
import { ERA, MONTH_NAMES, WEEKDAY_NAMES, type CalendarLanguage } from './names';
import { toEthiopicNumeral } from './numerals';

export interface FormatOptions {
    language?: CalendarLanguage;
    /** Ethiopic numerals for the numbers (the year, the day, a numeric month) */
    numerals?: 'latin' | 'ethiopic';
}

/** The usual long form per language: "ጥቅምት 12 ቀን 2019 ዓ.ም", "12 Tikimt 2019 E.C.". */
export const LONG_PATTERN: Readonly<Record<CalendarLanguage, string>> = {
    am: "MMMM d 'ቀን' yyyy G",
    ti: "MMMM d 'ዕለት' yyyy G",
    en: 'd MMMM yyyy G',
    'wal-Latn': 'd MMMM yyyy G',
    om: 'MMMM d, yyyy G'
};

/** The short numeric form, the same everywhere: day/month/year. */
export const SHORT_PATTERN = 'dd/MM/yyyy';

// a quoted text, a lone quote (unterminated: refused), or a whole run of Latin letters (one token; unknown ones refused)
const TOKEN = /'(?:[^']|'')*'|'|[A-Za-z]+/g;

export function formatEthiopian(date: EthiopianDate, pattern: string, options: FormatOptions = {}): string {
    const language = options.language ?? 'am';
    // ethiopianToJdn also checks the date is valid
    const day = weekday(ethiopianToJdn(date));
    const number = (n: number, width = 1) =>
        options.numerals === 'ethiopic' ? toEthiopicNumeral(n) : String(n).padStart(width, '0');
    return pattern.replace(TOKEN, (token) => {
        switch (token) {
            case 'yyyy':
                return number(date.year);
            case 'MMMM':
                return MONTH_NAMES[language][date.month - 1] ?? '';
            case 'MM':
                return number(date.month, 2);
            case 'M':
                return number(date.month);
            case 'dd':
                return number(date.day, 2);
            case 'd':
                return number(date.day);
            case 'EEEE':
                return WEEKDAY_NAMES[language][day] ?? '';
            case 'G':
                return ERA[language];
            default:
                if (token.length > 1 && token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
                throw new RangeError(`Not a date pattern token: "${token}" in "${pattern}"`);
        }
    });
}

/** "ጥቅምት 12 ቀን 2019 ዓ.ም" in the language's long form. */
export const formatEthiopianLong = (date: EthiopianDate, options: FormatOptions = {}): string =>
    formatEthiopian(date, LONG_PATTERN[options.language ?? 'am'], options);
