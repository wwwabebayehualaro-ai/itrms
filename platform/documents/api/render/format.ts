/** How a value prints (task 0.23a): plain functions, used by templates and when an answer is copied into a document. */
import { formatEthiopianLong, toEthiopian } from '@itrms/ethiopian-calendar';

type Language = 'am' | 'en';

export const printLanguage = (language: string): Language => (language === 'en' ? 'en' : 'am');

/** A word in the document's language, else Amharic, else any there is. */
export function pick(value: unknown, language: string): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const text = value as Record<string, unknown>;
    const chosen = text[language] ?? text.am ?? text.en ?? Object.values(text).find((v) => typeof v === 'string');
    return typeof chosen === 'string' ? chosen : '';
}

/** A calendar day (YYYY-MM-DD) in the Ethiopian calendar: stored Gregorian, printed Ethiopian. */
export function ethiopianDay(day: unknown, language: string): string {
    if (typeof day !== 'string') return '';
    const [year, month, date] = day.split('-').map(Number);
    if (!year || !month || !date) return '';
    return formatEthiopianLong(toEthiopian({ year, month, day: date }), { language: printLanguage(language) });
}

/** Santim as Birr, by its digits and never through a number: "125050" is "1,250.50". */
export function birrText(santim: unknown): string {
    const text = typeof santim === 'bigint' ? santim.toString() : typeof santim === 'string' ? santim : '';
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, one digit run (linear time), and an amount is bounded
    if (!/^\d+$/.test(text)) return '';
    const digits = text.padStart(3, '0');
    const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${whole}.${digits.slice(-2)}`;
}
