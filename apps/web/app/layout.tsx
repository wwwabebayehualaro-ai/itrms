'use client';
import { useEffect } from 'react';
import './globals.css';
import { AppearanceProvider, NotifyProvider, ServerErrorsProvider, TooltipProvider } from '@itrms/ui';
import { serverFormErrors } from '@/lib/forms/serverErrors';
import { QueryProvider } from '@/providers/query/QueryProvider';

interface RootLayoutProps {
    children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
    // Remove extension-added attributes after hydration
    useEffect(() => {
        document.body.removeAttribute('data-new-gr-c-s-check-loaded');
        document.body.removeAttribute('data-gr-ext-installed');
    }, []);

    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                {/* Outermost: theme class and data-density on <html> (ADR-0029), and the toaster in NotifyProvider reads the theme. */}
                <AppearanceProvider>
                    <NotifyProvider>
                        <QueryProvider>
                            <TooltipProvider>
                                {/* hand-written forms map the API's problem+json errors onto their fields */}
                                <ServerErrorsProvider map={serverFormErrors}>{children}</ServerErrorsProvider>
                            </TooltipProvider>
                        </QueryProvider>
                    </NotifyProvider>
                </AppearanceProvider>
            </body>
        </html>
    );
}
