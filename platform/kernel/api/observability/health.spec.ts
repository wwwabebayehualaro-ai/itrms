import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testApp } from '../test-app';
import { ReadinessRegistry } from './health';

let app: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
    app = await testApp();
});
afterAll(async () => {
    await app.app.close();
});

describe('health', () => {
    it('is alive without checking any dependency', async () => {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok' });
    });

    it('is ready while every readiness check passes, and 503 when one fails or hangs', async () => {
        const readiness = app.app.get(ReadinessRegistry);
        expect((await app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({ status: 'ok', checks: {} });

        readiness.register('database', () => Promise.resolve());
        readiness.register('valkey', () => Promise.reject(new Error('connection refused')));
        const res = await app.inject({ method: 'GET', url: '/readyz' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ status: 'unavailable', checks: { database: 'ok', valkey: 'failed' } });
        expect(res.body).not.toContain('connection refused');
    });

    it('times a hanging check out', async () => {
        const registry = new ReadinessRegistry();
        registry.register('slow', () => new Promise(() => undefined));
        const started = Date.now();
        expect(await registry.run()).toEqual({ ready: false, checks: { slow: 'failed' } });
        expect(Date.now() - started).toBeLessThan(3000);
    });

    it('exposes request metrics by route template, not raw path', async () => {
        await app.inject({ method: 'GET', url: '/healthz' });
        await app.inject({ method: 'GET', url: '/no/such/page' });
        const res = await app.inject({ method: 'GET', url: '/metrics' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.body).toMatch(/http_server_requests_total\{[^}]*route="\/healthz"[^}]*status="200"[^}]*\} \d+/);
        expect(res.body).toContain('route="unmatched"');
        expect(res.body).not.toContain('/no/such/page');
        expect(res.body).toContain('http_server_request_duration_seconds_bucket');
    });
});
