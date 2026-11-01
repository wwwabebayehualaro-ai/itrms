'use client';

/**
 * The fee preview (task 0.22a, ADR-0041): what the server works out for a service from its fee rule over the answers typed
 * so far (`v1/fees/preview`, POST). The Fee field only shows it and never holds an answer; the screen that files the request
 * sends the figure it showed (`useLatestFee`), and the server refuses with 409 when the rule or the figure changed since.
 *
 * The engine cannot import the platform packages, so the wire types are mirrored here from the API.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { useFormsClient } from './FormsHost';

const PREVIEW_URL = 'v1/fees/preview';

export interface FeePreviewLine {
    key: string;
    label: Record<string, string>;
    quantity: number | null;
    /** santim, as text (a bigint is never a JSON number) */
    amountSantim: string;
}

export interface FeePreview {
    /** none: the service has no fee · incomplete: an input has no answer yet · unavailable: the rule could not be worked out */
    status: 'none' | 'complete' | 'incomplete' | 'unavailable';
    serviceVersionId: string;
    feeRuleVersionId: string | null;
    asOf: string;
    /** the amounts come from sample rates (a demo installation), not an approved tariff */
    demo: boolean;
    /** the keys of the answers the rule reads: only these are sent on the next preview */
    inputKeys: string[];
    lines: FeePreviewLine[];
    totalSantim: string | null;
    /** the inputs still without an answer */
    missing: string[];
    problem: string | null;
}

/** Where the service the fee belongs to comes from: a request not filed yet (its service code); a case may follow. */
export type FeeSource = { kind: 'request'; serviceCode: string };

/** The figure last shown for a complete preview: what filing sends back so the server can tell it changed. */
export interface LatestFee {
    ruleVersionId: string;
    totalSantim: string;
}

interface FeeContextValue {
    source: FeeSource | null;
    latest: LatestFee | null;
    setLatest: (next: LatestFee | null) => void;
}

const FeeContext = createContext<FeeContextValue>({ source: null, latest: null, setLatest: () => undefined });

/** The screen that shows the form says which service it is for; a form outside one (the builder) has no source. */
export function FeeSourceProvider({ source, children }: { source: FeeSource | null; children: ReactNode }) {
    const [latest, setLatestState] = useState<LatestFee | null>(null);
    const setLatest = useCallback(
        (next: LatestFee | null) =>
            setLatestState((prev) =>
                prev?.ruleVersionId === next?.ruleVersionId && prev?.totalSantim === next?.totalSantim ? prev : next
            ),
        []
    );
    const value = useMemo<FeeContextValue>(() => ({ source, latest, setLatest }), [source, latest, setLatest]);
    return <FeeContext.Provider value={value}>{children}</FeeContext.Provider>;
}

export const useFeeSource = (): FeeSource | null => useContext(FeeContext).source;

/** The complete figure the form shows now, or null (no figure, or not complete). */
export const useLatestFee = (): LatestFee | null => useContext(FeeContext).latest;

export const FEE_DEBOUNCE_MS = 400;

const sourceId = (source: FeeSource) => source.serviceCode;
const sourceBody = (source: FeeSource) => ({ serviceCode: source.serviceCode });

export const feeKeys = {
    preview: (source: string, answers: string) => ['fees', 'preview', source, answers] as const
};

/**
 * The answers of these keys, as text that is the same for the same answers. None while the keys are not known: the first
 * ask sends no answer (it learns the keys), so an answer the fee does not read (a Sensitive one) never leaves the form.
 */
function relevantText(answers: Record<string, unknown>, keys: readonly string[] | null): string {
    const wanted = keys === null ? [] : keys.filter((k) => k in answers);
    return JSON.stringify(Object.fromEntries(wanted.sort().map((k) => [k, answers[k]])));
}

const answersOf = (text: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(text);
    return z.record(z.string(), z.unknown()).parse(parsed);
};

/**
 * The preview of the fee for the answers so far. It asks after the answers settle, and only about the answers the last
 * preview named in `inputKeys`, so typing in another field asks nothing. The last figure stays while the next is worked out.
 */
export function useFeePreview(answers: Record<string, unknown>) {
    const client = useFormsClient();
    const queryClient = useQueryClient();
    const { source, setLatest } = useContext(FeeContext);

    const [named, setNamed] = useState<readonly string[] | null>(null);
    const text = relevantText(answers, named);
    const [settled, setSettled] = useState(text);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(text), FEE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [text]);

    const id = source ? sourceId(source) : '';
    const query = useQuery({
        queryKey: feeKeys.preview(id, settled),
        queryFn: async ({ signal }) => {
            if (!source) throw new Error('no fee source');
            const sent = answersOf(settled);
            const { data } = await client.post<FeePreview>(
                PREVIEW_URL,
                { ...sourceBody(source), answers: sent },
                { signal }
            );
            // the first answer names the inputs: file it under the key of just those answers, so that narrowing the
            // key to them does not ask again
            queryClient.setQueryData(feeKeys.preview(id, relevantText(sent, data.inputKeys)), data);
            return data;
        },
        enabled: source !== null,
        placeholderData: keepPreviousData,
        staleTime: 30_000
    });

    const preview = source ? (query.data ?? null) : null;
    // the keys come from the answer, and the key of the next ask from the keys: set while rendering, not in an effect
    const inputKeys = preview?.inputKeys;
    if (inputKeys && inputKeys.join('\u0000') !== named?.join('\u0000')) setNamed(inputKeys);

    const shownComplete = !query.isError && preview?.status === 'complete' ? preview : null;
    const ruleVersionId = shownComplete?.feeRuleVersionId ?? null;
    const total = shownComplete?.totalSantim ?? null;
    useEffect(() => {
        setLatest(ruleVersionId !== null && total !== null ? { ruleVersionId, totalSantim: total } : null);
    }, [ruleVersionId, total, setLatest]);
    // a Fee field no longer on screen (its section hidden) shows no figure: none is sent with the filing
    useEffect(() => () => setLatest(null), [setLatest]);

    return { preview, isFetching: query.isFetching, isError: query.isError, refetch: query.refetch };
}
