'use client';

import { useMemo } from 'react';
import { formatCurrency, formatDate, formatDateTime } from '../host/format';
import type { EngineTranslate } from '../core/messages';
import { useFormsLanguages } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { ethiopianDateText } from '../core/dates';
import type { ViewField, ViewOption, ViewSchema } from './types';

export const EMPTY = '—';

export interface Labeler {
    field: (key: string) => ViewField | undefined;
    /** Choices of a field (the built-ins' are the offices and people in the data, from the server). */
    options: (key: string) => ViewOption[];
    /** value -> label of a field (option names, people names), for the table cell renderer. */
    lookup: (key: string) => Map<string, string>;
    /** A stored value as text: people by name, options by label, dates and money formatted. */
    text: (key: string, value: unknown) => string;
    loading: boolean;
    /** The engine's words in the screen's language. */
    t: EngineTranslate;
}

/** Turns stored values into what people read. One place, used by every view mode, filter chip and export. */
export function useLabeler(schema?: ViewSchema): Labeler {
    const { language } = useFormsLanguages();
    const { t } = useEngineText();
    return useMemo(() => {
        const fields = new Map((schema?.fields ?? []).map((f) => [f.key, f]));
        const field = (key: string) => fields.get(key);
        const options = (key: string): ViewOption[] => {
            const f = field(key);
            return f?.options ?? [];
        };
        const lookups = new Map<string, Map<string, string>>();
        const lookup = (key: string) => {
            let m = lookups.get(key);
            if (!m) {
                const f = field(key);
                m = new Map((f?.options ?? []).map((o) => [String(o.value), o.label]));
                lookups.set(key, m);
            }
            return m;
        };
        const one = (f: ViewField | undefined, v: unknown): string => {
            if (v === null || v === undefined || v === '') return EMPTY;
            if (!f) return String(v);
            switch (f.kind) {
                case 'boolean':
                    return t(v ? 'form-engine.core.print.yes' : 'form-engine.core.print.no');
                case 'date':
                    // a day picked on the Ethiopian calendar is read in it, in the screens' language
                    return f.type === 'EthDate' && typeof v === 'string'
                        ? ethiopianDateText(v, { language, long: true }) || EMPTY
                        : formatDate(v as string, EMPTY);
                case 'datetime':
                    return formatDateTime(v as string, EMPTY);
                case 'number':
                    return f.currency && Number.isFinite(Number(v))
                        ? formatCurrency(Number(v), f.currency)
                        : Number.isFinite(Number(v))
                          ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 })
                          : String(v);
                default:
                    return lookup(f.key).get(String(v)) ?? String(v);
            }
        };
        const text = (key: string, value: unknown) => {
            const f = field(key);
            if (Array.isArray(value)) return value.length ? value.map((x) => one(f, x)).join(', ') : EMPTY;
            return one(f, value);
        };
        return { field, options, lookup, text, loading: false, t };
    }, [schema, language, t]);
}
