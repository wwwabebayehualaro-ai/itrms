'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFormsClient, useFormsLanguages } from '../host/FormsHost';
import { createKeys } from '../host/client';
import { FORMS_API, queryOf, resultOf, viewSchemaOf, type WireQueryResult, type WireViewSchema } from '../api/wire';
import type { QueryRequest } from './types';

export const viewKeys = createKeys('submission-view');

/** What the viewer can do with the data of one form (fields, operators, roles, modes). Derived by the server from the published version. */
export function useViewSchema(templateId?: string) {
    const client = useFormsClient();
    // the labels come back in the page's language
    const { language } = useFormsLanguages();
    return useQuery({
        queryKey: [...viewKeys.all, 'schema', templateId ?? '', language],
        queryFn: async ({ signal }) =>
            viewSchemaOf((await client.get<WireViewSchema>(`${FORMS_API.forms}/${templateId}/view`, { signal })).data),
        enabled: !!templateId,
        staleTime: 60_000
    });
}

/** One query against the submissions of a form; the previous result stays on screen while the next one loads. */
export function useSubmissionData(req: QueryRequest | null) {
    const client = useFormsClient();
    return useQuery({
        queryKey: [...viewKeys.all, 'data', req],
        queryFn: async ({ signal }) =>
            resultOf(
                (
                    await client.post<WireQueryResult>(`${FORMS_API.submissions}/query`, queryOf(req as QueryRequest), {
                        signal
                    })
                ).data
            ),
        enabled: !!req,
        placeholderData: keepPreviousData
    });
}
