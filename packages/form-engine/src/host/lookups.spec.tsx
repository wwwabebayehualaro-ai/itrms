import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { testHost } from '../test-utils';
import { FormsHostProvider } from './FormsHost';
import { useLookupLabels } from './lookups';

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('useLookupLabels', () => {
    it('asks in chunks of 50 ids so every record of a page gets its label', async () => {
        const all = Array.from({ length: 120 }, (_, i) => idOf(i + 1));
        const get = vi.fn((_url: string, options?: { params?: { ids?: string } }) => {
            const ids = (options?.params?.ids ?? '').split(',');
            return Promise.resolve({
                data: { items: ids.map((id) => ({ id, label: `L-${id}`, active: true, facts: [] })) },
                status: 200,
                headers: {}
            });
        });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <FormsHostProvider host={testHost({ client: { get: get as never } })}>{children}</FormsHostProvider>
            </QueryClientProvider>
        );
        const { result } = renderHook(() => useLookupLabels(new Map([['person', all]])), { wrapper });
        await waitFor(() => expect(result.current.get('person')?.size).toBe(120));
        expect(get).toHaveBeenCalledTimes(3);
        for (const [, options] of get.mock.calls)
            expect((options?.params?.ids ?? '').split(',').length).toBeLessThanOrEqual(50);
    });
});
