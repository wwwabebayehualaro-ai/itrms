'use client';

/**
 * The plate stock (task 1.2a; `@itrms/vehicles`): counts per office, the movements, and the three commands the screens
 * make (receive a delivery, allocate plates to a unit below, accept an allocation), through the BFF. The client adds the
 * Idempotency-Key to every POST.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    PlateAcceptance,
    PlateAllocation,
    PlateBatch,
    PlateBatchReceive,
    PlateMovement,
    StockSummary,
    StockSummaryRow
} from '@itrms/vehicles/contracts';

import client from './api/client';
import { createKeys } from './query/keys';

export type { PlateAllocation, PlateBatch, PlateBatchReceive, PlateMovement, StockSummary, StockSummaryRow };

export const stockKeys = createKeys('plate-stock');

export interface MovementQuery {
    unitId?: string;
    kind?: PlateMovement['kind'];
    limit?: number;
}

/** The counts of the active unit (or `unitId`, below it) and of the units directly under it. */
export function useStockSummary(unitId?: string) {
    return useQuery({
        queryKey: stockKeys.detail(unitId ?? 'active'),
        queryFn: async ({ signal }) =>
            (await client.get<StockSummary>('v1/plate-stock/summary', { params: { unitId }, signal })).data
    });
}

export function useStockMovements(query: MovementQuery = {}) {
    return useQuery({
        queryKey: stockKeys.list({ movements: query }),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: PlateMovement[]; nextCursor: string | null }>('v1/plate-stock/movements', {
                    params: query,
                    signal
                })
            ).data.items
    });
}

export function useStockBatches() {
    return useQuery({
        queryKey: stockKeys.list({ batches: true }),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: PlateBatch[] }>('v1/plate-stock/batches', { signal })).data.items
    });
}

export function useReceiveBatch() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: PlateBatchReceive) =>
            (await client.post<PlateBatch>('v1/plate-stock/batches', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stockKeys.all })
    });
}

export function useAllocatePlates() {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: PlateAllocation) =>
            (await client.post<PlateMovement>('v1/plate-stock/allocations', input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stockKeys.all })
    });
}

export function useAcceptAllocation(movementId: string) {
    const queries = useQueryClient();
    return useMutation({
        mutationFn: async (input: PlateAcceptance = {}) =>
            (await client.post<PlateMovement>(`v1/plate-stock/movements/${movementId}/acceptance`, input)).data,
        onSuccess: () => queries.invalidateQueries({ queryKey: stockKeys.all })
    });
}
