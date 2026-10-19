import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, createHttpClient, isApiError, joinUrl, type TokenSession } from '@/lib/api/http';

/** A session like the real one: refresh() stores and returns a new access token. */
function fakeSession(hasRefresh = true): TokenSession & { cleared: number } {
    let token: string | null = 'old-token';
    return {
        cleared: 0,
        getAccessToken: () => token,
        hasRefreshToken: () => hasRefresh,
        refresh: () => Promise.resolve((token = 'new-token')),
        clear() {
            this.cleared++;
            token = null;
        }
    };
}

/** Fake transport: records each request; the first answers 401 when `expireFirst` is set. */
function transport(opts: { expireFirst?: boolean; respond?: () => Response } = {}) {
    const seen: Request[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        seen.push(req);
        if (opts.expireFirst && seen.length === 1) return new Response(null, { status: 401 });
        return opts.respond?.() ?? Response.json({ ok: true });
    });
    return { seen, fetch: fetch as unknown as typeof globalThis.fetch };
}

const make = (t: ReturnType<typeof transport>, session = fakeSession(), onUnauthenticated = vi.fn()) => ({
    http: createHttpClient({ baseUrl: 'http://api.test/v1/', session, fetch: t.fetch, onUnauthenticated }),
    session,
    onUnauthenticated
});
const key = (r: Request) => r.headers.get('idempotency-key');

