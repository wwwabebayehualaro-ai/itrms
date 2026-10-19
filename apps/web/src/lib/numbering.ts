'use client';

/** Document number sequences of the tenant (backend: `foundation/numbering`); numbers themselves are issued by the server. */
import { useQuery } from '@tanstack/react-query';
import client from './api/client';
import type { ApiSchema } from './api/types';
import { createKeys } from './query/keys';

export type NumberSequence = ApiSchema<'SequenceOut'>;
export const sequenceKeys = createKeys('sequences');

/** Admin (`sequence:read`): every sequence with its pattern, period and the next number. */
export function useSequences() {
    return useQuery({
        queryKey: sequenceKeys.list(),
        queryFn: async ({ signal }) => (await client.get<NumberSequence[]>('platform/sequences', { signal })).data
    });
}
