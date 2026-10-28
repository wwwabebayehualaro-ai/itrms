'use client';

import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createKeys, type FormsClient } from '../host/client';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { viewKeys } from '../viewer/api';
import { recordKeys } from '../viewer/recordApi';
import type { FormSubmissionInput } from '@itrms/schemas';
import { publishedOptions } from './templates';
import { FORMS_API, submissionOf, type WireSubmission } from './wire';

export const submissionKeys = createKeys('submissions');

/** A submission as the screens show it. */
export type ScreenSubmission = ReturnType<typeof submissionOf>;

/**
 * One form's submissions, or (no form) the signed-in person's across forms; newest first, a page at a time. A form's
 * data with filters, sorting and totals is the data viewer's query (`useSubmissionData`).
 */
export interface SubmissionListParams {
    templateId?: string;
    /** Only the requests the signed-in person submitted (the only list across forms). */
    mine?: boolean;
    /** The `next` of the previous page. */
    before?: string;
    limit: number;
}

export interface SubmissionListPage {
    items: ScreenSubmission[];
    /** the cursor of the next page, or null on the last */
    next: string | null;
}

export const submissionListOptions = (client: FormsClient, p: SubmissionListParams) =>
    queryOptions({
        queryKey: submissionKeys.list(p),
        queryFn: async ({ signal }): Promise<SubmissionListPage> => {
            const page = (
                await client.get<{ items: WireSubmission[]; next: string | null }>(FORMS_API.submissions, {
                    params: {
                        formId: p.templateId,
                        mine: p.mine ? 'true' : undefined,
                        before: p.before,
                        limit: p.limit
                    },
                    signal
                })
            ).data;
            return { items: page.items.map(submissionOf), next: page.next };
        },
        // keep showing the previous page while the next one loads (no flicker when paging)
        placeholderData: keepPreviousData
    });

export function useSubmissionList(params: SubmissionListParams, options: { enabled?: boolean } = {}) {
    const client = useFormsClient();
    return useQuery({
        ...submissionListOptions(client, params),
        enabled: (options.enabled ?? true) && (!!params.templateId || !!params.mine)
    });
}

export function useSubmissionQuery(id?: string) {
    const client = useFormsClient();
    return useQuery({
        queryKey: submissionKeys.detail(id ?? ''),
        queryFn: async ({ signal }) =>
            submissionOf((await client.get<WireSubmission>(`${FORMS_API.submissions}/${id}`, { signal })).data),
        enabled: !!id
    });
}

/** Thrown by what the forms API does not do: a submission is changed only by its case's workflow (task 0.19). */
export class UnsupportedChange extends Error {
    constructor(what: string) {
        super(`${what} is not possible yet: a request changes only through its case's workflow.`);
        this.name = 'UnsupportedChange';
    }
}

/**
 * Whether the screens may offer to change, move or delete requests. The forms API files a request once; it changes
 * only through its case's workflow (task 0.19), which will answer this from the case's transitions.
 */
const refuse = (what: string) => (): Promise<never> => Promise.reject(new UnsupportedChange(what));

export function useCanChangeRequests(): boolean {
    return false;
}

export function useSubmissionMutations() {
    const client = useFormsClient();
    const { t } = useEngineText();
    const qc = useQueryClient();
    // also refresh builder-made tables (data sources of a template are cached under 'runtime-ds') wherever they are shown
    const refresh = () =>
        Promise.all([
            qc.invalidateQueries({ queryKey: submissionKeys.all }),
            qc.invalidateQueries({ queryKey: viewKeys.all }),
            qc.invalidateQueries({ queryKey: recordKeys.all }),
            qc.invalidateQueries({ queryKey: ['runtime-ds'] })
        ]);

    // the answers are filed on the version the person filled in, which must still be the published one (409 otherwise);
    // only a caller that did not render a version (none known) files on the one published now
    const create = useMutation({
        mutationFn: async (data: FormSubmissionInput) => {
            const versionId =
                data.form_version_id ?? (await qc.fetchQuery(publishedOptions(client, data.template_id))).version_id;
            return submissionOf(
                (
                    await client.post<WireSubmission>(FORMS_API.submissions, {
                        formId: data.template_id,
                        formVersionId: versionId,
                        answers: data.submission_data,
                        // the draft it was filled from goes with the filing (task 0.20c)
                        ...(data.draft_id ? { draftId: data.draft_id } : {})
                    })
                ).data
            );
        },
        onSuccess: refresh,
        meta: { errorMessage: t('form-engine.renderer.api.submitFailed') }
    });

    const update = useMutation<ScreenSubmission, Error, { id: string; data: Partial<FormSubmissionInput> }>({
        mutationFn: refuse('Changing a request'),
        meta: { errorMessage: t('form-engine.renderer.api.updateFailed') }
    });

    const setStatus = useMutation<ScreenSubmission, Error, { id: string; status: string }>({
        mutationFn: refuse('Changing the status of a request'),
        meta: { errorMessage: t('form-engine.renderer.api.statusFailed') }
    });

    const remove = useMutation<string, Error, string>({
        mutationFn: refuse('Deleting a request'),
        meta: { errorMessage: t('form-engine.renderer.api.deleteFailed') }
    });

    return { create, update, setStatus, remove };
}
