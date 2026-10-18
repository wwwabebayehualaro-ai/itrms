'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EMPTY_FILTER, FilterGroup, SortKey, ViewState } from './types';

export const DEFAULT_PAGE_SIZE = 20;
const PARAMS = ['view', 'q', 'sort', 'page', 'ps', 'f', 'cols', 'o', 'v'] as const;

const b64 = {
    encode: (v: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(v)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    decode: <T,>(s: string | null, fallback: T): T => {
        if (!s) return fallback;
        try {
            return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
        } catch {
            return fallback; // a hand-edited / truncated link never breaks the page
        }
    }
};

const parseSort = (s: string | null): SortKey[] =>
    (s ?? '')
        .split(',')
        .filter(Boolean)
        .slice(0, 3)
        .map((p) => (p.startsWith('-') ? { field: p.slice(1), desc: true } : { field: p }));
const formatSort = (sort: SortKey[]) => sort.map((s) => (s.desc ? '-' : '') + s.field).join(',');

const int = (s: string | null, fallback: number, min: number, max: number) => {
    const n = Number(s);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function parseViewState(params: URLSearchParams, defaultMode: string): ViewState {
    const filter = b64.decode<FilterGroup>(params.get('f'), EMPTY_FILTER);
    return {
        mode: params.get('view') || defaultMode,
        search: params.get('q') ?? '',
        filter: filter && Array.isArray(filter.items) ? filter : EMPTY_FILTER,
        sort: parseSort(params.get('sort')),
        page: int(params.get('page'), 1, 1, 1_000_000),
        pageSize: int(params.get('ps'), DEFAULT_PAGE_SIZE, 1, 100),
        columns: (params.get('cols') ?? '').split(',').filter(Boolean),
        options: b64.decode<Record<string, unknown>>(params.get('o'), {}),
        viewId: params.get('v') || undefined
    };
}

export function serializeViewState(state: ViewState, defaultMode: string): URLSearchParams {
    const p = new URLSearchParams();
    if (state.viewId) p.set('v', state.viewId);
    if (state.mode !== defaultMode) p.set('view', state.mode);
    if (state.search) p.set('q', state.search);
    if (state.sort.length) p.set('sort', formatSort(state.sort));
    if (state.page > 1) p.set('page', String(state.page));
    if (state.pageSize !== DEFAULT_PAGE_SIZE) p.set('ps', String(state.pageSize));
    if (state.filter.items.length) p.set('f', b64.encode(state.filter));
    if (state.columns.length) p.set('cols', state.columns.join(','));
    if (Object.keys(state.options).length) p.set('o', b64.encode(state.options));
    return p;
}

/**
 * The view state of the current page, kept in the URL (`?view=board&q=berlin&f=...`): back/forward work, a refresh keeps the
 * view, and the link IS the shareable saved view. Changing anything but the page resets to page 1.
 */
export function useViewState(defaultMode = 'table') {
    const router = useRouter();
    const pathname = usePathname();
    const search = useSearchParams();
    const key = search.toString();
    const state = useMemo(() => parseViewState(new URLSearchParams(key), defaultMode), [key, defaultMode]);

    const patch = useCallback(
        (change: Partial<ViewState>) => {
            const next = { ...state, ...change };
            if (!('page' in change)) next.page = 1;
            const params = serializeViewState(next, defaultMode);
            // keep unrelated params (e.g. the record being opened)
            new URLSearchParams(key).forEach((v, k) => {
                if (!(PARAMS as readonly string[]).includes(k)) params.set(k, v);
            });
            const qs = params.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [state, key, defaultMode, pathname, router]
    );
    // a link that names a saved view and nothing else: the view's own settings apply
    const pristine = useMemo(() => PARAMS.every((k) => k === 'v' || !new URLSearchParams(key).has(k)), [key]);
    return [state, patch, pristine] as const;
}
