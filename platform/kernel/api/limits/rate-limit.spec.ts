import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { runInContext, type Principal } from '../context';
import { RateLimitedError } from '../errors/app-error';
import type { Logger } from '../observability/logger';
import {
    countersOf,
    MemoryRateLimiter,
    RATE_LIMITS,
    RateLimit,
    RateLimitGuard,
    scaledLimits,
    type RateLimiter
} from './rate-limit';

const logger = { error: vi.fn(), warn: vi.fn() } as unknown as Logger;

class Routes {
    @RateLimit('reveal')
    reveal() {}
    open() {}
}

// the route's handler as Nest passes it to a guard: the class's method itself
const contextOf = (route: 'reveal' | 'open') =>
    ({
        getHandler: () => Object.getOwnPropertyDescriptor(Routes.prototype, route)?.value as unknown,
        getClass: () => Routes
    }) as unknown as ExecutionContext;

const principal = (userId: string) => ({ userId }) as unknown as Principal;
const asCaller = <T>(userId: string, ip: string, fn: () => T) =>
    runInContext({ requestId: 'r', ip, language: 'en', principal: principal(userId) }, fn);

describe('rate limits (SEC-AP-2)', () => {
    it('counts per person and per address, and per installation for exports', () => {
        // a signed-in caller is a person; offices share their public addresses (NAT), so the address counts only before sign-in
        expect(countersOf('search', { userId: 'u1', ip: '10.0.0.1' }).map((c) => c.key)).toEqual(['search:u:u1']);
        expect(countersOf('search', { ip: '10.0.0.1' }).map((c) => c.key)).toEqual(['search:ip:10.0.0.1']);
        expect(countersOf('export', { userId: 'u1' }).map((c) => c.key)).toEqual(['export:u:u1', 'export:all']);
    });

    it('counts in fixed windows in memory', async () => {
        let now = 0;
        const limiter = new MemoryRateLimiter(() => now);
        expect(await limiter.hit('k', 60)).toEqual({ count: 1, resetsIn: 60 });
        now = 30_000;
        expect(await limiter.hit('k', 60)).toEqual({ count: 2, resetsIn: 30 });
        now = 60_000;
        expect(await limiter.hit('k', 60)).toEqual({ count: 1, resetsIn: 60 });
    });

    it('refuses the request over the person’s limit with 429 and the wait, and leaves unmarked routes alone', async () => {
        const guard = new RateLimitGuard(new Reflector(), new MemoryRateLimiter(), logger);
        const max = RATE_LIMITS.reveal.perPerson.max;
        for (let i = 0; i < max; i++)
            await expect(asCaller('u1', '10.0.0.1', () => guard.canActivate(contextOf('reveal')))).resolves.toBe(true);
        const refused = await asCaller('u1', '10.0.0.1', () => guard.canActivate(contextOf('reveal'))).catch(
            (e: unknown) => e
        );
        expect(refused).toBeInstanceOf(RateLimitedError);
        expect((refused as RateLimitedError).retryAfter).toBeGreaterThan(0);
        expect((refused as RateLimitedError).detailKey).toBe('kernel.detail.rate_limited');
        // another person in the same office is still served; an unmarked route is never counted
        await expect(asCaller('u2', '10.0.0.1', () => guard.canActivate(contextOf('reveal')))).resolves.toBe(true);
        await expect(asCaller('u1', '10.0.0.1', () => guard.canActivate(contextOf('open')))).resolves.toBe(true);
    });

    it('does not count a refused request on the installation’s counter', async () => {
        const limiter = new MemoryRateLimiter();
        const guard = new RateLimitGuard(new Reflector(), limiter, logger);
        class Exports {
            @RateLimit('export')
            run() {}
        }
        const ctx = {
            getHandler: () => Object.getOwnPropertyDescriptor(Exports.prototype, 'run')?.value as unknown,
            getClass: () => Exports
        } as unknown as ExecutionContext;
        const max = RATE_LIMITS.export.perPerson.max;
        for (let i = 0; i < max + 10; i++)
            await asCaller('u1', '10.0.0.1', () => guard.canActivate(ctx)).catch(() => undefined);
        // the person's 20 went through; the 10 refused ones are not on the installation's count
        expect((await limiter.hit('export:all', 3600)).count).toBe(max + 1);
    });

    it('lets the request through when the counter cannot be reached, and says so in the log', async () => {
        const down: RateLimiter = { hit: () => Promise.reject(new Error('ECONNREFUSED')) };
        const guard = new RateLimitGuard(new Reflector(), down, logger);
        await expect(asCaller('u1', '10.0.0.1', () => guard.canActivate(contextOf('reveal')))).resolves.toBe(true);
        expect(logger.error).toHaveBeenCalled();
    });
});

describe('an installation’s scale', () => {
    it('multiplies every limit, never below one request', () => {
        expect(scaledLimits(2).search.perPerson.max).toBe(RATE_LIMITS.search.perPerson.max * 2);
        expect(scaledLimits(2).export.perInstallation?.max).toBe((RATE_LIMITS.export.perInstallation?.max ?? 0) * 2);
        expect(scaledLimits(0.001).reveal.perPerson.max).toBe(1);
        expect(scaledLimits(3).search.perPerson.windowSeconds).toBe(RATE_LIMITS.search.perPerson.windowSeconds);
    });
});
