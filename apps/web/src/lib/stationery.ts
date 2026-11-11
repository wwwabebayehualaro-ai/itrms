'use client';

/**
 * Controlled stationery (task 1.12a; `@itrms/fees`): counts per office and kind, the movements, the closings, and the
 * commands the screens make (receive a delivery, allocate to a unit below, accept an allocation, close the day's count),
 * through the BFF. The client adds the Idempotency-Key to every POST.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    StationeryAcceptance,
    StationeryAllocation,
    StationeryBatch,
    StationeryClosing,
    StationeryClosingInput,
    StationeryKind,
    StationeryMovement,
    StationeryReceive,
    StationerySummary,
    StationerySummaryRow
} from '@itrms/fees/contracts';
import { STATIONERY_KINDS } from '@itrms/fees/contracts';

import client from './api/client';
import { createKeys } from './query/keys';

export { STATIONERY_KINDS };
export type {
    StationeryAllocation,
    StationeryBatch,
    StationeryClosing,
    StationeryClosingInput,
    StationeryKind,
    StationeryMovement,
    StationeryReceive,
    StationerySummary,
    StationerySummaryRow
};

export const stationeryKeys = createKeys('stationery');

export function isStationeryKind(value: string | null | undefined): value is StationeryKind {
    return (STATIONERY_KINDS as readonly string[]).includes(value ?? '');
}

/** The counts of one kind at the active unit and the units directly under it. */
export function useStationerySummary(kind: StationeryKind) {
    return useQuery({
        queryKey: stationeryKeys.detail(`summary-${kind}`),
        queryFn: async ({ signal }) =>
            (await client.get<StationerySummary>('v1/stationery/summary', { params: { kind }, signal })).data
    });
}

export function useStationeryMovements(query: {
    kind?: StationeryKind;
    unitId?: string;
    movement?: StationeryMovement['movement'];
    limit?: number;
}) {
    return useQuery({
        queryKey: stationeryKeys.list({ movements: query }),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: StationeryMovement[]; nextCursor: string | null }>(
                    'v1/stationery/movements',
                    {
                        params: query,
                        signal
                    }
                )
            ).data.items
    });
}

export function useStationeryClosings(kind: StationeryKind) {
    return useQuery({
        queryKey: stationeryKeys.list({ closings: kind }),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: StationeryClosing[] }>('v1/stationery/closings', { params: { kind }, signal }))
                .data.items
    });
}

export function useReceiveStationery() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: StationeryReceive) =>
            (await client.post<StationeryBatch>('v1/stationery/batches', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stationeryKeys.all })
    });
}

export function useAllocateStationery() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: StationeryAllocation) =>
            (await client.post<StationeryMovement>('v1/stationery/allocations', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stationeryKeys.all })
    });
}

export function useAcceptStationery(movementId: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: StationeryAcceptance = {}) =>
            (await client.post<StationeryMovement>(`v1/stationery/movements/${movementId}/acceptance`, input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stationeryKeys.all })
    });
}

export function useCloseStationery() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: StationeryClosingInput) =>
            (await client.post<StationeryClosing>('v1/stationery/closings', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stationeryKeys.all })
    });
}
