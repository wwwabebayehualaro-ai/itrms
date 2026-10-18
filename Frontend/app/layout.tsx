'use client';
import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import './globals.css';
import { NotifyProvider, QueryProvider, TooltipProvider } from '@platform/ui';

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
                            {/* light / dark: the `dark` class on <html> (design system tokens in globals.css) */}
                            <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
                                {children}
                            </ThemeProvider>
                        </TooltipProvider>
                    </QueryProvider>
                </NotifyProvider>
            </body>
        </html>
    );
}
