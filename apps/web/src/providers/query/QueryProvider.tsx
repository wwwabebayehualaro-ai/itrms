'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, isServer } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/http';
import { getApiErrorMessage, markReported } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { useNotify } from '@itrms/ui';

declare module '@tanstack/react-query' {
    interface Register {
        queryMeta: {
            /** Do not toast when a background refetch of this query fails. */ silent?: boolean;
            errorMessage?: string;
        };
        mutationMeta: {
            /** Suppress the platform's error toast (the caller shows its own). */ silent?: boolean;
            errorMessage?: string;
            successMessage?: string;
        };
    }
}

const Devtools = dynamic(() => import('@tanstack/react-query-devtools').then((m) => m.ReactQueryDevtools), {
    ssr: false
});

const status = (error: unknown) => (isApiError(error) ? error.response?.status : undefined);

/** Client errors (4xx) will not fix themselves; network/5xx/429 are worth a couple of retries with backoff. */
export const shouldRetry = (failureCount: number, error: unknown) => {
    const s = status(error);
    if (s && s >= 400 && s < 500 && s !== 429 && s !== 408) return false;
    return failureCount < 2;
};

type Notifier = Pick<ReturnType<typeof useNotify>, 'error' | 'success'>;

export function createQueryClient(notify: Notifier): QueryClient {
    return new QueryClient({
        queryCache: new QueryCache({
            // Initial-load failures belong to the screen's own error state; only surface failed *background* refetches.
            onError: (error, query) => {
                if (query.meta?.silent || query.state.data === undefined || status(error) === 401) return;
                notify.error(query.meta?.errorMessage ?? getApiErrorMessage(error), 'Could not refresh data');
            }
        }),
        mutationCache: new MutationCache({
            onError: (error, _v, _c, mutation) => {
                if (mutation.meta?.silent || status(error) === 401) return; // 401 is handled by the client (refresh or sign-in)
                notify.error(mutation.meta?.errorMessage ?? getApiErrorMessage(error));
                markReported(error);
            },
            onSuccess: (_d, _v, _c, mutation) => {
                if (mutation.meta?.successMessage) notify.success(mutation.meta.successMessage);
            }
        }),
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                gcTime: 5 * 60_000,
                refetchOnWindowFocus: false,
                retry: shouldRetry,
                retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000)
            },
            mutations: { retry: false }
        }
    });
}

let browserClient: QueryClient | undefined;

/**
 * The app's single QueryClient (mount once, inside NotifyProvider). Besides sensible defaults and one place that
 * reports failures, it guarantees cached server data never outlives the signed-in user: the cache is dropped on
 * sign-out and whenever the user changes, so one tenant's data can never be shown to another.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
    const notify = useNotify();
    const [client] = useState(() => {
        if (isServer) return createQueryClient(notify);
        return (browserClient ??= createQueryClient(notify));
    });

    useEffect(() => {
        return useAuthStore.subscribe((state, prev) => {
            if (state.user?.id !== prev.user?.id) client.clear();
        });
    }, [client]);

    return (
        <QueryClientProvider client={client}>
            {children}
            {process.env.NODE_ENV === 'development' && <Devtools initialIsOpen={false} buttonPosition="bottom-left" />}
        </QueryClientProvider>
    );
}
