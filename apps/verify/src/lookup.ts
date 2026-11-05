/** Asking the API about a token, and what its answer can mean on this page (ADR-0045). */
import type { VerificationOut } from '@itrms/documents/contracts';

export type Lookup =
    | { state: 'loading' }
    | { state: 'found'; document: VerificationOut }
    | { state: 'unknown' }
    | { state: 'busy' }
    | { state: 'offline' }
    | { state: 'noCode' };

// the contracts' VERIFICATION_TOKEN and statuses: this public page carries no validation library
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const STATUSES = new Set<string>(['valid', 'expired', 'revoked', 'superseded']);
const TIMEOUT_MS = 20_000;

/** The token in the address, or nothing. */
export const tokenFromPath = (pathname: string): string | null => {
    const token = pathname.replace(/^\/+|\/+$/g, '');
    return TOKEN.test(token) ? token : null;
};

/** What the API says of a token, as this page can show it. */
export async function lookUp(token: string, fetcher: typeof fetch = fetch): Promise<Lookup> {
    try {
        const response = await fetcher(`/v1/public/verifications/${token}`, {
            headers: { accept: 'application/json' },
            // a stalled connection reaches "try again" too, on the links this page is made for
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (response.status === 404) return { state: 'unknown' };
        if (response.status === 429) return { state: 'busy' };
        if (!response.ok) return { state: 'offline' };
        const document = (await response.json()) as VerificationOut;
        return STATUSES.has(document.status) ? { state: 'found', document } : { state: 'offline' };
    } catch {
        return { state: 'offline' };
    }
}

/** What the page's address says: the bare address asks to scan, and one with no token is not asked about. */
export const lookUpAddress = async (pathname: string, fetcher?: typeof fetch): Promise<Lookup> => {
    if (pathname.replace(/\/+/g, '') === '') return { state: 'noCode' };
    const token = tokenFromPath(pathname);
    return token ? lookUp(token, fetcher) : { state: 'unknown' };
};
