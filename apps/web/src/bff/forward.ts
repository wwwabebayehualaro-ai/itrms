/**
 * What the `/api/*` proxy passes on (ADR-0021). Allow-lists both ways: the API gets the bearer token, the active unit
 * and the headers it uses, never the browser's cookies; the browser gets the API's answer, never a cookie from it.
 */

/** Request headers the API reads. Cookies, Authorization and X-Org-Unit from the browser are never among them. */
const REQUEST_HEADERS = [
    'accept',
    'accept-language',
    'content-type',
    'if-match',
    'if-none-match',
    'idempotency-key',
    // Nginx's record of the client's address; the API believes it only from its TRUSTED_PROXIES (Nginx and the BFF)
    'x-forwarded-for'
] as const;

/** Response headers the browser may see. */
const RESPONSE_HEADERS = [
    'cache-control',
    'content-disposition',
    'content-language',
    'content-type',
    'etag',
    'last-modified',
    'link',
    'location',
    'retry-after',
    'sunset',
    'deprecation',
    'www-authenticate',
    'x-request-id'
] as const;

export function apiRequestHeaders(
    incoming: Headers,
    accessToken: string,
    activeUnit: string | undefined,
    requestId: string
): Headers {
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
        const value = incoming.get(name);
        if (value !== null) headers.set(name, value);
    }
    headers.set('authorization', `Bearer ${accessToken}`);
    if (activeUnit) headers.set('x-org-unit', activeUnit);
    headers.set('x-request-id', requestId);
    return headers;
}

export function browserResponseHeaders(fromApi: Headers): Headers {
    const headers = new Headers();
    for (const name of RESPONSE_HEADERS) {
        const value = fromApi.get(name);
        if (value !== null) headers.set(name, value);
    }
    // an API answer may name a person or a record: never kept by the browser or a proxy (SEC-WB-4)
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
    return headers;
}

/**
 * The API URL for a proxied path, or undefined when the path is not one the proxy serves: only versioned API paths,
 * plain segments (no dot segments, no encoded slashes), so a crafted path can't reach another route of the API.
 */
export function apiTarget(apiUrl: string, segments: readonly string[], search: string): string | undefined {
    if (!/^v\d+$/.test(segments[0] ?? '')) return undefined;
    if (segments.some((s) => s === '' || s === '.' || s === '..' || /[/\\]/.test(s))) return undefined;
    return `${apiUrl}/api/${segments.map(encodeURIComponent).join('/')}${search}`;
}
