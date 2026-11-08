/**
 * Rate limits (security.md SEC-AP-2, OWASP API4): per person (per client address before sign-in) on search, lookups, the data viewer's
 * queries, reveals, exports and comments; exports also per installation. A route names its bucket with `@RateLimit()`;
 * the RateLimitGuard (after the AccessGuard, so the caller is known) counts each request in fixed windows and refuses one
 * over a limit with 429 and `Retry-After`. The counts live in the queues' Valkey, so every API replica shares them; a
 * process without Valkey (tests, a lone dev API) counts in memory.
 *
 * A limiter that cannot be reached lets the request through and logs it: the limits are a layer over the permissions and
 * RLS, not the access control itself, and an unreachable Valkey must not stop every search of the office.
 */
import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Redis } from 'ioredis';

import { currentContext } from '../context';
import { RateLimitedError } from '../errors/app-error';
import type { Logger } from '../observability/logger';
import { LOGGER } from '../observability/tokens';

export type RateLimitBucket = 'search' | 'query' | 'reveal' | 'export' | 'comment';

export interface Limit {
    /** requests allowed in one window */
    max: number;
    windowSeconds: number;
}

export interface BucketLimits {
    perPerson: Limit;
    perIp: Limit;
    /** all callers together (exports: the installation's capacity) */
    perInstallation?: Limit;
}

/**
 * The limits: generous for an officer at the counter (a search per keystroke pause, a busy morning), tight where one
 * person could pull the registry out (reveals, exports). Per IP is higher than per person: an office shares one address.
 */
export const RATE_LIMITS: Readonly<Record<RateLimitBucket, BucketLimits>> = {
    search: { perPerson: { max: 120, windowSeconds: 60 }, perIp: { max: 600, windowSeconds: 60 } },
    query: { perPerson: { max: 60, windowSeconds: 60 }, perIp: { max: 300, windowSeconds: 60 } },
    reveal: { perPerson: { max: 30, windowSeconds: 600 }, perIp: { max: 120, windowSeconds: 600 } },
    export: {
        perPerson: { max: 20, windowSeconds: 3600 },
        perIp: { max: 60, windowSeconds: 3600 },
        perInstallation: { max: 300, windowSeconds: 3600 }
    },
    comment: { perPerson: { max: 30, windowSeconds: 60 }, perIp: { max: 150, windowSeconds: 60 } }
};

/** Counts one request against `key` in a fixed window; says how many seconds until the window ends. */
export interface RateLimiter {
    hit(key: string, windowSeconds: number): Promise<{ count: number; resetsIn: number }>;
}

export const RATE_LIMITER = Symbol('kernel.rateLimiter');
/** The limits the guard applies: RATE_LIMITS scaled by the installation's RATE_LIMIT_SCALE. */
export const RATE_LIMIT_POLICY = Symbol('kernel.rateLimitPolicy');

export type RateLimitPolicy = Readonly<Record<RateLimitBucket, BucketLimits>>;

/** Every limit times `scale` (at least 1 request): an installation tunes them to its offices' size. */
export function scaledLimits(scale: number, limits: RateLimitPolicy = RATE_LIMITS): RateLimitPolicy {
    const by = (l: Limit): Limit => ({ max: Math.max(1, Math.round(l.max * scale)), windowSeconds: l.windowSeconds });
    return Object.fromEntries(
        Object.entries(limits).map(([bucket, b]) => [
            bucket,
            {
                perPerson: by(b.perPerson),
                perIp: by(b.perIp),
                ...(b.perInstallation ? { perInstallation: by(b.perInstallation) } : {})
            }
        ])
    ) as RateLimitPolicy;
}

/** One process's counts (tests, an API without Valkey). Expired windows are dropped as they are met. */
export class MemoryRateLimiter implements RateLimiter {
    private readonly windows = new Map<string, { count: number; endsAt: number }>();

    constructor(private readonly now: () => number = Date.now) {}

