'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/auth/authStore';
import { session } from '@/lib/auth/session';
import { languageToShow, setLanguageCookie, usePreferences } from '@/lib/preferences';
import { Spinner } from '@itrms/ui';

/**
 * Wrap protected areas. The server has already sent visitors without a session to sign-in (proxy.ts, the layout); this
 * loads who is signed in, and a session that ended meanwhile goes back to sign-in.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
    const { status, hydrate } = useAuthStore();
    const preferences = useAuthStore((s) => s.workspace?.preferences);
    const languages = useAuthStore((s) => s.workspace?.settings['i18n.languages']);
    const locale = useLocale();
    const router = useRouter();

    useEffect(() => {
        if (status === 'loading') void hydrate();
        if (status === 'anonymous') session.signIn();
    }, [status, hydrate]);

    // the person's preferences, saved on the server: this PC shows them too (the language by rendering again in it).
    // Applied once per workspace loaded: a language chosen on this page since then is the newer one. Only a language the
    // shell has a catalogue for and the region offers: this browser's language from another account's choice is put right.
    const applied = useRef<unknown>(undefined);
    useEffect(() => {
        if (!preferences || applied.current === preferences) return;
        applied.current = preferences;
        usePreferences.getState().load(preferences);
        const language = languageToShow(locale, preferences.language, languages);
        if (language !== locale) {
            setLanguageCookie(language);
            router.refresh();
        }
    }, [preferences, languages, locale, router]);

    if (status !== 'authenticated') {
        return (
            <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
                <Spinner className="size-8 text-muted-foreground" />
            </div>
        );
    }
    return <>{children}</>;
}
