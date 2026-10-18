'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import client from '@platform/lib/api/client';
import type { ApiSchema } from '@platform/lib/api/types';
import { createKeys } from '@platform/lib/query/keys';

export type Account = ApiSchema<'AccountOut'>;
type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export const coreBankingKeys = createKeys('core-banking');

export interface ListParams {
    page: number;
    pageSize: number;
    status?: string;
    sort?: string;
}

/** Accounts of the core (simulated in this system), server-paged. */
export function useAccounts(p: ListParams) {
    return useQuery({
        queryKey: coreBankingKeys.list({ kind: 'accounts', ...p }),
        queryFn: async ({ signal }) =>
            (await client.get<Page<Account>>('core-banking/accounts', { params: { page: p.page, page_size: p.pageSize, status: p.status, sort: p.sort }, signal })).data,
        placeholderData: keepPreviousData
    });
}
