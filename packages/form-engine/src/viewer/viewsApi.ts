'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormsClient } from '../host/FormsHost';
import { createKeys } from '../host/client';
import { ifMatch } from '../api/templates';
import { FORMS_API, savedViewOf, toWireConfig, toWireVisibility, type WireSavedView } from '../api/wire';
import type { FilterGroup, SortKey, ViewState } from './types';

export const savedViewKeys = createKeys('saved-views');

/** What a saved view remembers (the shareable part of the view state). */
export interface ViewConfig {
    mode: string;
    search: string;
    filter: FilterGroup;
    sort: SortKey[];
    columns: string[];
    page_size: number;
    options: Record<string, unknown>;
}

export interface SavedView {
    id: string;
    template_id: string;
    name: string;
    visibility: 'private' | 'shared';
    is_default: boolean;
    config: ViewConfig;
    owner_name?: string | null;
    can_edit: boolean;
    row_version: number;
}

export const configOf = (s: ViewState): ViewConfig => ({
    mode: s.mode,
    search: s.search,
    filter: s.filter,
    sort: s.sort,
    columns: s.columns,
    page_size: s.pageSize,
    options: s.options
});
export const stateOf = (c: ViewConfig): Partial<ViewState> => ({
    mode: c.mode,
    search: c.search,
    filter: c.filter,
    sort: c.sort,
    columns: c.columns,
    pageSize: c.page_size,
    options: c.options,
    page: 1
});

export function useSavedViews(templateId?: string) {
    const client = useFormsClient();
    return useQuery({
        queryKey: savedViewKeys.list({ templateId }),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: WireSavedView[] }>(`${FORMS_API.forms}/${templateId}/views`, { signal })
            ).data.items.map(savedViewOf),
        enabled: !!templateId
    });
}

export function useSavedViewMutations() {
    const client = useFormsClient();
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: savedViewKeys.all });
    /** The version of a view the screen shows (a change based on an older one is refused, 409). */
    const versionOf = (id: string) => {
        for (const [, views] of qc.getQueriesData<SavedView[]>({ queryKey: savedViewKeys.lists() })) {
            const found = views?.find((v) => v.id === id);
            if (found) return found.row_version;
        }
        throw new Error('This view is no longer shown: refresh the page.');
    };
    const create = useMutation({
        mutationFn: async (body: {
            template_id: string;
            name: string;
            visibility: 'private' | 'shared';
            is_default: boolean;
            config: ViewConfig;
        }) =>
            savedViewOf(
                (
                    await client.post<WireSavedView>(`${FORMS_API.forms}/${body.template_id}/views`, {
                        name: body.name,
                        visibility: toWireVisibility(body.visibility),
                        isDefault: body.is_default,
                        config: toWireConfig(body.config)
                    })
                ).data
            ),
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to save the view' }
    });
    const update = useMutation({
        mutationFn: async ({
            id,
            ...body
        }: {
            id: string;
            name?: string;
            visibility?: 'private' | 'shared';
            is_default?: boolean;
            config?: ViewConfig;
        }) =>
            savedViewOf(
                (
                    await client.patch<WireSavedView>(
                        `${FORMS_API.savedViews}/${id}`,
                        {
                            ...(body.name !== undefined ? { name: body.name } : {}),
                            ...(body.visibility ? { visibility: toWireVisibility(body.visibility) } : {}),
                            ...(body.is_default !== undefined ? { isDefault: body.is_default } : {}),
                            ...(body.config ? { config: toWireConfig(body.config) } : {})
                        },
                        ifMatch(versionOf(id))
                    )
                ).data
            ),
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to change the view' }
    });
    const remove = useMutation({
        mutationFn: async (id: string) => {
            await client.delete(`${FORMS_API.savedViews}/${id}`, ifMatch(versionOf(id)));
            return id;
        },
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to delete the view' }
    });
    return { create, update, remove };
}
