import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ServerErrorsProvider, TooltipProvider } from '@itrms/ui';
import { messagesFor } from '@/i18n/messages';
import { serverFormErrors } from '@/lib/forms/serverErrors';

/**
 * Render with a fresh QueryClient (no retries) and the providers the app mounts in its root layout. The screens read their
 * words from the catalogues: these tests render in English.
 */
export function renderWithQuery(
    ui: React.ReactElement,
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
) {
    return {
        client,
        ...render(
            <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="Africa/Addis_Ababa">
                <QueryClientProvider client={client}>
                    <TooltipProvider>
                        <ServerErrorsProvider map={serverFormErrors}>{ui}</ServerErrorsProvider>
                    </TooltipProvider>
                </QueryClientProvider>
            </NextIntlClientProvider>
        )
    };
}
