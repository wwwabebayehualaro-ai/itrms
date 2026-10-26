'use client';

/**
 * Registry lookups (task 0.18): the records a form field can point to (a person, an organisation), found by typing and
 * shown by id. The API serves them (`v1/registry-lookups`, GET only); a saved answer is the record's id, and the label and
 * facts are read again from the registry, so a merged or renamed record never leaves a stale copy in the form.
 */
import { useEffect, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { FormsClient } from './client';
import { useFormsClient } from './FormsHost';

const BASE = 'v1/registry-lookups';

/** A fact shown under a chosen record (never a sensitive value: the registry decides what it offers). */
export interface LookupFact {
    key: string;
    label: string;
    value: string | null;
}

export interface LookupItem {
    id: string;
    label: string;
    /** false: merged or closed; shown for a saved answer, never offered for a new one */
    active: boolean;
    facts: LookupFact[];
}

/** A registry the person may look up in, with the names of the facts it shows. */
export interface LookupProvider {
    key: string;
    title: string;
    facts: { key: string; label: string }[];
}

/** Letters to type before the registry is asked, and the wait after the last key. */
export const MIN_SEARCH_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 250;
const MAX_IDS = 50;

export const lookupKeys = {
    all: ['registry-lookups'] as const,
    providers: () => ['registry-lookups', 'providers'] as const,
    search: (provider: string, q: string) => ['registry-lookups', provider, 'search', q] as const,
    items: (provider: string, ids: readonly string[]) => ['registry-lookups', provider, 'items', ids.join(',')] as const
};

const providersOf = async (client: FormsClient, signal?: AbortSignal): Promise<LookupProvider[]> =>
    (await client.get<{ items: LookupProvider[] }>(BASE, { signal })).data.items;

const searchOf = async (client: FormsClient, provider: string, q: string, signal?: AbortSignal) =>
    (
        await client.get<{ items: LookupItem[] }>(`${BASE}/${encodeURIComponent(provider)}`, {
            params: { q },
            signal
        })
    ).data.items;

const itemsOf = async (client: FormsClient, provider: string, ids: readonly string[], signal?: AbortSignal) =>
    (
        await client.get<{ items: LookupItem[] }>(`${BASE}/${encodeURIComponent(provider)}/items`, {
            params: { ids: ids.join(',') },
            signal
        })
    ).data.items;

/** The registries the person may use (the builder offers them; they hardly ever change). */
export function useRegistryLookupProviders() {
    const client = useFormsClient();
    return useQuery({
        queryKey: lookupKeys.providers(),
        queryFn: ({ signal }) => providersOf(client, signal),
        staleTime: Infinity
    });
}

/** Records matching what is typed: nothing is asked under two letters, and not before the typing pauses. */
export function useLookupSearch(provider: string, q: string) {
    const client = useFormsClient();
    const [settled, setSettled] = useState('');
    const text = q.trim();
    useEffect(() => {
        const timer = setTimeout(() => setSettled(text), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [text]);
    const enabled = !!provider && settled.length >= MIN_SEARCH_CHARS;
    const query = useQuery({
        queryKey: lookupKeys.search(provider, settled),
        queryFn: ({ signal }) => searchOf(client, provider, settled, signal),
        enabled,
        staleTime: 30_000
    });
    const waiting = text.length >= MIN_SEARCH_CHARS && (settled !== text || query.isFetching);
    return {
        // the last answer stays while the next is typed
        items: query.data ?? [],
        /** typing, or the registry is answering */
        searching: waiting,
        tooShort: text.length < MIN_SEARCH_CHARS,
        failed: query.isError
    };
}

/** The records with these ids, whatever their status (what RLS lets the person see; the others are not in the answer). */
export function useLookupItems(provider: string, ids: readonly string[]) {
    const client = useFormsClient();
    const wanted = [...new Set(ids)].slice(0, MAX_IDS).sort();
    return useQuery({
        queryKey: lookupKeys.items(provider, wanted),
        queryFn: ({ signal }) => itemsOf(client, provider, wanted, signal),
        enabled: !!provider && wanted.length > 0,
        staleTime: 60_000
    });
}

/** Keeps a picked record, so the field shows it without asking again. */
export function rememberLookupItem(queryClient: QueryClient, provider: string, item: LookupItem) {
    queryClient.setQueryData(lookupKeys.items(provider, [item.id]), [item]);
}

export function useRememberLookupItem() {
    const queryClient = useQueryClient();
    return (provider: string, item: LookupItem) => rememberLookupItem(queryClient, provider, item);
}

/** id -> label of many records at once, per registry (one request per 50 ids, none left out): a page of the data viewer. */
export function useLookupLabels(wanted: ReadonlyMap<string, readonly string[]>): Map<string, Map<string, string>> {
    const client = useFormsClient();
    const requests = [...wanted.entries()].flatMap(([provider, ids]) => {
        const unique = [...new Set(ids)].sort();
        const chunks: { provider: string; ids: string[] }[] = [];
        for (let at = 0; at < unique.length; at += MAX_IDS)
            chunks.push({ provider, ids: unique.slice(at, at + MAX_IDS) });
        return chunks.length > 0 ? chunks : [{ provider, ids: [] }];
    });
    const results = useQueries({
        queries: requests.map(({ provider, ids }) => ({
            queryKey: lookupKeys.items(provider, ids),
            queryFn: ({ signal }: { signal: AbortSignal }) => itemsOf(client, provider, ids, signal),
            enabled: ids.length > 0,
            staleTime: 60_000
        }))
    });
    const out = new Map<string, Map<string, string>>();
    requests.forEach(({ provider }, i) => {
        const labels = out.get(provider) ?? new Map<string, string>();
        for (const item of results[i]?.data ?? []) labels.set(item.id, item.label);
        out.set(provider, labels);
    });
    return out;
}
