'use client';

import { useQuery } from '@tanstack/react-query';
import client from '@platform/lib/api/client';
import type { ApiSchema } from '@platform/lib/api/types';
import { createKeys } from '@platform/lib/query/keys';

export type ServerAction = ApiSchema<'ServerActionInfo'>;

export const serverActionKeys = createKeys('server-actions');

/** The server actions a form can run on submit (coded work registered by modules, e.g. posting a transaction). */
export function useServerActions() {
    return useQuery({
        queryKey: serverActionKeys.all,
        queryFn: async ({ signal }) => (await client.get<ServerAction[]>('form/server-actions', { signal })).data,
        staleTime: 5 * 60_000
    });
}
