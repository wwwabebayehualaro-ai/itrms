'use client';

/**
 * The bulk import of paper vehicle files (task 1.13b, `@itrms/competency`): sheets sent with their scans, their dry-run report, the
 * commit by a second person, through the BFF. The worker reads and commits a sheet; the screens follow it until it is done.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ImportRowState,
    ImportState,
    VehicleImport,
    VehicleImportCreate,
    VehicleImportRow
} from '@itrms/competency/contracts';

import client from './api/client';

export type { ImportRowState, VehicleImport, VehicleImportRow };

/** The rows a report page shows at once. */
export const ROWS_PAGE = 50;

const keys = {
    all: ['vehicle-imports'] as const,
    list: ['vehicle-imports', 'list'] as const,
    one: (id: string) => ['vehicle-imports', 'one', id] as const,
    rows: (id: string, state: ImportRowState | undefined, offset: number) =>
        ['vehicle-imports', 'rows', id, state ?? 'all', offset] as const,
    row: (id: string) => ['vehicle-imports', 'row', id] as const
};

/** A batch the worker is still on: the screens ask again until it is done. */
export const isWorking = (state: ImportState) => state === 'checking' || state === 'committing';

export function useVehicleImports() {
    return useQuery<{ items: VehicleImport[] }>({
        queryKey: keys.list,
        refetchInterval: (query) => (query.state.data?.items.some((i) => isWorking(i.state)) ? 3000 : false),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: VehicleImport[] }>('v1/vehicle-imports', { params: { limit: 50 }, signal })).data
    });
}

export function useVehicleImport(id: string) {
    return useQuery<VehicleImport>({
        queryKey: keys.one(id),
        refetchInterval: (query) => (query.state.data && isWorking(query.state.data.state) ? 3000 : false),
        queryFn: async ({ signal }) => (await client.get<VehicleImport>(`v1/vehicle-imports/${id}`, { signal })).data
    });
}

export function useVehicleImportRows(id: string, state: ImportRowState | undefined, offset: number, working: boolean) {
    return useQuery({
        queryKey: keys.rows(id, state, offset),
        placeholderData: keepPreviousData,
        refetchInterval: working ? 3000 : false,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: VehicleImportRow[]; total: number }>(`v1/vehicle-imports/${id}/rows`, {
                    params: { ...(state ? { state } : {}), limit: ROWS_PAGE, offset },
                    signal
                })
            ).data
    });
}

export function useVehicleImportRow(rowId: string) {
    return useQuery({
        queryKey: keys.row(rowId),
        queryFn: async ({ signal }) =>
            (await client.get<VehicleImportRow & { importId: string }>(`v1/vehicle-imports/rows/${rowId}`, { signal }))
                .data
    });
}

export function useCreateVehicleImport() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: VehicleImportCreate) =>
            (await client.post<VehicleImport>('v1/vehicle-imports', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.all })
    });
}

export function useCommitVehicleImport() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; version: number }) =>
            (
                await client.post<VehicleImport>(
                    `v1/vehicle-imports/${input.id}/commit`,
                    {},
                    { headers: { 'If-Match': `"${input.version}"` } }
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.all })
    });
}

export function useDiscardVehicleImport() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: string; version: number }) =>
            (
                await client.post<VehicleImport>(
                    `v1/vehicle-imports/${input.id}/discard`,
                    {},
                    { headers: { 'If-Match': `"${input.version}"` } }
                )
            ).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: keys.all })
    });
}

/** A short-lived link to a row's scan. */
export async function scanLink(rowId: string): Promise<string> {
    return (await client.post<{ url: string }>(`v1/vehicle-imports/rows/${rowId}/scan`, {})).data.url;
}
