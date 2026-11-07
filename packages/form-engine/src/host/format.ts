/**
 * Display formatters of the engine. Dates are written in the Ethiopian calendar, in the person's language, unless they chose
 * the Gregorian (ADR-0015): a screen passes how (`useDateDisplay`, from the host). Never for money in santim: amounts in form
 * answers are plain numbers until forms get a money field.
 */
import { addisDayTime, ethiopianDateText } from '../core/dates';

const LOCALE = 'en-US';

/** How a screen writes a date: the person's language and calendar. */
export interface DateDisplay {
    language: string;
    calendar: 'ethiopian' | 'gregorian';
}

/** Without a host to say otherwise: Amharic, the Ethiopian calendar (ADR-0015). */
export const DEFAULT_DATE_DISPLAY: DateDisplay = { language: 'am', calendar: 'ethiopian' };

/** An instant or a day as text the Addis Ababa clock reads (a Date or a number is an instant). */
const isoOf = (value?: string | number | Date | null): string | null => {
    if (typeof value === 'string') return value;
    const d = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

/** The day (and the time, when it has one) in the Ethiopian calendar, or '' when it is not a date. */
function ethiopian(value: string | number | Date | null | undefined, withTime: boolean, display: DateDisplay): string {
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

export function formatDate(
    value?: string | number | Date | null,
    empty = 'No date',
    display: DateDisplay = DEFAULT_DATE_DISPLAY
) {
    if (display.calendar === 'ethiopian') return ethiopian(value, false, display) || empty;
    const d = toDate(value);
    return d ? d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }) : empty;
}

export function formatDateTime(
    value?: string | number | Date | null,
    empty = 'No date',
    display: DateDisplay = DEFAULT_DATE_DISPLAY
) {
    if (display.calendar === 'ethiopian') return ethiopian(value, true, display) || empty;
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
