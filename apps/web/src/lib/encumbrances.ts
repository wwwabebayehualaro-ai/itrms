'use client';

/**
 * Encumbrances on vehicles (task 1.4a; `@itrms/vehicles`): a vehicle's holds, the office's open and pending ones, and the four
 * commands the screens make (record, request release, confirm, refuse), through the BFF. A change refreshes every vehicle read,
 * as the record, the search and the banner all show what a vehicle carries.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    Encumbrance,
    EncumbranceRecord,
    EncumbranceStatus,
    ReleaseRefusal,
    ReleaseRequest
} from '@itrms/vehicles/contracts';

import client from './api/client';
import { createKeys } from './query/keys';
import { vehicleKeys } from './vehicles';

export type { Encumbrance, EncumbranceRecord, EncumbranceStatus, ReleaseRefusal, ReleaseRequest };

export const encumbranceKeys = createKeys('encumbrances');

interface EncumbranceList {
    items: Encumbrance[];
    nextCursor: string | null;
}

/** The holds of one vehicle, released ones included (the whole region reads the register). */
export function useVehicleEncumbrances(vehicleId: string) {
    return useQuery({
        queryKey: encumbranceKeys.list({ vehicleId }),
        queryFn: async ({ signal }) =>
            (await client.get<EncumbranceList>('v1/encumbrances', { params: { vehicleId, limit: 100 }, signal })).data
                .items
    });
}

/** The holds the active office's subtree recorded, in one status. */
export function useOfficeEncumbrances(status: EncumbranceStatus) {
    return useQuery({
        queryKey: encumbranceKeys.list({ office: true, status }),
        queryFn: async ({ signal }) =>
            (await client.get<EncumbranceList>('v1/encumbrances', { params: { status, limit: 100 }, signal })).data
                .items
    });
}

function useRefresh() {
    const queries = useQueryClient();
    return () =>
        Promise.all([
            queries.invalidateQueries({ queryKey: encumbranceKeys.all }),
            queries.invalidateQueries({ queryKey: vehicleKeys.all })
        ]);
}

export function useRecordEncumbrance() {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: async (input: EncumbranceRecord) => (await client.post<Encumbrance>('v1/encumbrances', input)).data,
        onSuccess: refresh
    });
}

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

export function useRequestRelease(encumbrance: Pick<Encumbrance, 'id' | 'version'>) {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: async (input: ReleaseRequest) =>
            (
                await client.post<Encumbrance>(`v1/encumbrances/${encumbrance.id}/release-request`, input, {
                    headers: ifMatch(encumbrance.version)
                })
            ).data,
        onSuccess: refresh
    });
}

export function useConfirmRelease(encumbrance: Pick<Encumbrance, 'id' | 'version'>) {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: async () =>
            (
                await client.post<Encumbrance>(
                    `v1/encumbrances/${encumbrance.id}/release-confirmation`,
                    {},
                    { headers: ifMatch(encumbrance.version) }
                )
            ).data,
        onSuccess: refresh
    });
}

export function useRefuseRelease(encumbrance: Pick<Encumbrance, 'id' | 'version'>) {
    const refresh = useRefresh();
    return useMutation({
        mutationFn: async (input: ReleaseRefusal) =>
            (
                await client.post<Encumbrance>(`v1/encumbrances/${encumbrance.id}/release-refusal`, input, {
                    headers: ifMatch(encumbrance.version)
                })
            ).data,
        onSuccess: refresh
    });
}
