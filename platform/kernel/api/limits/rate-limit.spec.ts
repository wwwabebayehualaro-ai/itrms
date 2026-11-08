import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { runInContext, type Principal } from '../context';
import { RateLimitedError } from '../errors/app-error';
import type { Logger } from '../observability/logger';
import { countersOf, MemoryRateLimiter, RATE_LIMITS, RateLimit, RateLimitGuard, type RateLimiter } from './rate-limit';

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
        expect(countersOf('search', { userId: 'u1', ip: '10.0.0.1' }).map((c) => c.key)).toEqual([
            'search:u:u1',
            'search:ip:10.0.0.1'
        ]);
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

    it('lets the request through when the counter cannot be reached, and says so in the log', async () => {
        const down: RateLimiter = { hit: () => Promise.reject(new Error('ECONNREFUSED')) };
        const guard = new RateLimitGuard(new Reflector(), down, logger);
        await expect(asCaller('u1', '10.0.0.1', () => guard.canActivate(contextOf('reveal')))).resolves.toBe(true);
        expect(logger.error).toHaveBeenCalled();
    });
});
