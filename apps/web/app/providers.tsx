'use client';
import { useEffect } from 'react';
import { AppearanceProvider, NotifyProvider, ServerErrorsProvider, TooltipProvider } from '@itrms/ui';
import { serverFormErrors } from '@/lib/forms/serverErrors';
import { FormsHost } from '@/providers/forms/FormsHost';
import { QueryProvider } from '@/providers/query/QueryProvider';

interface ProvidersProps {
    /** The request's CSP nonce, for the pre-paint theme and density scripts (SEC-WB-7). */
    nonce?: string;
    children: React.ReactNode;
}

export function Providers({ nonce, children }: ProvidersProps) {
    // Remove extension-added attributes after hydration
    useEffect(() => {
        document.body.removeAttribute('data-new-gr-c-s-check-loaded');
        document.body.removeAttribute('data-gr-ext-installed');
    }, []);

    return (
        // Outermost: theme class and data-density on <html> (ADR-0029), and the toaster in NotifyProvider reads the theme.
        <AppearanceProvider nonce={nonce}>
            <NotifyProvider>
                <QueryProvider>
                    <TooltipProvider>
                        {/* hand-written forms map the API's problem+json errors onto their fields */}
                        <ServerErrorsProvider map={serverFormErrors}>
                            {/* the form engine reaches the API only through the app (its client, its session) */}
                            <FormsHost>{children}</FormsHost>
                        </ServerErrorsProvider>
                    </TooltipProvider>
                </QueryProvider>
            </NotifyProvider>
        </AppearanceProvider>
    );
}
