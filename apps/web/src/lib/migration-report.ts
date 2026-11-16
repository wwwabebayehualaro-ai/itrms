'use client';

/**
 * The reconciliation report of the paper-record migration (task 1.13h, `@itrms/competency`): paper files counted against the
 * vehicles migrated, per office and plate code, and the paper counts the zone sets, through the BFF.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    MigrationReport,
    PaperCountInput,
    PaperPlateCode,
    ReconciliationOffice
} from '@itrms/competency/contracts';

import client from './api/client';

export type { MigrationReport, PaperCountInput, PaperPlateCode, ReconciliationOffice };

const KEY = ['migration-report'] as const;

export function useMigrationReport() {
    return useQuery<MigrationReport>({
        queryKey: KEY,
        queryFn: async ({ signal }) => (await client.get<MigrationReport>('v1/migration-report', { signal })).data
    });
}

/** Sets a count; `version` is the count's it replaces, none for a count new to the office and code. */
export function useSetPaperCount() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { count: PaperCountInput; version: number | null }) =>
            (
                await client.put<ReconciliationOffice>('v1/migration-report/paper-counts', input.count, {
                    headers: input.version === null ? {} : { 'If-Match': `"${input.version}"` }
                })
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: KEY })
    });
}
