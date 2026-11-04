/**
 * The public hostname (ADR-0045, task 0.23b), proven on a real Nginx with the verify server of
 * infra/compose/nginx/itrms.conf.template, a stub in place of the API. Exactly two API paths are proxied, GET only, and rate-limited;
 * every other path of the API, the staff app and Keycloak answers 404; a token's page is the static app; the CSP is the build's.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const NGINX_DIR = join(HERE, '..', '..', '..', '..', 'infra', 'compose', 'nginx');
const IMAGE = 'nginx:1.27-alpine';
const CSP = `add_header Content-Security-Policy "default-src 'none'; script-src 'self'" always;\n`;

/** The template's verify server, listening plainly, with a stub API and the static app's one page. */
function verifyServer(): string {
    const template = readFileSync(join(NGINX_DIR, 'itrms.conf.template'), 'utf8');
    const zone = /limit_req_zone .* zone=itrms_verify:[^\n]*\n/.exec(template)?.[0];
    const start = template.indexOf('    # the static verify app (apps/verify)');
    const after = template.indexOf('    location / {', start);
    const end = template.indexOf('    }\n', after) + 6;
    if (!zone || start < 0 || after < 0) throw new Error('the verify server is not in the template');
    const locations = template
        .slice(start, end)
        .replace('proxy_pass http://api:4000;', 'proxy_pass http://127.0.0.1:8081;');
    if (locations.includes('http://api:4000')) throw new Error('the API upstream is still there');
    return `${zone}limit_req_status 429;
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
    listen 80;
${locations}}
server {
    listen 127.0.0.1:8081;
    location / {
        default_type application/json;
        return 200 '{"upstream":"$request_method $uri"}';
    }
}
`;
}

let nginx: StartedTestContainer;
let base: string;
const token = () => randomBytes(16).toString('base64url');

beforeAll(async () => {
    nginx = await new GenericContainer(IMAGE)
        .withCopyContentToContainer([
            { content: verifyServer(), target: '/etc/nginx/conf.d/default.conf' },
            {
                content: readFileSync(join(NGINX_DIR, 'itrms-proxy.conf'), 'utf8'),
                target: '/etc/nginx/itrms-proxy.conf'
            },
            { content: '<!doctype html><title>verify page</title>', target: '/srv/verify/index.html' },
            { content: CSP, target: '/srv/verify/csp.conf' },
            { content: 'console.log(1)', target: '/srv/verify/_next/static/a.js' },
            { content: 'self.skipWaiting()', target: '/srv/verify/sw.js' }
        ])
        .withExposedPorts(80)
        .start();
    base = `http://${nginx.getHost()}:${nginx.getMappedPort(80)}`;
}, 240_000);

afterAll(async () => {
    await nginx?.stop();
});

describe('verify.<domain> through Nginx', () => {
    it('proxies a token to the API, to its real path', async () => {
        const t = token();
        const got = await fetch(`${base}/v1/public/verifications/${t}`);
        expect(got.status).toBe(200);
        expect(await got.json()).toEqual({ upstream: `GET /api/v1/public/verifications/${t}` });
    });

    it('proxies the public keys to the API, to their real path', async () => {
        const got = await fetch(`${base}/v1/public/verification-keys`);
        expect(got.status).toBe(200);
        expect(await got.json()).toEqual({ upstream: 'GET /api/v1/public/verification-keys' });
    });

    it('proxies GET only', async () => {
        const t = token();
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
            for (const path of [`/v1/public/verifications/${t}`, '/v1/public/verification-keys'])
                expect((await fetch(`${base}${path}`, { method })).status, `${method} ${path}`).toBe(403);
    });

    it('answers 404 for everything else of the API, the staff app and Keycloak', async () => {
        for (const path of [
            '/api/v1/cases',
            '/api/v1/public/verifications/abc',
            `/api/v1/public/verifications/${token()}`,
            '/v1/cases',
            '/v1/public/verifications/too-short',
            `/v1/public/verifications/${token()}/more`,
            '/v1/public/verification-keys/more',
            '/api/v1/public/verification-keys',
            '/auth/realms/itrms'
        ])
            expect((await fetch(base + path)).status, path).toBe(404);
    });

    it("serves the static page for a token's address, with the build's policy", async () => {
        const got = await fetch(`${base}/${token()}`);
        expect(got.status).toBe(200);
        expect(await got.text()).toContain('verify page');
        expect(got.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    it('lets a phone see a new service worker at once, and only this origin use the camera', async () => {
        const worker = await fetch(`${base}/sw.js`);
        expect(worker.status).toBe(200);
        expect(worker.headers.get('cache-control')).toBe('no-cache');
        expect(worker.headers.get('permissions-policy')).toContain('camera=(self)');
        expect((await fetch(`${base}/${token()}`)).headers.get('permissions-policy')).toContain('microphone=()');
    });

    it('serves a fingerprinted file cached, and never limits the page or its files', async () => {
        for (let i = 0; i < 80; i += 1) expect((await fetch(`${base}/${token()}`)).status).toBe(200);
        const got = await fetch(`${base}/_next/static/a.js`);
        expect(got.status).toBe(200);
        expect(got.headers.get('cache-control')).toContain('max-age=');
    });

    it('limits how fast one address may ask', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 60; i += 1)
            statuses.push((await fetch(`${base}/v1/public/verifications/${token()}`)).status);
        expect(statuses).toContain(429);
        expect(statuses.filter((s) => s === 200).length).toBeLessThan(45);
    });
});