describe('HTTP client: idempotency', () => {
    it('sends a fresh Idempotency-Key on each POST, none on GET', async () => {
        const t = transport();
        const { http } = make(t);
        await http.post('x', {});
        await http.post('x', {});
        await http.get('x');
        expect(key(t.seen[0])).toBeTruthy();
        expect(key(t.seen[1])).not.toBe(key(t.seen[0]));
        expect(key(t.seen[2])).toBeNull();
    });

    it('keeps the key when it retries after refreshing an expired token', async () => {
        const t = transport({ expireFirst: true });
        const { http } = make(t);
        await http.post('x', { a: 1 });
        expect(t.seen).toHaveLength(2);
        expect(key(t.seen[1])).toBe(key(t.seen[0]));
        expect(t.seen[0].headers.get('authorization')).toBe('Bearer old-token');
        expect(t.seen[1].headers.get('authorization')).toBe('Bearer new-token');
        expect(await t.seen[1].json()).toEqual({ a: 1 }); // the body is sent again in full
    });

    it('makes a random UUID v4 key even where crypto.randomUUID is missing (plain-HTTP pages)', async () => {
        const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
        Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
        try {
            const t = transport();
            await make(t).http.post('x', {});
            await make(t).http.post('x', {});
            expect(key(t.seen[0])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(key(t.seen[1])).not.toBe(key(t.seen[0]));
        } finally {
            if (original) Object.defineProperty(crypto, 'randomUUID', original);
            else delete (crypto as { randomUUID?: unknown }).randomUUID;
        }
    });

    it('respects a key the caller chose', async () => {
        const t = transport();
        const { http } = make(t);
        await http.post('x', {}, { headers: { 'Idempotency-Key': 'mine' } });
        expect(key(t.seen[0])).toBe('mine');
    });
});

describe('HTTP client: authorisation', () => {
    it('sends no token, never refreshes and never redirects for skipAuth calls', async () => {
        const t = transport({ respond: () => new Response(null, { status: 401 }) });
        const { http, session, onUnauthenticated } = make(t);
        await expect(http.get('public', { skipAuth: true })).rejects.toMatchObject({ response: { status: 401 } });
        expect(t.seen).toHaveLength(1);
        expect(t.seen[0].headers.get('authorization')).toBeNull();
        expect(session.cleared).toBe(0);
        expect(onUnauthenticated).not.toHaveBeenCalled();
    });

    it('clears the session and asks for sign-in when the call is still unauthorised after the refresh', async () => {
        const t = transport({ respond: () => new Response(null, { status: 401 }) });
        const { http, session, onUnauthenticated } = make(t);
        await expect(http.get('x')).rejects.toBeInstanceOf(ApiError);
        expect(t.seen).toHaveLength(2); // the original and one retry, never more
        expect(session.cleared).toBe(1);
        expect(onUnauthenticated).toHaveBeenCalledOnce();
    });

    it('asks for sign-in at once when there is no refresh token', async () => {
        const t = transport({ respond: () => new Response(null, { status: 401 }) });
        const { http, onUnauthenticated } = make(t, fakeSession(false));
        await expect(http.get('x')).rejects.toBeInstanceOf(ApiError);
        expect(t.seen).toHaveLength(1);
        expect(onUnauthenticated).toHaveBeenCalledOnce();
    });
});

describe('HTTP client: requests and responses', () => {
    it('joins the base URL, encodes parameters and skips empty ones', async () => {
        const t = transport();
        await make(t).http.get('/forms', { params: { q: 'ሰላም', page: 2, missing: undefined, none: null } });
        expect(t.seen[0].url).toBe('http://api.test/v1/forms?q=%E1%88%B0%E1%88%8B%E1%88%9D&page=2');
        expect(joinUrl('http://a/b', 'https://other/x')).toBe('https://other/x');
    });

    it('sends arrays as repeated keys and dates as ISO strings, and rejects nested objects', async () => {
        const t = transport();
        const { http } = make(t);
        await http.get('x', { params: { s: ['a', 'b'], at: new Date(Date.UTC(2026, 9, 19)) } });
        expect(t.seen[0].url).toBe('http://api.test/v1/x?s=a&s=b&at=2026-10-19T00%3A00%3A00.000Z');
        await expect(http.get('x', { params: { f: { a: 1 } } })).rejects.toBeInstanceOf(TypeError);
        expect(t.seen).toHaveLength(1);
    });

    it('encodes a plain object as the form a data source asks for', async () => {
        const t = transport();
        const { http } = make(t);
        const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
        await http.post('x', { a: 1, b: ['x', 'y'], none: null }, { headers: form });
        expect(t.seen[0].headers.get('content-type')).toMatch(/^application\/x-www-form-urlencoded/);
        expect(await t.seen[0].text()).toBe('a=1&b=x&b=y');

        await http.post(
            'x',
            { name: 'ሰላም', file: new Blob(['%PDF']) },
            { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        expect(t.seen[1].headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
        const parts = await t.seen[1].formData();
        expect(parts.get('name')).toBe('ሰላም');
        expect(await (parts.get('file') as Blob).text()).toBe('%PDF');
    });

    it('throws a body it cannot encode as itself, before sending anything', async () => {
        const t = transport();
        const err: unknown = await make(t)
            .http.post('x', { n: 1n })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(TypeError);
        expect(isApiError(err)).toBe(false);
        expect(t.seen).toHaveLength(0);
    });

    it('combines the timeout and the caller signal without AbortSignal.any (older browsers)', async () => {
        const never: typeof fetch = (_input, init) =>
            new Promise((_resolve, reject) =>
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            );
        const http = createHttpClient({ session: fakeSession(), fetch: never });
        const { any, timeout } = AbortSignal;
        Object.assign(AbortSignal, { any: undefined, timeout: undefined });
        try {
            await expect(http.get('x', { timeout: 20, signal: new AbortController().signal })).rejects.toMatchObject({
                code: 'ECONNABORTED'
            });
            const controller = new AbortController();
            const pending = http.get('x', { timeout: 10_000, signal: controller.signal });
            controller.abort();
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
            Object.assign(AbortSignal, { any, timeout });
        }
    });

    it('does not open an upload whose signal is already aborted', async () => {
        const xhr = vi.fn(() => new XMLHttpRequest());
        const http = createHttpClient({ session: fakeSession(), xhr });
        const controller = new AbortController();
        controller.abort();
        await expect(
            http.post('x', new Blob(['a']), { signal: controller.signal, onUploadProgress: () => {} })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(xhr).not.toHaveBeenCalled();
    });

    it('returns data, status and lower-case headers', async () => {
        const t = transport({
            respond: () =>
                new Response('{"n":1}', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', 'X-Row-Count': '7' }
                })
        });
        const res = await make(t).http.get<{ n: number }>('x');
        expect(res).toEqual({ status: 200, data: { n: 1 }, headers: expect.objectContaining({ 'x-row-count': '7' }) });
    });

    it('returns a Blob for responseType blob', async () => {
        const t = transport({
            respond: () => new Response(new Blob(['%PDF']), { headers: { 'Content-Type': 'application/pdf' } })
        });
        const res = await make(t).http.get<Blob>('file', { responseType: 'blob' });
        expect(res.data).toBeInstanceOf(Blob);
        expect(await res.data.text()).toBe('%PDF');
    });

    it('throws an ApiError that carries the problem+json body', async () => {
        const problem = { detail: 'Invalid', errors: [{ field: 'key', message: 'Already taken' }] };
        const t = transport({ respond: () => Response.json(problem, { status: 422 }) });
        const err: unknown = await make(t)
            .http.post('x', {})
            .catch((e: unknown) => e);
        expect(isApiError(err)).toBe(true);
        expect(err).toMatchObject({ code: 'ERR_BAD_RESPONSE', response: { status: 422, data: problem } });
    });

    it('reports a timeout as ECONNABORTED and a dead server as ERR_NETWORK', async () => {
        const never: typeof fetch = (_input, init) =>
            new Promise((_resolve, reject) =>
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            );
        const slow = createHttpClient({ session: fakeSession(), fetch: never });
        await expect(slow.get('x', { timeout: 20 })).rejects.toMatchObject({ code: 'ECONNABORTED' });

        const dead = createHttpClient({
            session: fakeSession(),
            fetch: () => Promise.reject(new TypeError('fetch failed'))
        });
        await expect(dead.get('x')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    });

    it('lets a caller abort surface as an AbortError, not an API failure', async () => {
        const never: typeof fetch = (_input, init) =>
            new Promise((_resolve, reject) =>
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            );
        const http = createHttpClient({ session: fakeSession(), fetch: never });
        const controller = new AbortController();
        const pending = http.get('x', { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('typed client (openapi-fetch) on the same path', () => {
    it('adds the token and an Idempotency-Key, and refreshes on 401', async () => {
        const t = transport({ expireFirst: true });
        const { http } = make(t);
        const api = createClient<Record<string, never>>({
            baseUrl: 'http://api.test/v1',
            fetch: (r) => http.authFetch(r)
        });
        // A path the empty test schema does not know: cast through unknown to call it anyway.
        const res = await (api as unknown as { POST(p: string, o: object): Promise<{ response: Response }> }).POST(
            '/x',
            {
                body: { a: 1 }
            }
        );
        expect(res.response.status).toBe(200);
        expect(t.seen).toHaveLength(2);
        expect(t.seen[1].headers.get('authorization')).toBe('Bearer new-token');
        expect(key(t.seen[1])).toBe(key(t.seen[0]));
    });
});
