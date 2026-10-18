'use client';

import { useMutation } from '@tanstack/react-query';
import client from '@platform/lib/api/client';
import { filenameFromDisposition, saveBlob } from '@platform/lib/download';
import type { FilterGroup, SortKey } from './types';

/** Export the requests the viewer is showing (same filter, search and sort) as CSV. The server resolves names and labels and audits it. */
export function useExportRequests() {
    return useMutation({
        mutationFn: async (req: { template_id: string; filter?: FilterGroup; search?: string; sort?: SortKey[] }) => {
            const res = await client.post<Blob>('form/submissions/export', req, { responseType: 'blob' });
            saveBlob(res.data, filenameFromDisposition(res.headers['content-disposition'], 'requests.csv'));
            return Number(res.headers['x-row-count'] ?? 0);
        },
        // a failed export arrives as a blob: say what the server said, not "Failed"
        meta: { errorMessage: 'Export failed' }
    });
}
