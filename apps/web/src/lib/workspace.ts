'use client';

/**
 * What waits for the person (task 0.20d): the counts behind the menu's badges and the home page's widgets: their open
 * steps (as their inbox lists them) and the publications they may decide. Read again every minute and on focus, only
 * when their roles may see them.
 */
import { useQuery } from '@tanstack/react-query';

import client from './api/client';
import { useCan } from './auth/authHooks';
import { createKeys } from './query/keys';

export const workspaceKeys = createKeys('workspace');

const FRESH = { refetchInterval: 60_000, refetchOnWindowFocus: true } as const;

export interface TaskCount {
    open: number;
    overdue: number;
    unclaimed: number;
}

export function useTaskCount() {
    const may = useCan('case:act');
    return useQuery({
        queryKey: [...workspaceKeys.all, 'tasks'] as const,
        enabled: may,
        ...FRESH,
        queryFn: async ({ signal }) => (await client.get<TaskCount>('v1/me/tasks/count', { signal })).data
    });
}

export function useApprovalCount() {
    const may = useCan('form:approve');
    return useQuery({
        queryKey: [...workspaceKeys.all, 'approvals'] as const,
        enabled: may,
        ...FRESH,
        queryFn: async ({ signal }) =>
            (await client.get<{ decidable: number }>('v1/form-publications/count', { signal })).data.decidable
    });
}

/** A menu item's badge: what waits behind it (none for an item without one). */
export function useMenuBadges(): Readonly<Record<string, number | undefined>> {
    const tasks = useTaskCount();
    const approvals = useApprovalCount();
    return { 'workflow.inbox': tasks.data?.open, 'forms.approvals': approvals.data };
}
