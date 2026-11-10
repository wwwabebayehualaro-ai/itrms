'use client';

/**
 * The vehicle register (tasks 1.1a, 1.1b; `@itrms/vehicles`): read through the BFF. Every office of the region finds a vehicle
 * by its plate (current or old), chassis, engine or federal id; changes are made by the cases of later tasks, not here.
 */
import { useQuery } from '@tanstack/react-query';
import type { Vehicle, VehicleSummary, vehicleListSchema } from '@itrms/vehicles/contracts';
import type { z } from 'zod';

import client from './api/client';
import { createKeys } from './query/keys';

export type { Vehicle, VehicleSummary };
type VehicleList = z.infer<typeof vehicleListSchema>;

export const vehicleKeys = createKeys('vehicles');

/** Vehicles whose plate, chassis, engine or federal id matches `q`; nothing until two characters are typed. */
export function useVehicleSearch(q: string) {
    const query = q.trim();
    return useQuery({
        queryKey: vehicleKeys.list({ q: query }),
        enabled: query.length >= 2,
        queryFn: async ({ signal }) =>
            (await client.get<VehicleList>('v1/vehicles', { params: { q: query, limit: 20 }, signal })).data.items
    });
}

export function useVehicle(id: string) {
    return useQuery({
        queryKey: vehicleKeys.detail(id),
        queryFn: async ({ signal }) => (await client.get<Vehicle>(`v1/vehicles/${id}`, { signal })).data
    });
}
