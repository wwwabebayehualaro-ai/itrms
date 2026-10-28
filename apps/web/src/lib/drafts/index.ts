'use client';

/**
 * Drafts of a request (task 0.20c): the person's drafts on the server (`/v1/form-drafts`) and the session a form fill
 * keeps while they type. Every change is kept in this browser within seconds (sealed, without the answers kept on the
 * server only: store.ts) and on the server a few seconds later when there is a connection; a dropped link only delays
 * the server's copy, which follows when it is back. Filing the request removes the draft (the server in the filing's
 * transaction).
 *
 * Which copy a resumed draft starts from never compares clocks: this browser's copy goes on when it holds a change the
 * server does not have and was made on the server version it has now; a copy made on an older one (the draft changed on
 * another PC meanwhile) gives way to the server's, and the form says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Draft, DraftSummary } from '@itrms/forms/contracts';

import client from '../api/client';
import { defaultKey, isApiError } from '../api/http';
import { createKeys } from '../query/keys';
import { mergeAnswers } from './merge';
import {
    canSeal,
    listLocal,
    loadLocal,
    markSynced,
    removeLocal,
    renameLocal,
    saveLocal,
    type LocalDraftMeta
} from './store';

export type { Draft, DraftSummary, LocalDraftMeta };
export { forget as forgetLocalDrafts, unsyncedCount } from './store';

export const draftKeys = createKeys('form-drafts');

const ifMatch = (version: number) => ({ headers: { 'if-match': `"${version}"` } });

/** How long after a change it is kept here, and sent to the server (ms). */
const LOCAL_AFTER = 1_500;
const SERVER_AFTER = 6_000;

/** A local id: a random UUID, over plain HTTP too (the HTTP client's: never Math.random, SEC-CR-5). */
const newLocalId = () => `local-${defaultKey()}`;

/** The person's drafts on the server (without their answers), and those kept in this browser, the latest first. */
export function useMyDrafts(userId: string | undefined) {
    const server = useQuery({
        queryKey: draftKeys.list(),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: DraftSummary[] }>('v1/form-drafts', { params: { limit: 100 }, signal })).data
                .items
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
    draft?: DraftSummary;
    /** this browser's copy of it, or a draft kept only here */
    local?: LocalDraftMeta;
}

export interface Resumed {
    values: Record<string, unknown>;
    /** this browser's unsaved change was made on an older server version: the server's is shown instead */
    conflict: boolean;
    /** the start as it is now (the server's current version; no server draft when it is gone) */
    start: DraftStart;
}

/**
 * The answers a resumed draft starts from (see the header): the server's, with this browser's change over them when it
 * goes on (rows of a repeating section merged row by row, so the server's answers kept on the server only stay); a
 * draft kept only here, or whose server draft is gone, starts from this browser's copy.
 */
export async function resumeValues(userId: string, start: DraftStart): Promise<Resumed> {
    const server = start.draft ? await currentDraft(start.draft.id) : null;
    const here = start.local ? await loadLocal(userId, start.local.localId) : null;
    const local = start.local ? { ...start.local, draftId: server ? start.local.draftId : null } : undefined;
    const now: DraftStart = { ...(server ? { draft: server } : {}), ...(local ? { local } : {}) };
    if (!here) return { values: server?.answers ?? {}, conflict: false, start: now };
    if (!server) return { values: here.answers, conflict: false, start: now };
    if (here.synced) return { values: server.answers, conflict: false, start: now };
    if (here.baseVersion === server.version)
        return { values: mergeAnswers(server.answers, here.answers), conflict: false, start: now };
    return { values: server.answers, conflict: true, start: now };
}

/** A server draft with its answers; null when it is gone (filed or thrown away elsewhere). */
async function currentDraft(id: string): Promise<Draft | null> {
    try {
        return (await client.get<Draft>(`v1/form-drafts/${id}`)).data;
    } catch (error) {
        if (isApiError(error) && error.response?.status === 404) return null;
        throw error;
    }
}

