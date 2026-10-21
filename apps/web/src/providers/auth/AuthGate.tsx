'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/lib/auth/authStore';
import { session } from '@/lib/auth/session';
import { Spinner } from '@itrms/ui';

/**
 * Wrap protected areas. The server has already sent visitors without a session to sign-in (proxy.ts, the layout); this
 * loads who is signed in, and a session that ended meanwhile goes back to sign-in.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
    const { status, hydrate } = useAuthStore();

    useEffect(() => {
        if (status === 'loading') void hydrate();
        if (status === 'anonymous') session.signIn();
    }, [status, hydrate]);

    if (status !== 'authenticated') {
        return (
            <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
                <Spinner className="size-8 text-muted-foreground" />
            </div>
        );
    }
    return <>{children}</>;
}
