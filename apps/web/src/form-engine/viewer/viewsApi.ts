'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from '@/lib/api/client';
import { createKeys } from '@/lib/query/keys';
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
    return useQuery({
        queryKey: savedViewKeys.list({ templateId }),
        queryFn: async ({ signal }) =>
            (await client.get<SavedView[]>('form/views', { params: { template_id: templateId }, signal })).data,
        enabled: !!templateId
    });
}

export function useSavedViewMutations() {
    const qc = useQueryClient();
    const refresh = () => qc.invalidateQueries({ queryKey: savedViewKeys.all });
    const create = useMutation({
        mutationFn: async (body: {
            template_id: string;
            name: string;
            visibility: 'private' | 'shared';
            is_default: boolean;
            config: ViewConfig;
        }) => (await client.post<SavedView>('form/views', body)).data,
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
        }) => (await client.patch<SavedView>(`form/views/${id}`, body)).data,
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to change the view' }
    });
    const remove = useMutation({
        mutationFn: async (id: string) => {
            await client.delete(`form/views/${id}`);
            return id;
        },
        onSuccess: refresh,
        meta: { errorMessage: 'Failed to delete the view' }
    });
    return { create, update, remove };
}
