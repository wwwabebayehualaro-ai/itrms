import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, createHttpClient, isApiError, joinUrl, stepUpMaxAge, type BrowserSession } from '@/lib/api/http';

/** The BFF session as the page sees it: only the CSRF token. */
const fakeSession = (csrf: string | null = 'csrf-1'): BrowserSession => ({ csrfToken: () => csrf });

/** Fake transport: records each request. */
function transport(opts: { respond?: () => Response } = {}) {
    const seen: Request[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        seen.push(req);
        return opts.respond?.() ?? Response.json({ ok: true });
    });
    return { seen, fetch: fetch as unknown as typeof globalThis.fetch };
}

const make = (t: ReturnType<typeof transport>, session = fakeSession(), onUnauthenticated = vi.fn()) => ({
    http: createHttpClient({ baseUrl: 'http://api.test/v1/', session, fetch: t.fetch, onUnauthenticated }),
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

describe('HTTP client: the BFF session (ADR-0021)', () => {
    it('never sends a token, and sends the CSRF token only on state-changing calls', async () => {
        const t = transport();
        const { http } = make(t);
        await http.get('x');
        await http.post('x', {});
        await http.put('x', {});
        await http.delete('x');
        expect(t.seen.map((r) => r.headers.get('authorization'))).toEqual([null, null, null, null]);
        expect(t.seen.map((r) => r.headers.get('x-csrf-token'))).toEqual([null, 'csrf-1', 'csrf-1', 'csrf-1']);
    });

    it('never redirects for skipAuth calls', async () => {
        const t = transport({ respond: () => new Response(null, { status: 401 }) });
        const { http, onUnauthenticated } = make(t);
        await expect(http.get('public', { skipAuth: true })).rejects.toMatchObject({ response: { status: 401 } });
        expect(onUnauthenticated).not.toHaveBeenCalled();
    });

    it('asks for sign-in once on 401, without retrying', async () => {
        const t = transport({ respond: () => new Response(null, { status: 401 }) });
        const { http, onUnauthenticated } = make(t);
        await expect(http.get('x')).rejects.toBeInstanceOf(ApiError);
        expect(t.seen).toHaveLength(1);
        expect(onUnauthenticated).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it('asks for a fresh second factor when the API says so (RFC 9470)', async () => {
        const challenge = 'Bearer error="insufficient_user_authentication", max_age=300';
        const t = transport({
            respond: () => new Response(null, { status: 401, headers: { 'WWW-Authenticate': challenge } })
        });
        const { http, onUnauthenticated } = make(t);
        await expect(http.post('x', {})).rejects.toBeInstanceOf(ApiError);
        expect(onUnauthenticated).toHaveBeenCalledExactlyOnceWith(300);
        expect(stepUpMaxAge('Bearer error="invalid_token"')).toBeUndefined();
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
        const http = createHttpClient({ fetch: never });
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
        const http = createHttpClient({ xhr });
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
        const slow = createHttpClient({ fetch: never });
        await expect(slow.get('x', { timeout: 20 })).rejects.toMatchObject({ code: 'ECONNABORTED' });

        const dead = createHttpClient({ fetch: () => Promise.reject(new TypeError('fetch failed')) });
        await expect(dead.get('x')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    });

    it('lets a caller abort surface as an AbortError, not an API failure', async () => {
        const never: typeof fetch = (_input, init) =>
            new Promise((_resolve, reject) =>
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            );
        const http = createHttpClient({ fetch: never });
        const controller = new AbortController();
        const pending = http.get('x', { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('typed client (openapi-fetch) on the same path', () => {
    it('adds the CSRF token and an Idempotency-Key', async () => {
        const t = transport();
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
        expect(t.seen).toHaveLength(1);
        expect(t.seen[0].headers.get('x-csrf-token')).toBe('csrf-1');
        expect(key(t.seen[0])).toBeTruthy();
        expect(await t.seen[0].json()).toEqual({ a: 1 });
    });
});
