import type { Metadata, Viewport } from 'next';
import { AppShell } from '../../layout/AppShell';
import { AuthGate } from '@platform/ui';

interface AppLayoutProps {
    children: React.ReactNode;
}

export const viewport: Viewport = { initialScale: 1, width: 'device-width' };

export const metadata: Metadata = {
    title: 'Digital File Cabinet',
    description: 'Build forms, collect requests and track them in one place.',
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
