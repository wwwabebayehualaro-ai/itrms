import type { FastifyRequest } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../db/database';
import { ForbiddenError, RateLimitedError } from '../errors';
import { MemoryRateLimiter, type RateLimiter } from '../limits/rate-limit';
import { OidcAuthenticator } from './oidc-authenticator';

const ISSUER = 'https://app.test/auth/realms/itrms';
const AUDIENCE = 'itrms-api';

// a realm account with no ITRMS user: resolve_principal answers no row
const noPrincipal = { scoped: () => Promise.resolve([]) } as unknown as Database;

let token = '';
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1' }] });
    token = await new SignJWT({ typ: 'Bearer', azp: 'itrms-web' })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject('realm-only-account')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
});

const request = () =>
    ({ id: 'r1', ip: '10.0.0.9', headers: { authorization: `Bearer ${token}` } }) as unknown as FastifyRequest;
const authenticator = (limiter?: RateLimiter) =>
    new OidcAuthenticator(noPrincipal, new Map(), { issuer: ISSUER, audience: AUDIENCE, keys }, limiter);
const outcome = (a: OidcAuthenticator) =>
    a.authenticate(request()).then(
        () => undefined,
        (e: unknown) => e
    );

describe('refusals of realm accounts with no ITRMS user (follow-up 69)', () => {
    it('records ten in ten minutes, the tenth marked throttled, then answers 429 without a record', async () => {
        const a = authenticator(new MemoryRateLimiter());
        const results = [];
        for (let i = 0; i < 12; i++) results.push(await outcome(a));
        const refusals = results.filter((r): r is ForbiddenError => r instanceof ForbiddenError);
        expect(refusals).toHaveLength(10);
        expect(refusals.slice(0, 9).every((r) => r.audit?.throttled === undefined)).toBe(true);
        expect(refusals[9]?.audit).toMatchObject({ reason: 'no_role_in_unit', throttled: 'true' });
        expect(results.slice(10).every((r) => r instanceof RateLimitedError)).toBe(true);
    });

    it('records every refusal when there is no limiter, or it cannot be reached', async () => {
        expect(await outcome(authenticator())).toBeInstanceOf(ForbiddenError);
        const down: RateLimiter = { hit: () => Promise.reject(new Error('ECONNREFUSED')) };
        for (let i = 0; i < 12; i++) expect(await outcome(authenticator(down))).toBeInstanceOf(ForbiddenError);
    });
});
