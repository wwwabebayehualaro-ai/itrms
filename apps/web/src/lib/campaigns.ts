'use client';

/**
 * Campaign counters (task 1.13i, `@itrms/competency`): a unit's campaigns, each office's daily count against its target, the targets
 * the unit above sets and the closing of a campaign, through the BFF.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    Campaign,
    CampaignCreateInput,
    CampaignKind,
    CampaignList,
    CampaignOffice,
    CampaignProgress,
    CampaignTargetInput
} from '@itrms/competency/contracts';

import client from './api/client';

export type { Campaign, CampaignCreateInput, CampaignKind, CampaignList, CampaignOffice, CampaignProgress };
/** the id, code and name of an office */
export type UnitRef = CampaignOffice['unit'];

const KEY = ['campaigns'] as const;

export function useCampaigns() {
    return useQuery<CampaignList>({
        queryKey: KEY,
        queryFn: async ({ signal }) => (await client.get<CampaignList>('v1/campaigns', { signal })).data
    });
}

export function useCampaign(id: string) {
    return useQuery<CampaignProgress>({
        queryKey: [...KEY, id],
        queryFn: async ({ signal }) => (await client.get<CampaignProgress>(`v1/campaigns/${id}`, { signal })).data
    });
}

/** The progress of each campaign named (the home page's widget: the open ones, a few). */
export function useCampaignProgresses(ids: readonly string[]) {
    return useQueries({
        queries: ids.map((id) => ({
            queryKey: [...KEY, id],
            queryFn: async ({ signal }: { signal: AbortSignal }) =>
                (await client.get<CampaignProgress>(`v1/campaigns/${id}`, { signal })).data
        }))
    });
}

export function useCreateCampaign() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: CampaignCreateInput) => (await client.post<Campaign>('v1/campaigns', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: KEY })
    });
}

/** Sets a target; `version` is the target's it replaces, none for a target new to the office. */
export function useSetCampaignTarget(id: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { target: CampaignTargetInput; version: number | null }) =>
            (
                await client.put<CampaignProgress>(`v1/campaigns/${id}/targets`, input.target, {
                    headers: input.version === null ? {} : { 'If-Match': `"${input.version}"` }
                })
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: KEY })
    });
}

export function useCloseCampaign(id: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (version: number) =>
            (
                await client.post<CampaignProgress>(
                    `v1/campaigns/${id}/close`,
                    {},
                    { headers: { 'If-Match': `"${version}"` } }
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: KEY })
    });
}
