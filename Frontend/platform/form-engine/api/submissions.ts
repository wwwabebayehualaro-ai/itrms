'use client';

import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from '@platform/lib/api/client';
import { createKeys } from '@platform/lib/query/keys';
import { viewKeys } from '../viewer/api';
import { recordKeys } from '../viewer/recordApi';

const BASE = 'form/submissions';

export const submissionKeys = createKeys('submissions');

export interface SubmissionListParams {
    templateId?: string;
    status?: string;
    page: number;
    pageSize: number;
    /** `created_at`, `updated_at` or `status`; prefix with `-` for descending. */
    sort?: string;
    /** Only the requests the signed-in person submitted. */
    mine?: boolean;
    /** ISO date-time: only requests submitted after it. */
    createdAfter?: string;
}

export const submissionListOptions = (p: SubmissionListParams) =>
    queryOptions({
        queryKey: submissionKeys.list(p),
        queryFn: async ({ signal }) =>
            (await client.get<PaginatedSubmissions>(BASE, { params: { template_id: p.templateId, status: p.status, mine: p.mine || undefined, created_after: p.createdAfter, page: p.page, page_size: p.pageSize, sort: p.sort }, signal })).data,
        // keep showing the previous page while the next one loads (no flicker when paging or sorting)
        placeholderData: keepPreviousData
    });

/** Server-paginated submissions: of one template, or across forms (by status, mine, recent). */
export function useSubmissionList(params: SubmissionListParams, options: { enabled?: boolean } = {}) {
    return useQuery({ ...submissionListOptions(params), enabled: options.enabled ?? true });
}

export function useSubmissionQuery(id?: string) {
    return useQuery({
        queryKey: submissionKeys.detail(id ?? ''),
        queryFn: async ({ signal }) => (await client.get<IFormSubmission>(`${BASE}/${id}`, { signal })).data,
        enabled: !!id
    });
}

export function useSubmissionMutations() {
    const qc = useQueryClient();
    // also refresh builder-made tables (data sources of a template are cached under 'runtime-ds') wherever they are shown
    const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: submissionKeys.all }), qc.invalidateQueries({ queryKey: viewKeys.all }), qc.invalidateQueries({ queryKey: recordKeys.all }), qc.invalidateQueries({ queryKey: ['runtime-ds'] })]);

    const create = useMutation({
        mutationFn: async (data: IFormSubmissionBase) => (await client.post<IFormSubmission>(BASE, data)).data,
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to submit form' }
    });

    const update = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<IFormSubmissionBase> }) => (await client.patch<IFormSubmission>(`${BASE}/${id}`, data)).data,
        onSuccess: (saved) => {
            qc.setQueryData(submissionKeys.detail(saved.id), saved);
            return refresh();
        },
        meta: { errorMessage: 'Failed to update submission' }
    });

    const setStatus = useMutation({
        mutationFn: async ({ id, status }: { id: string; status: string }) => (await client.patch<IFormSubmission>(`${BASE}/${id}/status`, { status })).data,
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to change the status' }
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            await client.delete(`${BASE}/${id}`);
            return id;
        },
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to delete submission' }
    });

    return { create, update, setStatus, remove };
}
