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
import { useLocale } from 'next-intl';
import { useAuthUser } from '@/lib/auth/authHooks';
import { useAuthStore } from '@/lib/auth/authStore';
import { formLanguages } from '@/lib/preferences';
import logger from '@/lib/logger';
import { ROLE_KEYS } from '@/shell/role-keys.generated';

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

function useLanguages(): { language: string; languages: readonly string[] } {
    const language = useLocale();
    const setting = useAuthStore((s) => s.workspace?.settings['i18n.languages']);
    return useMemo(() => ({ language, languages: formLanguages(setting) }), [language, setting]);
}

/**
 * The data source requests a form may name (the API's DATA_SOURCE_ALLOWLIST in platform/forms/contracts; the app does not
 * import a platform slice, so it states the same list). The builder warns about a source outside it.
 */
const DATA_SOURCE_ALLOWLIST: readonly { method: string; path: string }[] = [
    { method: 'GET', path: 'v1/registry-lookups/' }
];

const host: FormsHost = {
    client,
    useUser: useAuthUser,
    useLocation,
    useLanguages,
    roleKeys: ROLE_KEYS,
    dataSourceAllowList: DATA_SOURCE_ALLOWLIST,
    templatesHref: '/dynamic-template/saved-templates',
    isReported,
    logError: (message, error) => logger.error({ err: error }, message)
};

export function FormsHost({ children }: { children: ReactNode }) {
    return <FormsHostProvider host={host}>{children}</FormsHostProvider>;
}
