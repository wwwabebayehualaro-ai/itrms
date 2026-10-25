'use client';

import { useMutation } from '@tanstack/react-query';
import { useFormsClient } from '../host/FormsHost';
import { saveBlob } from '@itrms/ui';

import { filenameFromDisposition } from '../host/files';
import { isRequestError, type FormsClient, type FormsResponse } from '../host/client';
import { DIRECT_EXPORT_ROWS, FORMS_API, filterKeys, sortKeys, toWireKey, type WireQueryResult } from '../api/wire';
import type { FilterGroup, SortKey } from './types';

/** How often a background export is looked at while it is made, and for how long at most. */
const POLL_MS = 2_000;
const POLL_FOR_MS = 10 * 60_000;

interface ExportJob {
    id: string;
    status: 'queued' | 'running' | 'done' | 'failed' | 'expired';
    rows: number | null;
    error: string | null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A file the server made, fetched from its short-lived link (the browser saves it). */
function openLink(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.click();
}

async function inBackground(client: FormsClient, body: object): Promise<number> {
    let job = (await client.post<ExportJob>('v1/submission-exports', body)).data;
    const until = Date.now() + POLL_FOR_MS;
    while (job.status === 'queued' || job.status === 'running') {
        if (Date.now() > until) throw new Error('The export is still being made: ask for it again later.');
        await pause(POLL_MS);
        job = (await client.get<ExportJob>(`v1/submission-exports/${job.id}`)).data;
    }
    if (job.status !== 'done') throw new Error(job.error ?? 'The export could not be made: ask for it again.');
    openLink((await client.post<{ url: string }>(`v1/submission-exports/${job.id}/download`, {})).data.url);
    return job.rows ?? 0;
}

/**
 * Export the requests the viewer is showing (same filter, search and sort) as CSV. The server resolves names and labels
 * and audits it. Up to DIRECT_EXPORT_ROWS rows come at once; more are made in the background and downloaded when ready.
 */
export function useExportRequests() {
    const client = useFormsClient();
    return useMutation({
        mutationFn: async (req: { template_id: string; filter?: FilterGroup; search?: string; sort?: SortKey[] }) => {
            const body = {
                formId: req.template_id,
                format: 'csv' as const,
                ...(req.filter ? { filter: filterKeys(req.filter, toWireKey) } : {}),
                ...(req.search ? { search: req.search } : {}),
                sort: sortKeys(req.sort, toWireKey)
            };
            const { total } = (
                await client.post<WireQueryResult>(`${FORMS_API.submissions}/query`, {
                    formId: body.formId,
                    ...(body.filter ? { filter: body.filter } : {}),
                    ...(body.search ? { search: body.search } : {}),
                    rows: false
                })
            ).data;
            if (total > DIRECT_EXPORT_ROWS) return inBackground(client, body);
            let res: FormsResponse<Blob>;
            try {
                res = await client.post<Blob>(`${FORMS_API.submissions}/export`, body, { responseType: 'blob' });
            } catch (error) {
                // refused as too big for a direct answer (more rows came, or the limit is lower): made in the background
                if (isRequestError(error) && error.response?.status === 400) return inBackground(client, body);
                throw error;
            }
            saveBlob(res.data, filenameFromDisposition(res.headers['content-disposition'], 'requests.csv'));
            return Number(res.headers['x-row-count'] ?? 0);
        },
        // a failed export arrives as a blob: say what the server said, not "Failed"
        meta: { errorMessage: 'Export failed' }
    });
}
