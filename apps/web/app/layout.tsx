'use client';
import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import './globals.css';
import { NotifyProvider, ServerErrorsProvider, TooltipProvider } from '@itrms/ui';
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
                <NotifyProvider>
                    <QueryProvider>
                        <TooltipProvider>
                            {/* hand-written forms map the API's problem+json errors onto their fields */}
                            <ServerErrorsProvider map={serverFormErrors}>
                                {/* light / dark: the `dark` class on <html> (design system tokens in globals.css) */}
                                <ThemeProvider
                                    attribute="class"
                                    defaultTheme="light"
                                    enableSystem
                                    disableTransitionOnChange
                                >
                                    {children}
                                </ThemeProvider>
                            </ServerErrorsProvider>
                        </TooltipProvider>
                    </QueryProvider>
                </NotifyProvider>
            </body>
        </html>
    );
}
