import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
    title: 'ITRMS',
    robots: { index: false, follow: false },
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' }
};

export const viewport: Viewport = { themeColor: '#0a6b35' };

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="am">
            <body>{children}</body>
        </html>
    );
}
