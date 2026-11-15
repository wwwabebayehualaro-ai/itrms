'use client';

/**
 * Sampling QA of migrated vehicles (task 1.13g, `@itrms/competency`): the records drawn for a re-check against the scan, the
 * re-check itself, and each clerk's counts, through the BFF.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClerkCounts, MigrationSample, MigrationSampleRecheck, SampleState } from '@itrms/competency/contracts';

import client from './api/client';

export type { ClerkCounts, MigrationSample, MigrationSampleRecheck, SampleState };

/** The records a list page shows at once. */
export const SAMPLES_PAGE = 25;

const keys = {
    all: ['migration-samples'] as const,
    list: (state: SampleState, offset: number) => ['migration-samples', 'list', state, offset] as const,
    one: (id: string) => ['migration-samples', 'one', id] as const,
    clerks: ['migration-samples', 'clerks'] as const
};

export function useMigrationSamples(state: SampleState, offset: number) {
    return useQuery({
        queryKey: keys.list(state, offset),
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: MigrationSample[]; total: number }>('v1/migration-samples', {
                    params: { state, limit: SAMPLES_PAGE, offset },
                    signal
                })
            ).data
    });
}

export function useMigrationSample(id: string) {
    return useQuery<MigrationSample>({
        queryKey: keys.one(id),
        queryFn: async ({ signal }) =>
            (await client.get<MigrationSample>(`v1/migration-samples/${id}`, { signal })).data
    });
}

export function useClerkCounts() {
    return useQuery<{ items: ClerkCounts[] }>({
        queryKey: keys.clerks,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: ClerkCounts[] }>('v1/migration-samples/clerks', { signal })).data
    });
}

export function useRecheckSample(id: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { version: number; recheck: MigrationSampleRecheck }) =>
            (
                await client.post<MigrationSample>(`v1/migration-samples/${id}/recheck`, input.recheck, {
                    headers: { 'If-Match': `"${input.version}"` }
                })
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.all })
    });
}

/** A short-lived link to a sampled record's scan. */
export function useSampleScanLink() {
    return useMutation({
        mutationFn: async (id: string) =>
            (await client.post<{ url: string; expiresAt: string }>(`v1/migration-samples/${id}/scan`, {})).data.url
    });
}
