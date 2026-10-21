/**
 * CSRF on every state-changing BFF route (security.md SEC-SE-6, ADR-0033): SameSite=Lax on the session cookie, the
 * request's Origin must be the app's own, and the double-submit token must match the session's.
 */
import { timingSafeEqual } from 'node:crypto';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isSafeMethod = (method: string) => SAFE.has(method.toUpperCase());

/**
 * The request comes from the app's own pages: its Origin is the app's, or (a browser that sends no Origin on a
 * same-origin request) Sec-Fetch-Site says so. Anything else, and no header at all, is refused.
 */
export function sameOrigin(headers: Headers, appOrigin: string): boolean {
    const origin = headers.get('origin');
    if (origin !== null) return origin === appOrigin;
    return headers.get('sec-fetch-site') === 'same-origin';
}

export function tokenMatches(sent: string | null | undefined, expected: string): boolean {
    if (!sent) return false;
    const a = Buffer.from(sent);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
