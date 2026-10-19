'use client';

/**
 * Modules and feature flags of the signed-in user's tenant (backend: `foundation/registry`).
 *
 *   const { data } = useModules();            // enabled modules, the user's menu (nav), every flag's value
 *   const on = useFeatureFlag('forms.require_approval');
 *
 * One request (`GET /platform/modules`) serves the menu and every flag, cached by TanStack Query and dropped on sign-out.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from './api/client';
import type { ApiSchema } from './api/types';
import { createKeys } from './query/keys';

export type ModulesInfo = ApiSchema<'ModulesOut'>;
export type NavGroup = ApiSchema<'NavGroupOut'>;
export type NavItem = ApiSchema<'NavItemOut'>;
export type FeatureFlag = ApiSchema<'FlagOut'>;

export const moduleKeys = createKeys('modules');
export const flagKeys = createKeys('feature-flags');

export function useModules() {
    return useQuery({
        queryKey: moduleKeys.all,
        queryFn: async ({ signal }) => (await client.get<ModulesInfo>('platform/modules', { signal })).data,
        staleTime: 60_000
    });
}

/** `undefined` while loading; then the flag's effective value (unknown keys read as off). */
export function useFeatureFlag(key: string): boolean | undefined {
    const { data } = useModules();
    return data ? data.flags[key] === true : undefined;
}

/** Admin: every flag with its default and the tenant's override (needs `feature_flag:read`). */
export function useFeatureFlagsAdmin() {
    return useQuery({
        queryKey: flagKeys.list(),
        queryFn: async ({ signal }) => (await client.get<FeatureFlag[]>('platform/flags', { signal })).data
    });
}

/** Admin: `enabled: null` removes the override (back to the default). Refreshes the flag list and everyone's menu. */
export function useSetFeatureFlag() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ key, enabled }: { key: string; enabled: boolean | null }) =>
            (await client.put<FeatureFlag>(`platform/flags/${encodeURIComponent(key)}`, { enabled })).data,
        onSuccess: () =>
            Promise.all([
                qc.invalidateQueries({ queryKey: flagKeys.all }),
                qc.invalidateQueries({ queryKey: moduleKeys.all })
            ]),
        meta: { errorMessage: 'Could not change the feature flag' }
    });
}
