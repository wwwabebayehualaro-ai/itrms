/**
 * The signed request context (ADR-0048). The API tells the database who is acting with one token, signed with a key the
 * application role cannot read; `kernel.ctx()` (drizzle/0062) verifies it, and the policies and functions read only what
 * it returns. The token is `<mac hex>:<kid>:<json>`, `mac = HMAC-SHA256(key, kid + ':' + json)`; `kid` names the key (the
 * first 16 hex characters of its SHA-256), so a key can be rotated while the old one is still accepted for a short grace.
 */
import { createHash, createHmac } from 'node:crypto';

import type { DbContext } from './types';

/** How long a token is good for, counted from signing: far longer than a transaction, far shorter than a stolen one is of use. */
export const CONTEXT_TTL_SECONDS = 30;

/** The key's id: the first 16 hex characters of its SHA-256 (what `kernel.context_keys.kid` holds). */
export const contextKeyId = (key: Buffer): string => createHash('sha256').update(key).digest('hex').slice(0, 16);

/** CONTEXT_HMAC_KEY (64 hex characters) as the key the database options take; none when it is not configured. */
export const contextKeyOf = (hex: string | undefined): Buffer | undefined =>
    hex ? Buffer.from(hex, 'hex') : undefined;

/** The fields a context carries besides the request id and address; any of them makes a key necessary. */
export const carriesIdentity = (ctx: DbContext): boolean =>
    Boolean(ctx.userId || ctx.regionId || ctx.unitId || ctx.scopePath || ctx.partyId || ctx.subject);

export interface SignOptions {
    /** milliseconds since the epoch; tests sign in the past to check the expiry */
    now?: number;
    ttlSeconds?: number;
}

/** The token for `ctx`; anything unknown is left out (the database reads it as NULL). */
export function signContext(ctx: DbContext, key: Buffer, options: SignOptions = {}): string {
    const exp = Math.floor((options.now ?? Date.now()) / 1000) + (options.ttlSeconds ?? CONTEXT_TTL_SECONDS);
    const body = JSON.stringify({
        exp,
        usr: ctx.userId,
        reg: ctx.regionId,
        unit: ctx.unitId,
        scope: ctx.scopePath,
        party: ctx.partyId,
        sub: ctx.subject,
        req: ctx.requestId,
        ip: ctx.ip
    });
    const kid = contextKeyId(key);
    const mac = createHmac('sha256', key).update(`${kid}:${body}`, 'utf8').digest('hex');
    return `${mac}:${kid}:${body}`;
}
