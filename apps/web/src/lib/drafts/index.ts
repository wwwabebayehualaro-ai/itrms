'use client';

/**
 * Drafts of a request (task 0.20c): the person's drafts on the server (`/v1/form-drafts`) and the session a form fill
 * keeps while they type. Every change is kept in this browser within seconds (sealed, without the Sensitive answers:
 * store.ts) and on the server a few seconds later when there is a connection; a dropped link only delays the server's
 * copy, which follows when it is back. Filing the request removes the draft (the server in the filing's transaction).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Draft } from '@itrms/forms/contracts';

import client from '../api/client';
import { isApiError } from '../api/http';
import { createKeys } from '../query/keys';
import { listLocal, loadLocal, markSynced, removeLocal, renameLocal, saveLocal, type LocalDraftMeta } from './store';

export type { Draft, LocalDraftMeta };
export { forget as forgetLocalDrafts, unsyncedCount } from './store';

export const draftKeys = createKeys('form-drafts');

const ifMatch = (version: number) => ({ headers: { 'if-match': `"${version}"` } });

/** How long after a change it is kept here, and sent to the server (ms). */
const LOCAL_AFTER = 1_500;
const SERVER_AFTER = 6_000;

/** The person's drafts on the server, and those kept only in this browser (never saved there), the latest first. */
export function useMyDrafts(userId: string | undefined) {
    const server = useQuery({
        queryKey: draftKeys.list(),
        queryFn: async ({ signal }) => (await client.get<{ items: Draft[] }>('v1/form-drafts', { signal })).data.items
    });
    const local = useQuery({
        queryKey: [...draftKeys.all, 'local', userId ?? ''] as const,
        enabled: !!userId,
        queryFn: () => listLocal(userId ?? '')
    });
    return { server, local };
}

export type DraftStatus = 'idle' | 'local' | 'saving' | 'saved' | 'offline' | 'error';

export interface DraftStart {
    /** the server's draft being resumed */
    draft?: Draft;
    /** this browser's copy of it, or a draft kept only here */
    local?: LocalDraftMeta;
}

/**
 * The answers a resumed draft starts from: the server's, with this browser's newer change over them (the browser keeps
 * no Sensitive answer, so the server's stay); a draft kept only here starts from its own answers.
 */
export async function resumeValues(userId: string, start: DraftStart): Promise<Record<string, unknown>> {
    const here = start.local ? await loadLocal(userId, start.local.localId) : null;
    const server = start.draft?.answers ?? {};
    if (!here) return server;
    const newer = !start.draft || here.updatedAt > Date.parse(start.draft.updatedAt);
    return newer ? { ...server, ...here.answers } : server;
}

/**
 * A form fill's draft: `change` with every new set of answers; the draft is kept here and on the server as described
 * above. `local` is what this browser may keep of a set of answers (the form screen's `withoutSensitive`: lib knows no
 * form). `draftId` goes with the filing; `filed` ends it.
 */
