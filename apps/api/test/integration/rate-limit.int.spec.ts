/**
 * The rate limits' counter on a real Valkey (SEC-AP-2): a fixed window per key that every API replica shares, with its
 * expiry set once by the window's first request, so a busy key never lives forever.
 */
import { randomUUID } from 'node:crypto';

import { ValkeyRateLimiter } from '@itrms/kernel/limits';
import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const VALKEY = 'valkey/valkey:8.1.10-alpine3.24';

describe('rate limits on Valkey', () => {
    let valkey: StartedTestContainer;
    let redis: Redis;

    beforeAll(async () => {
        valkey = await new GenericContainer(VALKEY).withExposedPorts(6379).start();
        redis = new Redis({ host: valkey.getHost(), port: valkey.getMappedPort(6379), maxRetriesPerRequest: 1 });
    }, 120_000);

    afterAll(async () => {
        redis?.disconnect();
        await valkey?.stop();
    });

    it('counts a window shared by two API processes, and its expiry is set once', async () => {
        const key = `search:u:${randomUUID()}`;
        const a = new ValkeyRateLimiter(redis);
        const b = new ValkeyRateLimiter(redis);
        expect((await a.hit(key, 60)).count).toBe(1);
        expect((await b.hit(key, 60)).count).toBe(2);
        const third = await a.hit(key, 60);
        expect(third.count).toBe(3);
        expect(third.resetsIn).toBeGreaterThan(0);
        expect(third.resetsIn).toBeLessThanOrEqual(60);
        // the expiry is the first request's: later requests do not push it out
        expect(await redis.ttl(`itrms:rl:${key}`)).toBeLessThanOrEqual(60);
    });

    it('starts a new window when the old one expires', async () => {
        const key = `reveal:u:${randomUUID()}`;
        const limiter = new ValkeyRateLimiter(redis);
        await limiter.hit(key, 1);
        await limiter.hit(key, 1);
        await new Promise((r) => setTimeout(r, 1_500));
        expect((await limiter.hit(key, 1)).count).toBe(1);
    });
});
