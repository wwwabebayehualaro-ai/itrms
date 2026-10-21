import { Writable } from 'node:stream';

import { createHttpApp, createLogger, createWorkerContext, Metrics } from '@itrms/kernel/api';
import { loadConfig } from '@itrms/kernel/config';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app.module';

const quiet = new Writable({ write: (_chunk, _encoding, callback) => callback() });

describe('the API', () => {
    it('starts as the HTTP process, answers health and an unknown route as problem+json', async () => {
        const config = loadConfig('http', {});
        const logger = createLogger(config, quiet);
        const app = await createHttpApp(AppModule.forRoot(config, logger), config, logger);
        await app.listen({ port: 0, host: '127.0.0.1' });
        try {
            const base = await app.getUrl();
            const health = await fetch(`${base}/healthz`);
            expect(health.status).toBe(200);
            expect(health.headers.get('x-request-id')).toBeTruthy();
            const missing = await fetch(`${base}/no-such-route`, { headers: { 'accept-language': 'en' } });
            expect(missing.status).toBe(404);
            expect(missing.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
            expect(await missing.json()).toMatchObject({ code: 'not_found', status: 404, title: 'Not found.' });
        } finally {
            await app.close();
        }
    });

    it('starts as the worker, with the same modules and no HTTP server', async () => {
        const config = loadConfig('worker', {});
        const logger = createLogger(config, quiet);
        const context = await createWorkerContext(AppModule.forRoot(config, logger), logger);
        try {
            expect(context.get(Metrics)).toBeInstanceOf(Metrics);
            expect('getHttpAdapter' in context).toBe(false);
        } finally {
            await context.close();
        }
    });
});
