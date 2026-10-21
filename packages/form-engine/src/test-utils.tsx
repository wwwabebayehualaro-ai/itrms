/**
 * Test helpers of the engine's component tests: a host with a fake client (the app's client is never loaded), a fixed
 * signed-in person and an in-memory location, rendered inside the providers an app mounts.
 */
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { ServerErrorsProvider, TooltipProvider } from '@itrms/ui';

import { serverFormErrors, type FormsClient, type FormsRequestError, type FormsResponse } from './host/client';
import { FormsHostProvider, type FormsHost, type FormsLocation, type FormsUser } from './host/FormsHost';

export interface TestHostOptions {
    /** The calls a test answers (`get`, `post`, ...); a call nobody set up fails the test. */
    client?: Partial<FormsClient>;
    user?: FormsUser | null;
    location?: Partial<FormsLocation>;
}

const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected client.${name} call in a test`));

export function testHost({ client = {}, user = null, location = {} }: TestHostOptions = {}): FormsHost {
    const where: FormsLocation = {
        pathname: '/',
        search: new URLSearchParams(),
        params: {},
        push: vi.fn(),
        replace: vi.fn(),
        ...location
    };
    return {
        client: {
            request: unexpected('request'),
            get: unexpected('get'),
            post: unexpected('post'),
            put: unexpected('put'),
            patch: unexpected('patch'),
            delete: unexpected('delete'),
            ...client
        },
        useUser: () => user,
        useLocation: () => where,
        templatesHref: '/templates'
    };
}

/** A renderer bound to one host: `const renderWithQuery = hostRenderer({ client, user })`. */
export function hostRenderer(options: TestHostOptions = {}) {
    const host = testHost(options);
    return (ui: ReactElement) => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
        });
        return {
            host,
            queryClient,
            ...render(
                <QueryClientProvider client={queryClient}>
                    <FormsHostProvider host={host}>
                        <TooltipProvider>
                            <ServerErrorsProvider map={serverFormErrors}>{ui}</ServerErrorsProvider>
                        </TooltipProvider>
                    </FormsHostProvider>
                </QueryClientProvider>
            )
        };
    };
}

/** What the app's client throws for an answer outside 2xx. */
export function requestError(status: number, data: unknown): FormsRequestError {
    const response: FormsResponse = { status, headers: {}, data };
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isApiError: true as const,
        code: 'ERR_BAD_RESPONSE',
        response
    });
}
