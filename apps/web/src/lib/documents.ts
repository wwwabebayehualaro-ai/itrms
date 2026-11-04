'use client';

/**
 * A case's or a record's documents (task 0.23a, `@itrms/documents`): queries through the BFF. A document's PDF is made by the
 * PDF worker a moment after it is issued, so a list with one still being made follows it. A reprint opens the stored PDF.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IssuedDocumentOut } from '@itrms/documents/contracts';

import client from './api/client';

export type { IssuedDocumentOut };

export const documentKeys = {
    all: ['documents'] as const,
    of: (filter: { caseId?: string; subjectId?: string }) => ['documents', filter] as const
};

const LATE_MS = 5 * 60 * 1000;

/** Still expected shortly. */
export const isBeingMade = (d: IssuedDocumentOut): boolean =>
    d.state === 'requested' && Date.now() - new Date(d.issuedAt).getTime() < LATE_MS;

/** How long a page with no documents yet keeps asking: a document is issued by a worker, moments after what caused it. */
const WATCH_MS = 60 * 1000;

export function useIssuedDocuments(filter: { caseId?: string; subjectId?: string }, enabled = true) {
    const [openedAt] = useState(() => Date.now());
    return useQuery<{ items: IssuedDocumentOut[] }>({
        queryKey: documentKeys.of(filter),
        enabled,
        // not for ever: past this, its PDF is late and the page says so (an event gone dead, a worker not running)
        refetchInterval: (query) => {
            const items = query.state.data?.items;
            if (items?.some(isBeingMade)) return 3000;
            return items?.length === 0 && Date.now() - openedAt < WATCH_MS ? 5000 : false;
        },
        queryFn: async ({ signal }) =>
            (await client.get<{ items: IssuedDocumentOut[] }>('v1/issued-documents', { params: filter, signal })).data
    });
}

/** A short-lived link to the stored PDF. */
export async function documentLink(id: string): Promise<string> {
    return (await client.get<{ url: string }>(`v1/issued-documents/${id}/download`)).data.url;
}
