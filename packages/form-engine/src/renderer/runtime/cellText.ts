/** Plain-text formatting of table cells (no UI): shared by every table renderer. */
import { formatCurrency, formatDate, formatDateTime } from '../../host/format';
import { getByPath } from '../../core/runtime/expression';
import { ethiopianDateText } from '../../core/dates';
import type { EngineTranslate } from '../../core/messages';
import type { TableColumn } from '@itrms/schemas';

export const EMPTY = '—';

/** value -> label maps, keyed by the column's value path (built from the column's lookup source). */
export type LookupMaps = Record<string, Map<string, string>>;

export const isBlank = (v: unknown) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
export const label = (col: TableColumn, v: unknown, lookups: LookupMaps) =>
    lookups[col.field]?.get(String(v)) ?? String(v);
export const fileName = (f: any) => (typeof f === 'string' ? f : (f?.name ?? f?.filename ?? ''));
export const humanize = (s: string) => s.replace(/[_-]+/g, ' ');

/** Plain text of a cell (tooltips, sorting). */
export function cellText(col: TableColumn, row: unknown, lookups: LookupMaps, t: EngineTranslate): string {
    const v = getByPath(row, col.field);
    if (isBlank(v) && col.type !== 'boolean' && col.type !== 'count') return EMPTY;
    switch (col.type) {
        case 'date':
            return formatDate(v as string, EMPTY);
        // a day picked on the Ethiopian calendar is read in it (stored as the Gregorian day)
        case 'ethdate':
            return (typeof v === 'string' && ethiopianDateText(v)) || EMPTY;
        case 'datetime':
            return formatDateTime(v as string, EMPTY);
        case 'currency':
            return Number.isFinite(Number(v)) ? formatCurrency(Number(v), col.currency || 'USD') : String(v);
        case 'number':
            return Number.isFinite(Number(v))
                ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 })
                : String(v);
        case 'boolean':
            return t(v ? 'form-engine.core.print.yes' : 'form-engine.core.print.no');
        case 'count':
            return String(Array.isArray(v) ? v.length : 0);
        case 'files':
            return (Array.isArray(v) ? v : [v]).map(fileName).filter(Boolean).join(', ') || EMPTY;
        case 'tags':
        case 'lookup':
        case 'tag':
            return (Array.isArray(v) ? v : [v]).map((x) => label(col, x, lookups)).join(', ');
        default:
            return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
}
