/**
 * Display formatters of the engine. Dates are written in the Ethiopian calendar, in the person's language, unless they chose
 * the Gregorian (ADR-0015): the host says which (`setDateDisplay`, the web app's FormsHost). Never for money in santim:
 * amounts in form answers are plain numbers until forms get a money field.
 */
import { addisDayTime, ethiopianDateText } from '../core/dates';

const LOCALE = 'en-US';

/** How the engine's screens write a date: the host keeps it to the person's language and calendar. */
const display: { language: string; calendar: 'ethiopian' | 'gregorian' } = { language: 'am', calendar: 'ethiopian' };

export function setDateDisplay(next: { language: string; calendar: 'ethiopian' | 'gregorian' }): void {
    display.language = next.language;
    display.calendar = next.calendar;
}

/** An instant or a day as text the Addis Ababa clock reads (a Date or a number is an instant). */
const isoOf = (value?: string | number | Date | null): string | null => {
    if (typeof value === 'string') return value;
    const d = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

/** The day (and the time, when it has one) in the Ethiopian calendar, or '' when it is not a date. */
function ethiopian(value: string | number | Date | null | undefined, withTime: boolean): string {
    const at = addisDayTime(isoOf(value));
    const day = at ? ethiopianDateText(at.day, { language: display.language, long: true }) : '';
    return day && withTime && at?.time ? `${day} ${at.time}` : day;
}

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
    if (display.calendar === 'ethiopian') return ethiopian(value, false) || empty;
    const d = toDate(value);
    return d ? d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }) : empty;
}

export function formatDateTime(value?: string | number | Date | null, empty = 'No date') {
    if (display.calendar === 'ethiopian') return ethiopian(value, true) || empty;
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
