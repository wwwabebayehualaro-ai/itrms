'use client';

import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createKeys, type FormsClient } from '../host/client';
import { useFormsClient } from '../host/FormsHost';
import type { FormTemplate, PublishedForm } from '@itrms/schemas';

const BASE = 'template/forms/templates';
/** The approval inbox (the app's `approvalKeys.all`): a publish may open a request there. */
const APPROVALS = ['approvals'] as const;
/** The backend caps a page at 500; the template gallery filters/sorts client-side over the full list. */
const LIST_LIMIT = 500;

export const templateKeys = createKeys('templates');

export type TemplateInput = Omit<FormTemplate, 'id' | 'created_at' | 'updated_at'>;

export const templateListOptions = (client: FormsClient) =>
    queryOptions({
        queryKey: templateKeys.list(),
        queryFn: async ({ signal }) =>
            (await client.get<FormTemplate[]>(BASE, { params: { limit: LIST_LIMIT }, signal })).data,
        placeholderData: keepPreviousData
    });

export const templateDetailOptions = (client: FormsClient, id: string) =>
    queryOptions({
        queryKey: templateKeys.detail(id),
        queryFn: async ({ signal }) => (await client.get<FormTemplate>(`${BASE}/${id}`, { signal })).data
    });

/** All templates of the tenant. Shared by the sidebar, the gallery and the builder, so it is fetched once and kept fresh by mutations. */
export function useTemplateList() {
    const client = useFormsClient();
    return useQuery(templateListOptions(client));
}

/**
 * A "view" template is not a form people fill in: it displays data (e.g. a table of another form's requests) and is shown
 * by that form's page. Category "Views". The builder and the template gallery still list them.
 */
export const isViewTemplate = (t: { category?: string | null }) => t.category === 'Views';

/** Templates a business user can pick to fill in (view templates left out). Same cache entry as `useTemplateList`. */
export function useVisibleTemplates() {
    const client = useFormsClient();
    return useQuery({
        ...templateListOptions(client),
        select: (ts: FormTemplate[]) => ts.filter((t) => !isViewTemplate(t))
    });
}

/** One template. Seeded from the cached list when possible, so opening a card renders instantly and revalidates in the background. */
export function useTemplateQuery(id?: string) {
    const client = useFormsClient();
    const qc = useQueryClient();
    return useQuery({
        ...templateDetailOptions(client, id ?? ''),
        enabled: !!id,
        initialData: () => qc.getQueryData<FormTemplate[]>(templateKeys.list())?.find((t) => t.id === id),
        initialDataUpdatedAt: () => qc.getQueryState(templateKeys.list())?.dataUpdatedAt
    });
}

const toPayload = (t: TemplateInput) => ({
    template_data: {
        name: t.name,
        slug: t.slug,
        // the builder hands over the field array; the API stores an object so the config can grow (runtime, settings…)
        form_config: Array.isArray(t.form_config) ? { fields: t.form_config } : t.form_config,
        version: t.version || '1.0.0',
        ...(t.thumbnail_url && { thumbnail_url: t.thumbnail_url }),
        ...(t.category && { category: t.category }),
        ...(t.file_relations && { file_relations: t.file_relations })
    }
});

/** The form people fill in: the published version (409 `form_not_published` while there is none). */
export type { PublishedForm };

export const publishedOptions = (client: FormsClient, id: string) =>
    queryOptions({
        queryKey: [...templateKeys.detail(id), 'published'] as const,
        queryFn: async ({ signal }) => (await client.get<PublishedForm>(`${BASE}/${id}/published`, { signal })).data,
        retry: false,
        meta: { silent: true }
    });

/** Screens that fill in a form use this, never the working copy the builder edits. */
export function usePublishedTemplate(id?: string) {
    const client = useFormsClient();
    return useQuery({ ...publishedOptions(client, id ?? ''), enabled: !!id });
}

export function useTemplateMutations() {
    const client = useFormsClient();
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: templateKeys.all });

    const create = useMutation({
        mutationFn: async (input: TemplateInput) => (await client.post<FormTemplate>(BASE, toPayload(input))).data,
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to create template' }
    });

    const update = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<FormTemplate> }) =>
            (await client.put<FormTemplate>(`${BASE}/${id}`, data)).data,
        onSuccess: (saved) => {
            qc.setQueryData(templateKeys.detail(saved.id as string), saved);
            return refresh();
        },
        meta: { errorMessage: 'Failed to update template' }
    });

    // Optimistic: the card disappears immediately and comes back if the server refuses.
    const remove = useMutation({
        mutationFn: async (id: string) => {
            await client.delete(`${BASE}/${id}`);
            return id;
        },
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: templateKeys.all });
            const previous = qc.getQueryData<FormTemplate[]>(templateKeys.list());
            qc.setQueryData<FormTemplate[]>(templateKeys.list(), (old) => old?.filter((t) => t.id !== id));
            return { previous };
        },
        onError: (_e, _id, ctx) => {
            if (ctx?.previous) qc.setQueryData(templateKeys.list(), ctx.previous);
        },
        onSettled: refresh,
        meta: { errorMessage: 'Failed to delete template' }
    });

    // Publish the working copy: at once, or (feature flag forms.require_approval) as a request for a second person's approval.
    const publish = useMutation({
        mutationFn: async ({ id, note }: { id: string; note?: string }) =>
            (await client.post<FormTemplate>(`${BASE}/${id}/publish`, { note: note || null })).data,
        onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: APPROVALS })]),
        meta: { errorMessage: 'Could not publish the form' }
    });

    return { create, update, remove, publish };
}
