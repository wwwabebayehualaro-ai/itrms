// @vitest-environment node
// The BFF's building blocks (ADR-0021, security.md §5): sealing, the session store, CSRF, the proxy's allow-lists,
// back-channel logout tokens and the security headers.
import { randomBytes } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { describe, expect, it } from 'vitest';

import { loadBffConfig } from '@/bff/config';
import { sameOrigin, tokenMatches } from '@/bff/csrf';
import { apiRequestHeaders, apiTarget, browserResponseHeaders } from '@/bff/forward';
import { verifyLogoutToken } from '@/bff/logout-token';
import { open, parseKeyring, seal } from '@/bff/seal';
import { ABSOLUTE_SECONDS, IDLE_SECONDS, SessionStore, type KeyValue, type SessionRecord } from '@/bff/session-store';
import { contentSecurityPolicy, SECURITY_HEADERS } from '../../proxy';

const keyText = () => randomBytes(32).toString('base64');

/** Valkey on a map, with TTLs read back for the assertions. */
function memoryKv() {
    const values = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    const ttl = new Map<string, number>();
    const kv: KeyValue = {
        get: async (k) => values.get(k) ?? null,
        setFor: async (k, v, s) => {
            values.set(k, v);
            ttl.set(k, s);
        },
        setIfAbsent: async (k, v, s) => {
            if (values.has(k)) return false;
            values.set(k, v);
            ttl.set(k, s);
            return true;
        },
        setIfPresent: async (k, v, s) => {
            if (!values.has(k)) return false;
            values.set(k, v);
            ttl.set(k, s);
            return true;
        },
        del: async (...keys) => keys.filter((k) => values.delete(k) || sets.delete(k)).length,
        sadd: async (k, ...m) => {
            const set = sets.get(k) ?? new Set<string>();
            m.forEach((x) => set.add(x));
            sets.set(k, set);
            return m.length;
        },
        smembers: async (k) => [...(sets.get(k) ?? [])],
        expire: async (k, s) => {
            if (!values.has(k) && !sets.has(k)) return 0;
            ttl.set(k, s);
            return 1;
        }
    };
    return { kv, values, ttl };
}

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
    sub: 'sub-1',
    sid: 'kc-session-1',
    csrf: 'csrf-token',
    createdAt: Date.now(),
    accessToken: 'eyJ.access.token',
    accessExpiresAt: Date.now() + 300_000,
    refreshToken: 'refresh-1',
    idToken: 'id-1',
    ...over
});

describe('sealing (AES-256-GCM)', () => {
    it('opens only with its key and in its place, and rotates keys', () => {
        const old = parseKeyring(`k1:${keyText()}`);
        const sealed = seal(old, 'secret', 'here');
        expect(open(old, sealed, 'here')).toBe('secret');
        expect(open(old, sealed, 'elsewhere')).toBeUndefined();
        const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
        expect(open(old, tampered, 'here')).toBeUndefined();
        expect(open(old, 'garbage', 'here')).toBeUndefined();

        const rotated = parseKeyring(`k2:${keyText()},k1:${Buffer.from(old.keys.get('k1') ?? []).toString('base64')}`);
        expect(open(rotated, sealed, 'here')).toBe('secret');
        expect(seal(rotated, 'x', 'here').startsWith('k2.')).toBe(true);
        expect(open(parseKeyring(`k2:${keyText()}`), sealed, 'here')).toBeUndefined();
    });

    it('refuses short keys and malformed key lists', () => {
        expect(() => parseKeyring('k1:c2hvcnQ=')).toThrow(/32 bytes/);
        expect(() => parseKeyring(`K 1:${keyText()}`)).toThrow();
        expect(() => parseKeyring('')).toThrow();
    });
});

