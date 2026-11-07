'use client';

/**
 * The signed-in person's notifications (tasks 0.20a, 0.20b): the newest first, read again every minute and when the
 * window comes back into focus, and marking them read. A notice's text comes in every language of the installation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import client from './api/client';
import { createKeys } from './query/keys';

export interface Notice {
    id: string;
    unitId: string;
    key: string;
    text: Record<string, string>;
    link: Record<string, string> | null;
    read: boolean;
    at: string;
}

export const noticeKeys = createKeys('notifications');

export function useNotices() {
    return useQuery({
        queryKey: noticeKeys.list(),
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: Notice[] }>('v1/me/notifications', { params: { limit: 30 }, signal })).data.items
    });
}

export function useMarkRead() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (ids: string[]) =>
            (await client.post<{ marked: number }>('v1/me/notifications/read', { ids })).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: noticeKeys.all })
    });
}

/** Where a notice leads: its case, or the form whose export it is about. */
export function noticeHref(notice: Notice): string | null {
    if (notice.link?.caseId) return `/cases/${notice.link.caseId}`;
    if (notice.link?.formId) return `/submitted-forms/template/${notice.link.formId}`;
    return null;
}
