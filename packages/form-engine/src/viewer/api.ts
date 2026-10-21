'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFormsClient } from '../host/FormsHost';
import { createKeys } from '../host/client';
import type { QueryRequest, QueryResult, ViewSchema } from './types';

const BASE = 'form/submissions';

export const viewKeys = createKeys('submission-view');

/** What the viewer can do with the data of one form (fields, operators, roles, modes). Derived by the server from the template. */
export function useViewSchema(templateId?: string) {
    const client = useFormsClient();
    return useQuery({
        queryKey: [...viewKeys.all, 'schema', templateId ?? ''],
        queryFn: async ({ signal }) =>
            (await client.get<ViewSchema>(`${BASE}/query/schema`, { params: { template_id: templateId }, signal }))
                .data,
        enabled: !!templateId,
        staleTime: 60_000
    });
}

/** One query against the submissions of a form; the previous result stays on screen while the next one loads. */
export function useSubmissionData(req: QueryRequest | null) {
    const client = useFormsClient();
    return useQuery({
        queryKey: [...viewKeys.all, 'data', req],
        queryFn: async ({ signal }) => (await client.post<QueryResult>(`${BASE}/query`, req, { signal })).data,
        enabled: !!req,
        placeholderData: keepPreviousData
    });
}
