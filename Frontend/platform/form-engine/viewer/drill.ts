import type { Bucket, Condition, FilterGroup, ViewField } from './types';

/** "2026-09" (month bucket) -> first and last day. */
export function bucketRange(key: string, bucket: Bucket): [string, string] {
    if (bucket === 'year') return [`${key}-01-01`, `${key}-12-31`];
    if (bucket === 'day') return [key, key];
    const [y, m] = key.split('-').map(Number);
    return [`${key}-01`, `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`];
}

/** The filter condition that selects the requests of one group (a pivot cell, a chart bar). */
export function groupCondition(field: ViewField, key: string | null, bucket?: Bucket): Condition {
    if (key === null) return { field: field.key, op: 'empty' };
    if (field.kind === 'date' || field.kind === 'datetime') return { field: field.key, op: 'between', value: bucketRange(key, bucket ?? 'month') };
    if (field.kind === 'boolean') return { field: field.key, op: 'eq', value: key === 'true' };
    return { field: field.key, op: 'eq', value: key };
}

/** The current filter plus more conditions, all required. */
export function andFilter(current: FilterGroup, ...extra: Condition[]): FilterGroup {
    return { op: 'and', items: [...(current.items.length ? [current] : []), ...extra] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A group key as people read it. */
export function groupLabel(field: ViewField, key: string | null, bucket: Bucket | undefined, text: (key: string, value: unknown) => string): string {
    if (key === null) return '(none)';
    if (field.kind === 'date' || field.kind === 'datetime') {
        const b = bucket ?? 'month';
        return b === 'month' ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : key;
    }
    if (field.kind === 'boolean') return key === 'true' ? 'Yes' : 'No';
    return text(field.key, key);
}
