// The development /files route (task 0.15): the object store behind presigned URLs, refusing what Nginx refuses in
// production, and absent outside development.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function route(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import('../../app/files/[...path]/route');
}
const call = (
    handler: (r: Request, c: { params: Promise<{ path: string[] }> }) => Promise<Response>,
    method: string,
    path: string
) => {
    const url = new URL(`http://localhost:3000/files/${path}`);
    return handler(new Request(url, { method }), {
        params: Promise.resolve({ path: url.pathname.split('/').slice(2).filter(Boolean) })
    });
};

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('the development /files route', () => {
    it('is not there outside development', async () => {
        const { GET } = await route({ NODE_ENV: 'production', FILES_UPSTREAM: 'http://127.0.0.1:18333' });
        expect((await call(GET, 'GET', 'b/k?X-Amz-Signature=s')).status).toBe(404);
    });

    it('refuses a listing, a bucket request, an unsigned one and other operations, and forwards a signed one', async () => {
        const sent: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            sent.push(url);
            return Promise.resolve(
                new Response('ok', { status: 200, headers: { 'content-type': 'application/pdf', server: 'x' } })
            );
        });
        const { GET, POST, PUT } = await route({ NODE_ENV: 'development', FILES_UPSTREAM: 'http://127.0.0.1:18333' });
        for (const [handler, method, path] of [
            [GET, 'GET', 'b'],
            [GET, 'GET', 'b?list-type=2'],
            [POST, 'POST', 'b?delete'],
            [GET, 'GET', 'b/k'],
            [PUT, 'PUT', 'b/k?uploads&X-Amz-Signature=s'],
            [GET, 'GET', 'b/k?acl&X-Amz-Signature=s']
        ] as const)
            expect((await call(handler, method, path)).status, `${method} ${path}`).toBe(403);
        expect(sent).toEqual([]);
        const ok = await call(GET, 'GET', 'b/quarantine/k?X-Amz-Signature=s');
        expect(ok.status).toBe(200);
        expect(ok.headers.get('server')).toBeNull();
        expect(sent).toEqual(['http://127.0.0.1:18333/b/quarantine/k?X-Amz-Signature=s']);
    });
});
