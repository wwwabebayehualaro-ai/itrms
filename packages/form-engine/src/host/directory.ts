'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { createKeys } from './client';
import { useFormsClient } from './FormsHost';

export interface DirectoryEntry {
    id: string;
    email: string;
    full_name: string | null;
}

/** Same key as the app's people picker, so both read one cache entry. */
export const directoryKeys = createKeys('directory');

/** The tenant's people (every role may read them), for names behind user ids. Cached: they are shown everywhere. */
export function useDirectory() {
    const client = useFormsClient();
    const query = useQuery({
        queryKey: directoryKeys.lists(),
        queryFn: async ({ signal }) =>
            (await client.get<DirectoryEntry[]>('auth/directory', { params: { limit: 500 }, signal })).data,
        staleTime: 5 * 60_000
    });
    const names = useMemo(() => new Map((query.data ?? []).map((u) => [u.id, u.full_name || u.email])), [query.data]);
    return { ...query, names };
}