describe('the session store (SEC-SE-1, SEC-SE-2, SEC-SE-4)', () => {
    it('keeps neither the session id nor the tokens readable in Valkey', async () => {
        const { kv, values } = memoryKv();
        const store = new SessionStore(kv, parseKeyring(`k1:${keyText()}`));
        await store.put('the-session-id', record());
        const dump = [...values.entries()].flat().join(' ');
        expect(dump).not.toContain('the-session-id');
        expect(dump).not.toContain('eyJ.access.token');
        expect(dump).not.toContain('refresh-1');
        expect(await store.get('the-session-id')).toMatchObject({ sub: 'sub-1', accessToken: 'eyJ.access.token' });
        expect(await store.get('another-id')).toBeUndefined();
    });

    it('expires after 30 idle minutes and never lives past 12 hours', async () => {
        const { kv, ttl } = memoryKv();
        const store = new SessionStore(kv, parseKeyring(`k1:${keyText()}`));
        const now = Date.now();
        await store.put('fresh', record({ createdAt: now }), now);
        expect(Math.max(...ttl.values())).toBeLessThanOrEqual(ABSOLUTE_SECONDS);
        expect([...ttl.entries()].find(([k]) => k.startsWith('bff:s:'))?.[1]).toBe(IDLE_SECONDS);

        const late = now - (ABSOLUTE_SECONDS - 60) * 1000;
        await store.put('old', record({ createdAt: late }), now);
        expect([...ttl.values()]).toContain(60);
        expect(await store.get('old', now + 61_000)).toBeUndefined();
    });

    it('never brings back a session deleted while a request held it (touch, refresh)', async () => {
        const { kv } = memoryKv();
        const store = new SessionStore(kv, parseKeyring(`k1:${keyText()}`));
        await store.put('s', record());
        const held = await store.get('s');
        expect(held && (await store.touch('s', held))).toBe(true);
        expect(held && (await store.update('s', { ...held, accessToken: 'eyJ.newer' }))).toBe(true);
        expect(await store.get('s')).toMatchObject({ accessToken: 'eyJ.newer' });

        // signed out (or back-channel logout) between the read and the write
        await store.delete('s');
        expect(held && (await store.touch('s', held))).toBe(false);
        expect(held && (await store.update('s', held))).toBe(false);
        expect(await store.get('s')).toBeUndefined();
    });

    it('ends every session of a Keycloak session (back-channel) or of a person (everywhere)', async () => {
        const { kv } = memoryKv();
        const store = new SessionStore(kv, parseKeyring(`k1:${keyText()}`));
        await store.put('a', record({ sid: 'kc-1' }));
        await store.put('b', record({ sid: 'kc-1' }));
        await store.put('c', record({ sid: 'kc-2' }));
        await store.put('d', record({ sub: 'sub-2', sid: 'kc-3' }));
        expect(await store.deleteByKeycloakSession('kc-1')).toBe(2);
        expect(await store.get('a')).toBeUndefined();
        expect(await store.get('c')).toBeDefined();
        expect(await store.deleteBySubject('sub-1')).toBe(1);
        expect(await store.get('c')).toBeUndefined();
        expect(await store.get('d')).toBeDefined();
    });

    it('lets a key be claimed once (logout token ids, a refresh in progress)', async () => {
        const store = new SessionStore(memoryKv().kv, parseKeyring(`k1:${keyText()}`));
        expect(await store.claim('jti-1', 60)).toBe(true);
        expect(await store.claim('jti-1', 60)).toBe(false);
        await store.release('jti-1');
        expect(await store.claim('jti-1', 60)).toBe(true);
    });
});

describe('CSRF (SEC-SE-6)', () => {
    const app = 'https://app.bureau.example';
    it('accepts only the app’s own origin', () => {
        expect(sameOrigin(new Headers({ origin: app }), app)).toBe(true);
        expect(sameOrigin(new Headers({ origin: 'https://evil.example' }), app)).toBe(false);
        expect(sameOrigin(new Headers({ origin: 'null' }), app)).toBe(false);
        expect(sameOrigin(new Headers({ 'sec-fetch-site': 'same-origin' }), app)).toBe(true);
        expect(sameOrigin(new Headers({ 'sec-fetch-site': 'same-site' }), app)).toBe(false);
        expect(sameOrigin(new Headers(), app)).toBe(false);
    });

    it('compares the token exactly', () => {
        expect(tokenMatches('abc', 'abc')).toBe(true);
        expect(tokenMatches('abd', 'abc')).toBe(false);
        expect(tokenMatches('ab', 'abc')).toBe(false);
        expect(tokenMatches(null, 'abc')).toBe(false);
    });
});

