'use client';

import { useQuery } from '@tanstack/react-query';
import client from '@platform/lib/api/client';
import { createKeys } from '@platform/lib/query/keys';
import { viewKeys } from './api';

export const recordKeys = createKeys('submission-record');

export interface RecordForm {
    template_id: string;
    name: string;
    form_config: { fields?: any[]; runtime?: any } | any[];
    /** false: made before versions were recorded, shown with the current form */
    versioned: boolean;
    /** false: the form changed since this request was filled in */
    current: boolean;
}

export interface FieldChange {
    field: string;
    old?: unknown;
    new?: unknown;
}

export interface HistoryEntry {
    id: string;
    action: string;
    occurred_at: string;
    actor_id?: string | null;
    actor_name?: string | null;
    changes: FieldChange[];
}

/** The form a request was filled in on (its version), so old data is always shown with the fields it was entered in. */
export function useRecordForm(id?: string) {
    return useQuery({
        queryKey: [...recordKeys.detail(id ?? ''), 'form'],
        queryFn: async ({ signal }) => (await client.get<RecordForm>(`form/submissions/${id}/form`, { signal })).data,
        enabled: !!id
    });
}

/** Who changed what and when, newest first (from the audit trail). */
export function useRecordHistory(id?: string) {
    return useQuery({
        queryKey: [...recordKeys.detail(id ?? ''), 'history'],
        queryFn: async ({ signal }) => (await client.get<HistoryEntry[]>(`form/submissions/${id}/history`, { signal })).data,
        enabled: !!id
    });
}

export { viewKeys };
