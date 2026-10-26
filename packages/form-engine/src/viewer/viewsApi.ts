'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { createKeys } from '../host/client';
import { FORMS_API, ifMatch, savedViewOf, toWireConfig, toWireVisibility, type WireSavedView } from '../api/wire';
import type { SavedView, ViewConfig, ViewState } from './types';

export type { SavedView, ViewConfig } from './types';

export const savedViewKeys = createKeys('saved-views');

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
    const { t } = useEngineText();
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: savedViewKeys.all });
    /** The version of a view the screen shows (a change based on an older one is refused, 409). */
    const versionOf = (id: string) => {
        for (const [, views] of qc.getQueriesData<SavedView[]>({ queryKey: savedViewKeys.lists() })) {
            const found = views?.find((v) => v.id === id);
            if (found) return found.row_version;
        }
        throw new Error(t('form-engine.viewer.views.gone'));
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
        meta: { errorMessage: t('form-engine.viewer.views.saveFailed') }
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
        meta: { errorMessage: t('form-engine.viewer.views.changeFailed') }
    });
    const remove = useMutation({
        mutationFn: async (id: string) => {
            await client.delete(`${FORMS_API.savedViews}/${id}`, ifMatch(versionOf(id)));
            return id;
        },
        onSuccess: refresh,
        meta: { errorMessage: t('form-engine.viewer.views.deleteFailed') }
    });
    return { create, update, remove };
}
