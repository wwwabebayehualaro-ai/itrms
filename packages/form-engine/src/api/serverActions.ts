'use client';

import { useQuery } from '@tanstack/react-query';
import type { ServerAction } from '@itrms/schemas';

import { createKeys } from '../host/client';

export type { ServerAction };

export const serverActionKeys = createKeys('server-actions');

/**
 * The server actions a form can run on submit (coded work registered by modules). The forms API has none yet: a form's
 * coded work comes as module effects named by its service's configuration (task 0.21), so the designer offers none.
 */
export function useServerActions() {
    return useQuery({
        queryKey: serverActionKeys.all,
        queryFn: (): ServerAction[] => [],
        staleTime: Infinity
    });
}
