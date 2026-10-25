'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormsClient } from '../host/FormsHost';
import { createKeys } from '../host/client';
import {
    FORMS_API,
    historyOf,
    textOf,
    type WireForm,
    type WireHistory,
    type WireSubmission,
    type WireVersion
} from '../api/wire';
import { viewKeys } from './api';
import type { RecordForm } from './types';

export type { FieldChange, HistoryEntry, RecordForm } from './types';

export const recordKeys = createKeys('submission-record');

/** The form a request was filled in on (its version), so old data is always shown with the fields it was entered in. */
export function useRecordForm(id?: string) {
    const client = useFormsClient();
    return useQuery({
        queryKey: [...recordKeys.detail(id ?? ''), 'form'],
        queryFn: async ({ signal }): Promise<RecordForm> => {
            const s = (await client.get<WireSubmission>(`${FORMS_API.submissions}/${id}`, { signal })).data;
            const [form, version] = await Promise.all([
                client.get<WireForm>(`${FORMS_API.forms}/${s.formId}`, { signal }),
                client.get<WireVersion>(`${FORMS_API.forms}/${s.formId}/versions/${s.formVersion.id}`, { signal })
            ]);
            return {
                template_id: s.formId,
                name: textOf(form.data.name),
                form_config: version.data.document as RecordForm['form_config'],
                versioned: true,
                current: form.data.publishedVersion?.id === s.formVersion.id
            };
        },
        enabled: !!id
    });
}

/** Who did what and when, newest first (from the audit trail; the answers' values are never in it). */
export function useRecordHistory(id?: string) {
    const client = useFormsClient();
    return useQuery({
        queryKey: [...recordKeys.detail(id ?? ''), 'history'],
        queryFn: async ({ signal }) =>
            historyOf((await client.get<WireHistory>(`${FORMS_API.submissions}/${id}/history`, { signal })).data),
        enabled: !!id
    });
}

export { viewKeys };
