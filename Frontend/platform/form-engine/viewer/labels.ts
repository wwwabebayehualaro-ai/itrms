'use client';

import { useMemo } from 'react';
import { useDirectory } from '@platform/lib/auth/directory';
import { formatCurrency, formatDate, formatDateTime } from '@platform/lib/format';
import type { ViewField, ViewOption, ViewSchema } from './types';

export const EMPTY = '—';

export interface Labeler {
    field: (key: string) => ViewField | undefined;
    /** Choices of a field: its own options, or the tenant's people for person fields. */
    options: (key: string) => ViewOption[];
    /** value -> label of a field (option names, people names), for the table cell renderer. */
    lookup: (key: string) => Map<string, string>;
    /** A stored value as text: people by name, options by label, dates and money formatted. */
    text: (key: string, value: unknown) => string;
    loading: boolean;
}

/** Turns stored values into what people read. One place, used by every view mode, filter chip and export. */
export function useLabeler(schema?: ViewSchema): Labeler {
    const { data: people, names, isPending } = useDirectory();
    return useMemo(() => {
        const fields = new Map((schema?.fields ?? []).map((f) => [f.key, f]));
        const field = (key: string) => fields.get(key);
        const options = (key: string): ViewOption[] => {
            const f = field(key);
            if (!f) return [];
            if (f.person) return (people ?? []).map((u) => ({ value: u.id, label: u.full_name || u.email }));
            return f.options;
        };
        const lookups = new Map<string, Map<string, string>>();
        const lookup = (key: string) => {
            let m = lookups.get(key);
            if (!m) {
                const f = field(key);
                m = f?.person ? names : new Map((f?.options ?? []).map((o) => [String(o.value), o.label]));
                lookups.set(key, m);
            }
            return m;
        };
        const one = (f: ViewField | undefined, v: unknown): string => {
            if (v === null || v === undefined || v === '') return EMPTY;
            if (!f) return String(v);
            switch (f.kind) {
                case 'boolean':
                    return v ? 'Yes' : 'No';
                case 'date':
                    return formatDate(v as string, EMPTY);
                case 'datetime':
                    return formatDateTime(v as string, EMPTY);
                case 'number':
                    return f.currency && Number.isFinite(Number(v)) ? formatCurrency(Number(v), f.currency) : Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(v);
                default:
                    return lookup(f.key).get(String(v)) ?? (f.kind === 'choice' && f.key === 'status' ? String(v).replace(/[_-]+/g, ' ') : String(v));
            }
        };
        const text = (key: string, value: unknown) => {
            const f = field(key);
            if (Array.isArray(value)) return value.length ? value.map((x) => one(f, x)).join(', ') : EMPTY;
            return one(f, value);
        };
        return { field, options, lookup, text, loading: isPending };
    }, [schema, people, names, isPending]);
}
