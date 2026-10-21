'use client';

/**
 * The form engine's host (task 0.5): the engine gets the app's HTTP client (authentication, Idempotency-Keys, sign-in
 * redirect), the signed-in person and the Next.js location from here, and imports nothing of the app itself.
 */
import { useMemo, type ReactNode } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormsHostProvider, type FormsHost, type FormsLocation } from '@itrms/form-engine/renderer';
import client from '@/lib/api/client';
import { isReported } from '@/lib/api/errors';
import { useAuthUser } from '@/lib/auth/authHooks';
import logger from '@/lib/logger';

function useLocation(): FormsLocation {
    const router = useRouter();
    const pathname = usePathname();
    const search = useSearchParams();
    const params = useParams();
    return useMemo(
        () => ({
            pathname,
            search,
            params: params ?? {},
            push: (href) => router.push(href),
            replace: (href) => router.replace(href, { scroll: false })
        }),
        [router, pathname, search, params]
    );
}

const host: FormsHost = {
    client,
    useUser: useAuthUser,
    useLocation,
    templatesHref: '/dynamic-template/saved-templates',
    isReported,
    logError: (message, error) => logger.error({ err: error }, message)
};

export function FormsHost({ children }: { children: ReactNode }) {
    return <FormsHostProvider host={host}>{children}</FormsHostProvider>;
}
