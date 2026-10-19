'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import client from '@/lib/api/client';
import { createKeys } from '@/lib/query/keys';

export interface DirectoryEntry {
    id: string;
    email: string;
    full_name: string | null;
}

export const directoryKeys = createKeys('directory');

/** The tenant's people picker (every role may read it). Cached: names behind user ids are shown all over the app. */
export function useDirectory() {
    const query = useQuery({
        queryKey: directoryKeys.lists(),
        queryFn: async ({ signal }) =>
            (await client.get<DirectoryEntry[]>('auth/directory', { params: { limit: 500 }, signal })).data,
        staleTime: 5 * 60_000
    });
    const names = useMemo(() => new Map((query.data ?? []).map((u) => [u.id, u.full_name || u.email])), [query.data]);
    return { ...query, names };
}