/** A session's state: one object for its life (a ref): its fields change, the object does not. */
function initial(start: DraftStart | undefined) {
    const localId = start?.draft?.id ?? start?.local?.localId ?? newLocalId();
    return {
        localId,
        draftId: start?.draft?.id ?? start?.local?.draftId ?? null,
        serverVersion: start?.draft?.version ?? null,
        // one create per session, whatever happens to its answer (a lost reply never makes a second draft)
        createKey: `draft-create:${localId}`,
        values: null as Record<string, unknown> | null,
        updatedAt: 0,
        unsent: false,
        localTimer: undefined as ReturnType<typeof setTimeout> | undefined,
        serverTimer: undefined as ReturnType<typeof setTimeout> | undefined,
        sending: Promise.resolve()
    };
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
    /** the answers this browser may keep (SEC-WB-3) */
    local: (values: Record<string, unknown>) => Record<string, unknown>;
    start?: DraftStart;
}) {
    const queries = useQueryClient();
    const [status, setStatus] = useState<DraftStatus>('idle');
    const ref = useRef(initial(input.start));
    const meta = useRef(input);
    useEffect(() => {
        meta.current = input;
    });

    const keepLocal = useCallback(async () => {
        const state = ref.current;
        const { userId, formId, versionId, local } = meta.current;
        // no WebCrypto (an insecure context): nothing is kept here, the server's copy is the draft
        if (!state.values || !canSeal()) return;
        await saveLocal(
            {
                localId: state.localId,
                userId,
                formId,
                draftId: state.draftId,
                formVersionId: versionId,
                baseVersion: state.serverVersion,
                updatedAt: state.updatedAt,
                synced: false
            },
            local(state.values)
        );
        setStatus((cur) => (cur === 'saving' ? cur : 'local'));
    }, []);

    const keepLocalShown = useCallback(() => {
        keepLocal().catch(() => setStatus('error'));
    }, [keepLocal]);

    const send = useCallback(async () => {
        const state = ref.current;
        const { formId, versionId } = meta.current;
        if (!state.values || !state.unsent) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setStatus('offline');
            return;
        }
        const answers = state.values;
        const at = state.updatedAt;
        const patch = async (id: string, version: number) =>
            (
                await client.patch<DraftSummary>(
                    `v1/form-drafts/${id}`,
                    { formVersionId: versionId, answers },
                    ifMatch(version)
                )
            ).data;
        setStatus('saving');
        try {
            let saved: DraftSummary | null = null;
            if (state.draftId && state.serverVersion !== null) {
                const id = state.draftId;
                try {
                    saved = await patch(id, state.serverVersion);
                } catch (error) {
                    const code = isApiError(error) ? error.response?.status : undefined;
                    if (code === 409) {
                        // saved meanwhile from another tab of the same person: on top of that save
                        const current = await currentDraft(id);
                        if (current) saved = await patch(id, current.version);
                    } else if (code !== 404) throw error;
                    // gone (filed or thrown away elsewhere): saved anew below
                    if (!saved) state.draftId = null;
                }
            }
            if (!saved) {
                saved = (
                    await client.post<DraftSummary>(
                        'v1/form-drafts',
                        { formId, formVersionId: versionId, answers },
                        { headers: { 'idempotency-key': state.createKey } }
                    )
                ).data;
                if (canSeal()) await renameLocal(state.localId, saved.id, saved.id);
                state.localId = saved.id;
                state.draftId = saved.id;
            }
            state.serverVersion = saved.version;
            if (state.updatedAt === at) state.unsent = false;
            if (canSeal()) await markSynced(state.localId, at, saved.version);
            setStatus(state.unsent ? 'local' : 'saved');
            void queries.invalidateQueries({ queryKey: draftKeys.all });
        } catch (error) {
            // no answer (a dropped link): kept here, sent again when the link is back; anything else is shown
            setStatus(isNetworkError(error) ? 'offline' : 'error');
        }
    }, [queries]);

    /** Sends what is pending, after any send already on its way. */
    const flush = useCallback(() => {
        const state = ref.current;
        state.sending = state.sending.then(send);
        return state.sending;
    }, [send]);

    const change = useCallback(
        (values: Record<string, unknown>) => {
            const state = ref.current;
            state.values = values;
            state.updatedAt = Date.now();
            state.unsent = true;
            clearTimeout(state.localTimer);
            clearTimeout(state.serverTimer);
            state.localTimer = setTimeout(keepLocalShown, LOCAL_AFTER);
            state.serverTimer = setTimeout(() => void flush(), SERVER_AFTER);
        },
        [keepLocalShown, flush]
    );

    // the link is back: what waited goes to the server
    useEffect(() => {
        const state = ref.current;
        const online = () => void flush();
        window.addEventListener('online', online);
        return () => {
            window.removeEventListener('online', online);
            clearTimeout(state.localTimer);
            clearTimeout(state.serverTimer);
            // leaving the form: the last change is kept here and sent at once, not left for next time
            if (state.unsent) {
                keepLocalShown();
                void flush();
            }
        };
    }, [flush, keepLocalShown]);

    /** Before filing: no save is started any more, and the one on its way (if any) is waited for. */
    const settle = useCallback(async () => {
        const state = ref.current;
        clearTimeout(state.localTimer);
        clearTimeout(state.serverTimer);
        await state.sending;
    }, []);

    /** The request was filed: the server removed its draft; this browser's copy goes too. */
    const filed = useCallback(async () => {
        const state = ref.current;
        clearTimeout(state.localTimer);
        clearTimeout(state.serverTimer);
        state.unsent = false;
        if (canSeal()) await removeLocal(state.localId);
        void queries.invalidateQueries({ queryKey: draftKeys.all });
    }, [queries]);

    /** The server's draft, for the filing. */
    const draftId = useCallback(() => ref.current.draftId, []);

    return { status, change, flush, settle, filed, draftId };
}

/** Throws a person's draft away, here and on the server (gone there already: nothing more to do). */
export async function discardDraft(local: { localId: string } | null, server: DraftSummary | null): Promise<void> {
    if (server)
        try {
            await client.delete(`v1/form-drafts/${server.id}`, ifMatch(server.version));
        } catch (error) {
            if (!(isApiError(error) && error.response?.status === 404)) throw error;
        }
    if (local) await removeLocal(local.localId);
}

/** A call that got no answer at all (a dropped link), as against one the server refused. */
const isNetworkError = (error: unknown): boolean => isApiError(error) && !error.response;
