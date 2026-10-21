'use client';

import { useQuery } from '@tanstack/react-query';
import type { ServerAction } from '@itrms/schemas';

import { createKeys } from '../host/client';
import { useFormsClient } from '../host/FormsHost';

export type { ServerAction };

export const serverActionKeys = createKeys('server-actions');

/** The server actions a form can run on submit (coded work registered by modules, e.g. posting a transaction). */
export function useServerActions() {
    const client = useFormsClient();
    return useQuery({
        queryKey: serverActionKeys.all,
        queryFn: async ({ signal }) => (await client.get<ServerAction[]>('form/server-actions', { signal })).data,
        staleTime: 5 * 60_000
    });
}