    hit(key: string, windowSeconds: number) {
        const now = this.now();
        let window = this.windows.get(key);
        if (!window || window.endsAt <= now) {
            if (this.windows.size > 50_000)
                for (const [k, w] of this.windows) if (w.endsAt <= now) this.windows.delete(k);
            window = { count: 0, endsAt: now + windowSeconds * 1000 };
            this.windows.set(key, window);
        }
        window.count += 1;
        return Promise.resolve({ count: window.count, resetsIn: Math.max(1, Math.ceil((window.endsAt - now) / 1000)) });
    }
}

/** Counts in Valkey: INCR, and the window's expiry set by the first request of the window (one round trip). */
export class ValkeyRateLimiter implements RateLimiter {
    constructor(
        private readonly redis: Pick<Redis, 'multi'>,
        private readonly prefix = 'itrms:rl:'
    ) {}

    async hit(key: string, windowSeconds: number) {
        const k = this.prefix + key;
        const replies = await this.redis.multi().incr(k).expire(k, windowSeconds, 'NX').ttl(k).exec();
        if (!replies) throw new Error('the rate-limit transaction was discarded');
        const [[incrError, count], , [ttlError, ttl]] = replies as [
            [Error | null, number],
            unknown,
            [Error | null, number]
        ];
        const failure = incrError ?? ttlError;
        if (failure) throw failure;
        return { count, resetsIn: ttl > 0 ? ttl : windowSeconds };
    }
}

const BUCKET = 'itrms:rate-limit';

/** The route counts against `bucket` (RATE_LIMITS). */
export const RateLimit = (bucket: RateLimitBucket) => SetMetadata(BUCKET, bucket);

/**
 * The counters a request of `bucket` hits, with their limits, in the order they are checked. A signed-in caller counts as
 * a person, not as an address: government networks (WoredaNet) and carrier NAT put many offices behind a few public
 * addresses, so a per-address limit would refuse a whole zone for one busy office. An address counts only for a caller
 * not known yet.
 */
export function countersOf(
    bucket: RateLimitBucket,
    caller: { userId?: string; ip?: string },
    limits: BucketLimits = RATE_LIMITS[bucket]
): { key: string; limit: Limit }[] {
    return [
        ...(caller.userId ? [{ key: `${bucket}:u:${caller.userId}`, limit: limits.perPerson }] : []),
        ...(!caller.userId && caller.ip ? [{ key: `${bucket}:ip:${caller.ip}`, limit: limits.perIp }] : []),
        ...(limits.perInstallation ? [{ key: `${bucket}:all`, limit: limits.perInstallation }] : [])
    ];
}

@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
        @Inject(LOGGER) private readonly logger: Logger,
        @Inject(RATE_LIMIT_POLICY) private readonly limits: RateLimitPolicy = RATE_LIMITS
    ) {}

    // while Valkey is down every limited request would log: once a minute is enough to raise the alarm
    private unreachableLoggedAt = 0;

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const bucket = this.reflector.getAllAndOverride<RateLimitBucket | undefined>(BUCKET, [
            context.getHandler(),
            context.getClass()
        ]);
        if (!bucket) return true;
        const request = currentContext();
        const counters = countersOf(
            bucket,
            { userId: request?.principal?.userId, ip: request?.ip },
            this.limits[bucket]
        );
        let wait = 0;
        try {
            // a request refused by one counter is not counted on the next: one person's runaway client must not use up
            // the installation's exports for everyone
            for (const { key, limit } of counters) {
                const { count, resetsIn } = await this.limiter.hit(key, limit.windowSeconds);
                if (count > limit.max) {
                    wait = resetsIn;
                    break;
                }
            }
        } catch (error) {
            if (Date.now() - this.unreachableLoggedAt > 60_000) {
                this.unreachableLoggedAt = Date.now();
                this.logger.error(
                    { err: error, bucket },
                    'the rate limiter could not be reached: requests go through until it answers'
                );
            }
            return true;
        }
        if (wait > 0) {
            this.logger.warn({ bucket, userId: request?.principal?.userId }, 'rate limit reached');
            throw new RateLimitedError(wait, { detailKey: 'kernel.detail.rate_limited', params: { seconds: wait } });
        }
        return true;
    }
}
