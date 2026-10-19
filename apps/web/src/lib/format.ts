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
