'use client';

/**
 * Cases and the inbox (task 0.20b, `@itrms/workflow`): queries and changes through the BFF. The types come from the
 * slice's contracts, so the screens and the API share one definition. A transition names the case version it was based
 * on (If-Match); a claim, a release and a comment answer with the case as it is now.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CaseOut,
    CommentCreate,
    Inbox,
    InboxItem,
    InboxQuery,
    PersonRef,
    SlaState,
    Transition
} from '@itrms/workflow/contracts';

import client from './api/client';
import { createKeys } from './query/keys';
import { workspaceKeys } from './workspace';

export type { CaseOut, Inbox, InboxItem, PersonRef, SlaState };
export type InboxFilters = Partial<Pick<InboxQuery, 'claim' | 'sla' | 'state' | 'number'>>;

export const caseKeys = createKeys('cases');
export const inboxKeys = createKeys('inbox');

const ifMatch = (version: number) => ({ headers: { 'if-match': `"${version}"` } });

/** The caller's inbox, a page at a time (`after`: the previous page's `nextCursor`). */
export function useInbox(filters: InboxFilters, after: string | null) {
    return useQuery({
        queryKey: inboxKeys.list({ ...filters, after }),
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (
                await client.get<Inbox>('v1/me/tasks', {
                    params: { ...filters, ...(after ? { after } : {}), limit: 25 },
                    signal
                })
            ).data
    });
}

export function useCase(id: string) {
    return useQuery({
        queryKey: caseKeys.detail(id),
        queryFn: async ({ signal }) => (await client.get<CaseOut>(`v1/cases/${id}`, { signal })).data
    });
}

/** What changes a case: the case as it is afterwards replaces the cached one, and the inbox is read again. */
function useCaseChange<V>(id: string, run: (input: V) => Promise<CaseOut>) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: run,
        onSuccess: (after) => {
            queries.setQueryData(caseKeys.detail(id), after);
            void queries.invalidateQueries({ queryKey: inboxKeys.all });
            void queries.invalidateQueries({ queryKey: workspaceKeys.all });
        }
    });
}

export function useTransition(id: string) {
    return useCaseChange(
        id,
        async ({ version, ...body }: Transition & { version: number }) =>
            (await client.post<CaseOut>(`v1/cases/${id}/transitions`, body, ifMatch(version))).data
    );
}

export function useClaim(id: string) {
    return useCaseChange(
        id,
        async ({ taskId, release }: { taskId: string; release?: boolean }) =>
            (await client.post<CaseOut>(`v1/cases/${id}/tasks/${taskId}/${release ? 'release' : 'claim'}`)).data
    );
}

export function useComment(id: string) {
    return useCaseChange(
        id,
        async (body: CommentCreate) => (await client.post<CaseOut>(`v1/cases/${id}/comments`, body)).data
    );
}

/** Who a comment on the case may mention, by name (nothing until a letter is typed). */
export function useCasePeople(id: string, q: string, enabled: boolean) {
    const query = q.trim();
    return useQuery({
        queryKey: [...caseKeys.detail(id), 'people', query] as const,
        enabled: enabled && query.length >= 1,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: PersonRef[] }>(`v1/cases/${id}/people`, { params: { q: query }, signal })).data
                .items
    });
}
