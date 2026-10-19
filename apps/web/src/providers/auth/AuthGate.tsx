'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth/authStore';
import { Spinner } from '@itrms/ui';

/** Wrap protected areas: restores the session, and sends anonymous visitors to the login page. */
export function AuthGate({ children }: { children: React.ReactNode }) {
    const { status, hydrate } = useAuthStore();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (status === 'loading') void hydrate();
        if (status === 'anonymous') router.replace(`/auth/login?next=${encodeURIComponent(pathname)}`);
    }, [status, hydrate, router, pathname]);

    if (status !== 'authenticated') {
        return (
            <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
                <Spinner className="size-8 text-muted-foreground" />
            </div>
        );
    }
    return <>{children}</>;
}
