import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { TooltipProvider } from '@platform/ui';

/** Render with a fresh QueryClient (no retries) and the providers the design system needs. */
export function renderWithQuery(ui: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
    return { client, ...render(<QueryClientProvider client={client}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>) };
}
