'use client';

/**
 * Maker-checker approvals (backend: `foundation/approval`). Requests are opened by the module that needs them (e.g. publishing a
 * form); these hooks serve the inbox and the decisions.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from './api/client';
import type { ApiSchema } from './api/types';
import { createKeys } from './query/keys';

export type Approval = ApiSchema<'ApprovalOut'>;
export type ApprovalPage = ApiSchema<'ApprovalPage'>;
export type ApprovalStatus = Approval['status'];
export type ApprovalScope = 'to_decide' | 'mine' | 'all';

export interface ApprovalListParams {
    scope: ApprovalScope;
    status?: ApprovalStatus;
    resource_type?: string;
    resource_id?: string;
    page?: number;
    page_size?: number;
}

export const approvalKeys = createKeys('approvals');
const BASE = 'platform/approvals';

export function useApprovals(params: ApprovalListParams) {
    return useQuery({
        queryKey: approvalKeys.list(params),
        queryFn: async ({ signal }) => (await client.get<ApprovalPage>(BASE, { params, signal })).data,
        placeholderData: keepPreviousData
    });
}

/** The open request of one resource (e.g. a form waiting to be published), if any. */
export function usePendingApproval(resource_type: string, resource_id?: string) {
    const q = useApprovals({ scope: 'all', status: 'pending', resource_type, resource_id, page_size: 1 });
    return { ...q, data: resource_id ? q.data?.items[0] : undefined };
}

/**
 * Approve / reject / withdraw. A decision has effects elsewhere (the policy's hook: a form gets published, ...), so every
 * cached query is marked stale afterwards; only what is on screen refetches.
 */
export function useApprovalActions() {
    const qc = useQueryClient();
    const settle = () => qc.invalidateQueries();
    const approve = useMutation({
        mutationFn: async ({ id, comment, row_version }: { id: string; comment?: string; row_version?: number }) =>
            (await client.post<Approval>(`${BASE}/${id}/approve`, { comment: comment || null, row_version })).data,
        onSuccess: settle,
        meta: { errorMessage: 'Could not approve the request' }
    });
    const reject = useMutation({
        mutationFn: async ({ id, comment, row_version }: { id: string; comment: string; row_version?: number }) =>
            (await client.post<Approval>(`${BASE}/${id}/reject`, { comment, row_version })).data,
        onSuccess: settle,
        meta: { errorMessage: 'Could not reject the request' }
    });
    const cancel = useMutation({
        mutationFn: async ({ id, row_version }: { id: string; row_version?: number }) => (await client.post<Approval>(`${BASE}/${id}/cancel`, { row_version })).data,
        onSuccess: settle,
        meta: { errorMessage: 'Could not withdraw the request' }
    });
    return { approve, reject, cancel };
}
