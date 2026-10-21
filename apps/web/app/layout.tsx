import { headers } from 'next/headers';
import './globals.css';
import { Providers } from './providers';

/**
 * Every page renders per request: Next puts the request's CSP nonce (set by proxy.ts) on its own scripts only then, and a
 * page prerendered at build time would carry none and be blocked by the policy (security.md SEC-WB-1).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const nonce = (await headers()).get('x-nonce') ?? undefined;
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <Providers nonce={nonce}>{children}</Providers>
            </body>
        </html>
    );
}
