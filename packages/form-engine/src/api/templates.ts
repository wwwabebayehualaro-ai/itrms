'use client';

import { useCallback, useRef } from 'react';
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createKeys, type FormsClient } from '../host/client';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import type { FormTemplate, PublishedForm } from '@itrms/schemas';
import {
    FORMS_API,
    formChangeOf,
    ifMatch,
    keyOf,
    publishedOf,
    templateOf,
    textAll,
    type WireForm,
    type WireVersion
} from './wire';

/** The approval inbox (the app's `approvalKeys.all`): a publish opens a request there. */
const APPROVALS = ['approvals'] as const;
/** The API's largest page; the template gallery filters and sorts client-side over it. */
const LIST_LIMIT = 100;

export const templateKeys = createKeys('templates');

export type TemplateInput = Omit<FormTemplate, 'id' | 'created_at' | 'updated_at'>;

export { ifMatch };

const getForm = async (client: FormsClient, id: string, signal?: AbortSignal) =>
    (await client.get<WireForm>(`${FORMS_API.forms}/${id}`, { signal })).data;

export const templateListOptions = (client: FormsClient) =>
    queryOptions({
        queryKey: templateKeys.list(),
        queryFn: async ({ signal }) =>
            // a deleted form is switched off: it leaves the lists (its submissions keep naming it)
            (
                await client.get<{ items: WireForm[] }>(FORMS_API.forms, {
                    params: { limit: LIST_LIMIT, active: 'true' },
                    signal
                })
            ).data.items.map(templateOf),
        placeholderData: keepPreviousData
    });

export const templateDetailOptions = (client: FormsClient, id: string) =>
    queryOptions({
        queryKey: templateKeys.detail(id),
        queryFn: async ({ signal }) => templateOf(await getForm(client, id, signal))
    });

/** All forms of the unit's view. Shared by the sidebar, the gallery and the builder, so it is fetched once and kept fresh by mutations. */
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

/** One form with its working copy (a list carries no document, so the detail is never seeded from it). */
export function useTemplateQuery(id?: string) {
    const client = useFormsClient();
    return useQuery({ ...templateDetailOptions(client, id ?? ''), enabled: !!id });
}

/**
 * Loads one form with its working copy, for a screen that holds only its list item (the gallery's Edit and Preview): a
 * list item's document is empty, so editing or previewing it would show, and save, a blank form.
 */
export function useTemplateLoader() {
    const client = useFormsClient();
    const qc = useQueryClient();
    return useCallback((id: string) => qc.fetchQuery(templateDetailOptions(client, id)), [client, qc]);
}

/** The form people fill in: the published version (409 `not_configured` while there is none). */
export type { PublishedForm };

export const publishedOptions = (client: FormsClient, id: string) =>
    queryOptions({
        queryKey: [...templateKeys.detail(id), 'published'] as const,
        queryFn: async ({ signal }) => {
            const [form, version] = await Promise.all([
                getForm(client, id, signal),
                client.get<WireVersion>(`${FORMS_API.forms}/${id}/versions/published`, { signal })
            ]);
            return publishedOf(form, version.data);
        },
        retry: false,
        meta: { silent: true }
    });

/** Screens that fill in a form use this, never the working copy the builder edits. */
export function usePublishedTemplate(id?: string) {
    const client = useFormsClient();
    return useQuery({ ...publishedOptions(client, id ?? ''), enabled: !!id });
}

interface WirePublication {
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
}

export function useTemplateMutations() {
    const client = useFormsClient();
    const { t } = useEngineText();
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: templateKeys.all });
    /** The version a change is based on: the one the screen holds, or (an overwrite, or none held) the current one. */
    const versionOf = async (id: string, held?: number) => held ?? (await getForm(client, id)).version;
    const shown = useRef(new Map<string, number>());

    const create = useMutation({
        mutationFn: async (input: TemplateInput) => {
            const body = {
                key: keyOf(input.slug || input.names?.en || input.name),
                name: input.names ?? textAll(input.name),
                ...(input.category ? { category: input.category } : {}),
                document: formChangeOf({ form_config: input.form_config }).document ?? { fields: [] }
            };
            return templateOf((await client.post<WireForm>(FORMS_API.forms, body)).data);
        },
        onSuccess: refresh,
        meta: { errorMessage: t('form-engine.renderer.api.templateCreateFailed') }
    });

    const update = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<FormTemplate> }) => {
            const version = await versionOf(id, data.row_version);
            return templateOf(
                (await client.patch<WireForm>(`${FORMS_API.forms}/${id}`, formChangeOf(data), ifMatch(version))).data
            );
        },
        onSuccess: (saved) => {
            qc.setQueryData(templateKeys.detail(saved.id as string), saved);
            return refresh();
        },
        meta: { errorMessage: t('form-engine.renderer.api.templateUpdateFailed') }
    });

    // A form is never deleted (its submissions keep naming it): it is switched off. Optimistic: the card goes at once.
    const remove = useMutation({
        mutationFn: async (id: string) => {
            await client.patch(
                `${FORMS_API.forms}/${id}`,
                { active: false },
                ifMatch(await versionOf(id, shown.current.get(id)))
            );
            shown.current.delete(id);
            return id;
        },
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: templateKeys.all });
            const previous = qc.getQueryData<FormTemplate[]>(templateKeys.list());
            // the version the card showed, kept before the card leaves the list (onMutate runs before mutationFn)
            const version = previous?.find((t) => t.id === id)?.row_version;
            if (version !== undefined) shown.current.set(id, version);
            qc.setQueryData<FormTemplate[]>(templateKeys.list(), (old) => old?.filter((t) => t.id !== id));
            return { previous };
        },
        onError: (_e, _id, ctx) => {
            if (ctx?.previous) qc.setQueryData(templateKeys.list(), ctx.previous);
        },
        onSettled: refresh,
        meta: { errorMessage: t('form-engine.renderer.api.templateDeleteFailed') }
    });

    // Publishing asks for a publication: a second person approves it in the approvals inbox (SEC-AC-6).
    const publish = useMutation({
        mutationFn: async ({ id, note }: { id: string; note?: string }) => {
            const p = (
                await client.post<WirePublication>(`${FORMS_API.forms}/${id}/publications`, {
                    ...(note?.trim() ? { note: note.trim() } : {})
                })
            ).data;
            return { status: p.status === 'approved' ? ('published' as const) : ('pending_approval' as const) };
        },
        onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: APPROVALS })]),
        meta: { errorMessage: t('form-engine.renderer.api.publishFailed') }
    });

    return { create, update, remove, publish };
}
