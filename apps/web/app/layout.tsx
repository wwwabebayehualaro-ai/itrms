import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './globals.css';
import { Providers } from './providers';

/**
 * Every page renders per request: Next puts the request's CSP nonce (set by proxy.ts) on its own scripts only then, and a
 * page prerendered at build time would carry none and be blocked by the policy (security.md SEC-WB-1). The page's
 * language is the person's (src/i18n/request.ts): the Ethiopic typography keys on :lang(am), screen readers pick their
 * voice from it.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const nonce = (await headers()).get('x-nonce') ?? undefined;
    const locale = await getLocale();
    return (
        <html lang={locale} suppressHydrationWarning>
            <body>
                <NextIntlClientProvider>
                    <Providers nonce={nonce}>{children}</Providers>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
