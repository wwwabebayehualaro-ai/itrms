/**
 * The Authenticator of the HTTP process (ADR-0004, ADR-0031): Keycloak says who is calling, ITRMS says what they may do.
 *   1. The BFF sends the Keycloak access token as `Authorization: Bearer …` and the active unit as `X-Org-Unit`.
 *   2. The token is verified against the realm's keys (JWKS via jose): signature, issuer, audience, expiry. Its claims
 *      say who the person is and nothing more: roles in the token are never read.
 *   3. `kernel.resolve_principal(unit)` (for the subject in the signed context) returns their roles in that unit from `role_assignments`, on every request,
 *      so a revoked assignment stops working at the next request.
 *   4. The permissions are those the installed modules' manifests give those roles.
 */
import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { Principal } from '../context';
import type { Database } from '../db/database';
import { ForbiddenError, InvalidRequestError, RateLimitedError } from '../errors';
import type { RateLimiter } from '../limits/rate-limit';
import type { Authenticator } from './access';
import { permissionsOf, type RolePermissions } from './roles';

export interface OidcOptions {
    /** The realm's issuer (`https://app.example/auth/realms/itrms`): tokens from any other are refused. */
    issuer: string;
    /** The audience the API's tokens carry (`itrms-api`). */
    audience: string;
    /** The realm's keys: by default fetched (and cached) from its JWKS endpoint. */
    keys?: JWTVerifyGetKey;
    /** Where the keys are, when the API reaches Keycloak by another address than the issuer's (Compose network). */
    jwksUrl?: string;
    /** The clients whose access tokens are accepted (`azp`): the BFF, not any other client of the realm. */
    clients?: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PrincipalRow extends Record<string, unknown> {
    user_id: string;
    unit_id: string;
    region_id: string;
    scope_path: string;
    roles: string[];
}

/** The window refusals of accounts without a role are counted in (follow-up 69). */
const DENIAL_WINDOW_SECONDS = 600;

export class OidcAuthenticator implements Authenticator {
    private readonly keys: JWTVerifyGetKey;

    constructor(
        private readonly database: Database,
        private readonly roles: RolePermissions,
        private readonly options: OidcOptions,
        /** counts refusals of realm accounts with no role here (follow-up 69); none: every refusal is recorded */
        private readonly limiter?: RateLimiter
    ) {
        this.keys =
            options.keys ??
            createRemoteJWKSet(new URL(options.jwksUrl ?? `${options.issuer}/protocol/openid-connect/certs`));
    }

    async authenticate(request: FastifyRequest): Promise<Principal | undefined> {
        const header = request.headers.authorization;
        const token =
            typeof header === 'string' && /^Bearer [A-Za-z0-9._-]+$/.test(header) ? header.slice(7) : undefined;
        if (!token) return undefined;

        let sub: string | undefined;
        let authAge: number | undefined;
        try {
            const { payload } = await jwtVerify(token, this.keys, {
                issuer: this.options.issuer,
                audience: this.options.audience,
                algorithms: ['RS256', 'PS256', 'ES256'],
                requiredClaims: ['exp', 'iat', 'sub'],
                clockTolerance: 5
            });
            // an access token (not an ID or refresh token) issued to the BFF
            const clients = this.options.clients ?? ['itrms-web'];
            if (payload.typ !== 'Bearer' || typeof payload.azp !== 'string' || !clients.includes(payload.azp))
                return undefined;
            sub = payload.sub;
            // the factors' age when the token was issued (both from Keycloak's clock), plus the token's own age now; a
            // host clock behind Keycloak's counts the token as new rather than ever making the factors younger
            const authTime = payload.auth_time;
            if (typeof authTime === 'number' && typeof payload.iat === 'number' && authTime <= payload.iat)
                authAge = payload.iat - authTime + Math.max(0, Math.floor(Date.now() / 1000) - payload.iat);
        } catch {
            // expired, forged, another realm or another audience: not signed in
            return undefined;
        }
        if (!sub) return undefined;

        const unitHeader = request.headers['x-org-unit'];
        if (unitHeader !== undefined && (typeof unitHeader !== 'string' || !UUID.test(unitHeader)))
            throw new InvalidRequestError('invalid_request', { detailKey: 'kernel.detail.org_unit_header' });

        // the subject travels in the signed context: the function answers for it and for nobody else
        const [row] = await this.database.scoped(
            { requestId: request.id, ip: request.ip, subject: sub },
            async (tx) => {
                const result = await tx.execute<PrincipalRow>(
                    sql`select * from kernel.resolve_principal(${unitHeader ?? null}::uuid)`
                );
                return result.rows;
            }
        );
        // signed in, but no role in that unit (or none at all): the refusal records the account and the unit asked for
        if (!row) throw await this.refusal(sub, request.ip, unitHeader);
        return {
            userId: row.user_id,
            unitId: row.unit_id,
            regionId: row.region_id,
            scopePath: row.scope_path,
            roles: row.roles,
            permissions: permissionsOf(this.roles, row.roles),
            authAge
        };
    }

    /**
     * A signed-in account with no role in the unit asked for. Each refusal is an append-only audit row, and any realm
     * account can ask on every request: past ten in ten minutes per account (a hundred per address) the refusal is a 429
     * that writes no row; the tenth row says it was throttled. The account is counted by a hash of its subject, never
     * the subject itself. A limiter that cannot be reached leaves every refusal recorded.
     */
    private async refusal(sub: string, ip: string, unit: string | undefined): Promise<Error> {
        const audit = { reason: 'no_role_in_unit', subject: sub, unit: unit ?? '(default)' };
        if (!this.limiter) return new ForbiddenError({ audit });
        const counters = [
            { key: `denied:s:${createHash('sha256').update(sub).digest('hex')}`, max: 10 },
            { key: `denied:ip:${ip}`, max: 100 }
        ];
        let throttled = false;
        try {
            for (const { key, max } of counters) {
                const { count, resetsIn } = await this.limiter.hit(key, DENIAL_WINDOW_SECONDS);
                if (count > max)
                    return new RateLimitedError(resetsIn, {
                        detailKey: 'kernel.detail.rate_limited',
                        params: { seconds: resetsIn }
                    });
                if (count === max) throttled = true;
            }
        } catch {
            return new ForbiddenError({ audit });
        }
        return new ForbiddenError({ audit: throttled ? { ...audit, throttled: 'true' } : audit });
    }
}
