'use client';

/**
 * A case's or a record's documents (task 0.23a, `@itrms/documents`): queries through the BFF. A document's PDF is made by the
 * PDF worker a moment after it is issued, so a list with one still being made follows it. A reprint opens the stored PDF.
 */
import { useQuery } from '@tanstack/react-query';
import type { IssuedDocumentOut } from '@itrms/documents/contracts';

import client from './api/client';

export type { IssuedDocumentOut };

export const documentKeys = {
    all: ['documents'] as const,
    of: (filter: { caseId?: string; subjectId?: string }) => ['documents', filter] as const
};

export function useIssuedDocuments(filter: { caseId?: string; subjectId?: string }, enabled = true) {
    return useQuery<{ items: IssuedDocumentOut[] }>({
        queryKey: documentKeys.of(filter),
        enabled,
        refetchInterval: (query) => (query.state.data?.items.some((d) => d.state === 'requested') ? 3000 : false),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: IssuedDocumentOut[] }>('v1/issued-documents', { params: filter, signal })).data
    });
}

/** A short-lived link to the stored PDF. */
export async function documentLink(id: string): Promise<string> {
    return (await client.get<{ url: string }>(`v1/issued-documents/${id}/download`)).data.url;
}
