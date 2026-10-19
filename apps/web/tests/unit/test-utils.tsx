import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ServerErrorsProvider, TooltipProvider } from '@itrms/ui';
import { serverFormErrors } from '@/lib/forms/serverErrors';

/** Render with a fresh QueryClient (no retries) and the providers the app mounts in its root layout. */
export function renderWithQuery(
    ui: React.ReactElement,
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
) {
    return {
        client,
        ...render(
            <QueryClientProvider client={client}>
                <TooltipProvider>
                    <ServerErrorsProvider map={serverFormErrors}>{ui}</ServerErrorsProvider>
                </TooltipProvider>
            </QueryClientProvider>
        )
    };
}
