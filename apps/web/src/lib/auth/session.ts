/**
 * The browser's side of the BFF session (ADR-0021, security.md §5). The session itself is the HttpOnly `__Host-itrms_sid`
 * cookie, which no script can read: this module knows only the CSRF token (a readable cookie, sent back in a header or a
 * form field) and how to leave for sign-in and sign-out. No token ever reaches it.
 */
import { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER } from './cookies';

function readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    for (const part of document.cookie.split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return decodeURIComponent(value.join('='));
    }
    return null;
}

/** The path to come back to: this page, unless it is a sign-in page itself. */
function here(): string {
    const { pathname, search } = window.location;
    return pathname.startsWith('/auth/') ? '/' : pathname + search;
}

export const session = {
    csrfToken: () => readCookie(CSRF_COOKIE),

    /** Off to Keycloak through the BFF; `maxAge` asks for factors entered no longer ago than that (step-up). */
    signIn(maxAge?: number) {
        const query = new URLSearchParams({ return_to: here() });
        if (maxAge !== undefined) query.set('max_age', String(maxAge));
        // a full navigation, not the router: /auth/sign-in is a BFF route handler that redirects to Keycloak
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/auth/sign-in?${query.toString()}`);
    },

    /** Asks the BFF to act for another unit; the answer is the workspace there. Throws when refused (no role there). */
    async switchUnit<T>(unitId: string): Promise<T> {
        const response = await fetch('/auth/unit', {
            method: 'POST',
            headers: { 'content-type': 'application/json', [CSRF_HEADER]: session.csrfToken() ?? '' },
            body: JSON.stringify({ unitId })
        });
        if (!response.ok) throw new Error(`unit switch refused (${response.status})`);
        return (await response.json()) as T;
    },

    /**
     * A real form post (the CSRF token in a field): the BFF ends its session and the Keycloak session, and the browser
     * follows the redirects back to sign-in.
     */
    signOut() {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/auth/sign-out';
        const csrf = document.createElement('input');
        csrf.type = 'hidden';
        csrf.name = CSRF_FIELD;
        csrf.value = session.csrfToken() ?? '';
        form.append(csrf);
        document.body.append(form);
        form.submit();
    }
};