describe('the /api proxy', () => {
    it('sends the API the bearer token, the active unit and the client’s address, never the browser’s cookies or credentials', () => {
        const incoming = new Headers({
            cookie: '__Host-itrms_sid=abc',
            authorization: 'Bearer forged',
            'x-org-unit': '0199f0a0-0000-7000-8000-00000000dead',
            'x-forwarded-for': '10.0.0.1',
            accept: 'application/json',
            'if-match': '"3"',
            'idempotency-key': 'k-1',
            'content-type': 'application/json'
        });
        const out = apiRequestHeaders(incoming, 'access-token', '0199f0a0-0000-7000-8000-000000000001', 'req-1');
        expect(out.get('cookie')).toBeNull();
        expect(out.get('x-forwarded-for')).toBe('10.0.0.1');
        expect(out.get('authorization')).toBe('Bearer access-token');
        expect(out.get('x-org-unit')).toBe('0199f0a0-0000-7000-8000-000000000001');
        expect(out.get('if-match')).toBe('"3"');
        expect(out.get('idempotency-key')).toBe('k-1');
        expect(apiRequestHeaders(incoming, 't', undefined, 'r').get('x-org-unit')).toBeNull();
    });

    it('gives the browser the API’s answer without cookies, and uncached', () => {
        const out = browserResponseHeaders(
            new Headers({ 'set-cookie': 'x=1', 'content-type': 'application/json', etag: '"2"', server: 'fastify' })
        );
        expect(out.get('set-cookie')).toBeNull();
        expect(out.get('server')).toBeNull();
        expect(out.get('etag')).toBe('"2"');
        expect(out.get('cache-control')).toBe('no-store');
    });

    it('serves only versioned API paths', () => {
        const api = 'http://api:4000';
        expect(apiTarget(api, ['v1', 'me', 'workspace'], '?a=1')).toBe('http://api:4000/api/v1/me/workspace?a=1');
        expect(apiTarget(api, ['health'], '')).toBeUndefined();
        expect(apiTarget(api, ['v1', '..', 'internal'], '')).toBeUndefined();
        expect(apiTarget(api, ['v1', 'a/b'], '')).toBeUndefined();
        expect(apiTarget(api, [], '')).toBeUndefined();
    });
});

describe('back-channel logout tokens', () => {
    const issuer = 'http://localhost:18080/realms/itrms';
    const event = { 'http://schemas.openid.net/event/backchannel-logout': {} };

    it('accepts a signed logout token for this client, and nothing like it', async () => {
        const realm = await generateKeyPair('RS256');
        const other = await generateKeyPair('RS256');
        const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(realm.publicKey)), kid: 'k', alg: 'RS256' }] });
        const sign = (claims: JWTPayload, key = realm.privateKey) =>
            new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuedAt().sign(key);
        const expected = { issuer, clientId: 'itrms-web' };
        const good = { iss: issuer, aud: 'itrms-web', jti: 'j-1', sid: 'kc-1', sub: 'sub-1', events: event };

        expect(await verifyLogoutToken(await sign(good), keys, expected)).toEqual({
            jti: 'j-1',
            sid: 'kc-1',
            sub: 'sub-1'
        });
        for (const bad of [
            { ...good, aud: 'another-client' },
            { ...good, iss: 'http://elsewhere/realms/itrms' },
            { ...good, events: {} },
            { ...good, nonce: 'n' },
            { ...good, sid: undefined, sub: undefined },
            { ...good, jti: undefined }
        ])
            expect(await verifyLogoutToken(await sign(bad), keys, expected)).toBeUndefined();
        expect(await verifyLogoutToken(await sign(good, other.privateKey), keys, expected)).toBeUndefined();
    });
});

describe('security headers (SEC-WB-1)', () => {
    it('sends a nonce-based CSP and the fixed headers', () => {
        const csp = contentSecurityPolicy('n0nce', { dev: false });
        expect(csp).toContain("script-src 'self' 'nonce-n0nce' 'strict-dynamic'");
        for (const directive of [
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'"
        ])
            expect(csp).toContain(directive);
        expect(csp).not.toContain('unsafe-eval');
        expect(contentSecurityPolicy('n', { dev: true })).toContain("'unsafe-eval'");
        expect(SECURITY_HEADERS['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
        expect(SECURITY_HEADERS['x-content-type-options']).toBe('nosniff');
    });
});

describe('configuration', () => {
    it('names the problems, never the values', () => {
        const secret = 'a-very-secret-client-secret';
        let message = '';
        try {
            loadBffConfig({
                NODE_ENV: 'production',
                APP_ORIGIN: 'http://app.example',
                API_URL: 'http://api:4000',
                OIDC_ISSUER: 'http://app.example/auth/realms/itrms',
                OIDC_CLIENT_SECRET: secret,
                SESSION_VALKEY_URL: 'redis://sessions:6379',
                SESSION_KEYS: 'k1:short'
            });
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message).toMatch(/https in production/);
        expect(message).not.toContain(secret);
    });
});
