'use client';

/**
 * What the engine takes from the app that hosts it: the HTTP client, the signed-in person, the page's location and a few
 * links. The app builds one `FormsHost` at module scope (its hooks never change) and wraps its screens in
 * `<FormsHostProvider host={...}>`. Nothing in core/ uses this: core runs in the API too.
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { FormsClient } from './client';

/** The signed-in person as templates see it (`{{user.*}}`, `user.role` conditions) and as the engine checks rights. */
export interface FormsUser {
    id?: string;
    email?: string;
    full_name?: string | null;
    roles?: string[];
    /** Effective "resource:action" permissions: hints for hiding UI; the server decides. */
    permissions?: string[];
    tenant_id?: string;
}

export interface FormsLocation {
    pathname: string;
    search: URLSearchParams;
    /** Route parameters of the page (`/forms/[templateId]` → `{ templateId }`). */
    params: Record<string, string | string[] | undefined>;
    push: (href: string) => void;
    /** Changes the URL without a new history entry or a scroll. */
    replace: (href: string) => void;
}

export interface FormsHost {
    client: FormsClient;
    /** A hook: the signed-in person, or null. */
    useUser: () => FormsUser | null;
    /** A hook: the page's location (the data viewer keeps its state in the URL; templates read route values). */
    useLocation: () => FormsLocation;
    /** Where the builder goes back to (the template gallery). */
    templatesHref: string;
    /** True for an error the app has already shown (its mutation toast), so the engine does not say it twice. */
    isReported?: (error: unknown) => boolean;
    /** Where the engine reports a failure it handled. */
    logError?: (message: string, error: unknown) => void;
    /** The installation's role keys: what a field's "Only for roles" may name. */
    roleKeys?: readonly string[];
    /**
     * A hook: the language the screens are shown in and the installation's languages (Amharic and English first): forms
     * are drawn in it, and the builder translates into them. Without it: the page's language, Amharic and English.
     */
    useLanguages?: () => FormsLanguages;
}

export interface FormsLanguages {
    language: string;
    languages: readonly string[];
}

const pageLanguage = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'am';
const DEFAULT_LANGUAGES = ['am', 'en'] as const;
const noLanguages = (): FormsLanguages => ({ language: pageLanguage(), languages: DEFAULT_LANGUAGES });

const HostContext = createContext<FormsHost | null>(null);

export function FormsHostProvider({ host, children }: { host: FormsHost; children: ReactNode }) {
    return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useFormsHost(): FormsHost {
    const host = useContext(HostContext);
    if (!host) throw new Error('The form engine needs a <FormsHostProvider> around it.');
    return host;
}

export const useFormsClient = () => useFormsHost().client;

/** The language forms are drawn in, and the installation's languages. */
export function useFormsLanguages(): FormsLanguages {
    const { useLanguages = noLanguages } = useFormsHost();
    return useLanguages();
}

/** The language the screens are shown in, also outside a host (a field drawn on its own: the page's language). */
export function useScreenLanguage(): string {
    const host = useContext(HostContext);
    const { useLanguages = noLanguages } = host ?? {};
    return useLanguages().language;
}

export function useFormsUser(): FormsUser | null {
    const { useUser } = useFormsHost();
    return useUser();
}

/** Client-side hint for hiding UI the person may not use ("submission:delete"); the server remains the authority. */
export function useCan(permission: string): boolean {
    return !!useFormsUser()?.permissions?.includes(permission);
}

export function useFormsLocation(): FormsLocation {
    const { useLocation } = useFormsHost();
    return useLocation();
}
