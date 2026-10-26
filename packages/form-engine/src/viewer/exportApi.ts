'use client';

import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { EngineTranslate } from '../core/messages';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
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

/** Looks at a job this many times in a row without an answer before it gives up (the network, not the export). */
const MAX_MISSES = 3;

async function inBackground(
    client: FormsClient,
    body: object,
    alive: () => boolean,
    t: EngineTranslate
): Promise<number> {
    let job = (await client.post<ExportJob>('v1/submission-exports', body)).data;
    const until = Date.now() + POLL_FOR_MS;
    let misses = 0;
    while (job.status === 'queued' || job.status === 'running') {
        if (!alive()) throw new Error(t('form-engine.viewer.export.leftPage'));
        if (Date.now() > until) throw new Error(t('form-engine.viewer.export.stillMaking'));
        await pause(POLL_MS);
        try {
            job = (await client.get<ExportJob>(`v1/submission-exports/${job.id}`)).data;
            misses = 0;
        } catch (error) {
            // a dropped connection is not a failed export: look again, a few times
            if (isRequestError(error) && error.response) throw error;
            if (++misses >= MAX_MISSES) throw error;
        }
    }
    if (job.status !== 'done') throw new Error(job.error ?? t('form-engine.viewer.export.notMade'));
    openLink((await client.post<{ url: string }>(`v1/submission-exports/${job.id}/download`, {})).data.url);
    return job.rows ?? 0;
}

/**
 * Export the requests the viewer is showing (same filter, search and sort) as CSV. The server resolves names and labels
 * and audits it. Up to DIRECT_EXPORT_ROWS rows come at once; more are made in the background and downloaded when ready.
 */
export function useExportRequests() {
    const client = useFormsClient();
    const { t } = useEngineText();
    // a background export is no longer followed once the viewer is left
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const alive = () => mounted.current;
    return useMutation({
        mutationFn: async (req: { template_id: string; filter?: FilterGroup; search?: string; sort?: SortKey[] }) => {
            const body = {
                formId: req.template_id,
                format: 'csv' as const,
                ...(req.filter ? { filter: filterKeys(req.filter, toWireKey) } : {}),
                ...(req.search ? { search: req.search } : {}),
                sort: sortKeys(req.sort, toWireKey)
            };
            const count = async () =>
                (
                    await client.post<WireQueryResult>(`${FORMS_API.submissions}/query`, {
                        formId: body.formId,
                        ...(body.filter ? { filter: body.filter } : {}),
                        ...(body.search ? { search: body.search } : {}),
                        rows: false
                    })
                ).data.total;
            if ((await count()) > DIRECT_EXPORT_ROWS) return inBackground(client, body, alive, t);
            let res: FormsResponse<Blob>;
            try {
                res = await client.post<Blob>(`${FORMS_API.submissions}/export`, body, { responseType: 'blob' });
            } catch (error) {
                // refused because more rows came since the count: made in the background; any other refusal is shown
                if (isRequestError(error) && error.response?.status === 400 && (await count()) > DIRECT_EXPORT_ROWS)
                    return inBackground(client, body, alive, t);
                throw error;
            }
            saveBlob(res.data, filenameFromDisposition(res.headers['content-disposition'], 'requests.csv'));
            return Number(res.headers['x-row-count'] ?? 0);
        },
        // a failed export arrives as a blob: say what the server said, not "Failed"
        meta: { errorMessage: t('form-engine.viewer.export.failed') }
    });
}