export function useDraftSession(input: {
    userId: string;
    formId: string;
    /** the version the form is shown on (a resumed draft goes on with it) */
    versionId: string;
    /** the answers without the Sensitive ones (SEC-WB-3) */
    local: (values: Record<string, unknown>) => Record<string, unknown>;
    start?: DraftStart;
}) {
    const queries = useQueryClient();
    const [status, setStatus] = useState<DraftStatus>('idle');
    const state = useRef({
        localId: input.start?.draft?.id ?? input.start?.local?.localId ?? `local-${crypto.randomUUID()}`,
        draftId: input.start?.draft?.id ?? input.start?.local?.draftId ?? null,
        serverVersion: input.start?.draft?.version ?? null,
        values: null as Record<string, unknown> | null,
        updatedAt: 0,
        unsent: false,
        localTimer: undefined as ReturnType<typeof setTimeout> | undefined,
        serverTimer: undefined as ReturnType<typeof setTimeout> | undefined,
        sending: Promise.resolve()
    });
    const meta = useRef(input);
    useEffect(() => {
        meta.current = input;
    });

    const keepLocal = useCallback(async () => {
        const s = state.current;
        const { userId, formId, versionId, local } = meta.current;
        if (!s.values) return;
        await saveLocal(
            {
                localId: s.localId,
                userId,
                formId,
                draftId: s.draftId,
                formVersionId: versionId,
                updatedAt: s.updatedAt,
                synced: false
            },
            local(s.values)
        );
        setStatus((cur) => (cur === 'saving' ? cur : 'local'));
    }, []);

    const send = useCallback(async () => {
        const s = state.current;
        const { formId, versionId } = meta.current;
        if (!s.values || !s.unsent) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setStatus('offline');
            return;
        }
        const answers = s.values;
        const at = s.updatedAt;
        setStatus('saving');
        try {
            if (s.draftId && s.serverVersion !== null) {
                const saved = (
                    await client.patch<Draft>(
                        `v1/form-drafts/${s.draftId}`,
                        { formVersionId: versionId, answers },
                        ifMatch(s.serverVersion)
                    )
                ).data;
                s.serverVersion = saved.version;
            } else {
                const saved = (
                    await client.post<Draft>('v1/form-drafts', { formId, formVersionId: versionId, answers })
                ).data;
                await renameLocal(s.localId, saved.id, saved.id);
                s.localId = saved.id;
                s.draftId = saved.id;
                s.serverVersion = saved.version;
            }
            if (s.updatedAt === at) s.unsent = false;
            await markSynced(s.localId, at);
            setStatus(s.unsent ? 'local' : 'saved');
            void queries.invalidateQueries({ queryKey: draftKeys.all });
        } catch (error) {
            // no answer (a dropped link): kept here, sent again when the link is back; anything else is shown
            setStatus(isNetworkError(error) ? 'offline' : 'error');
        }
    }, [queries]);

    /** Sends what is pending, after any send already on its way. */
    const flush = useCallback(() => {
        const s = state.current;
        s.sending = s.sending.then(send);
        return s.sending;
    }, [send]);

    const change = useCallback(
        (values: Record<string, unknown>) => {
            const s = state.current;
            s.values = values;
            s.updatedAt = Date.now();
            s.unsent = true;
            clearTimeout(s.localTimer);
            clearTimeout(s.serverTimer);
            s.localTimer = setTimeout(() => void keepLocal(), LOCAL_AFTER);
            s.serverTimer = setTimeout(() => void flush(), SERVER_AFTER);
        },
        [keepLocal, flush]
    );

    // the link is back: what waited goes to the server
    useEffect(() => {
        // one object for the session's life: its fields change, the object does not
        const s = state.current;
        const online = () => void flush();
        window.addEventListener('online', online);
        return () => {
            window.removeEventListener('online', online);
            clearTimeout(s.localTimer);
            clearTimeout(s.serverTimer);
            // leaving the form: keep the last change here at once (the server's copy follows next time)
            if (s.unsent) void keepLocal();
        };
    }, [flush, keepLocal]);

    /** Before filing: no save is started any more, and the one on its way (if any) is waited for. */
    const settle = useCallback(async () => {
        const s = state.current;
        clearTimeout(s.localTimer);
        clearTimeout(s.serverTimer);
        await s.sending;
    }, []);

    /** The request was filed: the server removed its draft; this browser's copy goes too. */
    const filed = useCallback(async () => {
        const s = state.current;
        clearTimeout(s.localTimer);
        clearTimeout(s.serverTimer);
        s.unsent = false;
        await removeLocal(s.localId);
        void queries.invalidateQueries({ queryKey: draftKeys.all });
    }, [queries]);

    return {
        status,
        change,
        flush,
        settle,
        filed,
        /** the server's draft, for the filing */
        draftId: () => state.current.draftId
    };
}

/** Throws a person's draft away, here and on the server. */
export async function discardDraft(local: { localId: string } | null, server: Draft | null): Promise<void> {
    if (server) await client.delete(`v1/form-drafts/${server.id}`, ifMatch(server.version));
    if (local) await removeLocal(local.localId);
}

/** A call that got no answer at all (a dropped link), as against one the server refused. */
const isNetworkError = (error: unknown): boolean => isApiError(error) && !error.response;
