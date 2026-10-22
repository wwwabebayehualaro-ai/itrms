import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/shell/AppShell';
import { AuthGate } from '@/providers/auth/AuthGate';

interface AppLayoutProps {
    children: React.ReactNode;
}

export const viewport: Viewport = { initialScale: 1, width: 'device-width' };

export const metadata: Metadata = {
    // the product's name, the same in every language
    title: 'ITRMS',
    robots: { index: false, follow: false },
    icons: { icon: '/favicon.ico' }
};

export default function AppLayout({ children }: AppLayoutProps) {
    return (
        <AuthGate>
            <AppShell>{children}</AppShell>
        </AuthGate>
    );
}
