import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testApp } from '../test-app';
import type { Database } from '../db/database';
import type { Logger } from '../observability/logger';
import { problemOf, ProblemFilter } from './problem.filter';

let app: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
    app = await testApp();
});
afterAll(async () => {
    await app.app.close();
});

const PROBLEM = 'application/problem+json; charset=utf-8';

describe('problem+json', () => {
    it('answers an unknown route with 404 problem+json, the request id as traceId and header', async () => {
        const res = await app.inject({ method: 'GET', url: '/nowhere', headers: { 'accept-language': 'en' } });
        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']).toBe(PROBLEM);
        const body = res.json<Record<string, unknown>>();
        expect(body).toEqual({
            type: 'urn:itrms:problem:not_found',
            title: 'Not found.',
            status: 404,
            code: 'not_found',
            traceId: res.headers['x-request-id']
        });
        // the framework's own wording ("Cannot GET /nowhere") is not passed on
        expect(res.body).not.toContain('Cannot GET');
    });

    it('turns request validation into 422 validation_failed with one entry per bad value', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/test/things',
            payload: { name: 'x', count: 0, items: [{ qty: 1 }, { qty: 'two' }] },
            headers: { 'accept-language': 'en' }
        });
        expect(res.statusCode).toBe(422);
        expect(res.headers['content-type']).toBe(PROBLEM);
        const body = res.json<{
            code: string;
            title: string;
            errors: { path: string; code: string; message: string }[];
        }>();
        expect(body.code).toBe('validation_failed');
        expect(body.title).toBe('Some values are not valid.');
        expect(body.errors.map((e) => e.path)).toEqual(['name', 'count', 'items.1.qty']);
        expect(body.errors.every((e) => e.code && e.message)).toBe(true);
    });

    it('passes a valid body through, inside the request context', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/test/things',
            payload: { name: 'Lorry', count: 2, items: [] },
            headers: { 'x-request-id': 'req-123' }
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toEqual({ ok: true, name: 'Lorry', requestId: 'req-123' });
        expect(res.headers['x-request-id']).toBe('req-123');
    });

    it('reports an AppError with its status, code and detail, the title in the person’s language', async () => {
        const am = await app.inject({ method: 'GET', url: '/test/conflict' });
        expect(am.statusCode).toBe(409);
        expect(am.json()).toMatchObject({
            code: 'stale_version',
            title: 'ሌላ ሰው ይህን መዝገብ ቀይሮታል። መዝገቡን እንደገና ከፍተው ይሞክሩ።',
            detail: 'Version 3 is current.'
        });
        const en = await app.inject({
            method: 'GET',
            url: '/test/conflict',
            headers: { 'accept-language': 'en-GB,en;q=0.8' }
        });
        expect(en.json<{ title: string }>().title).toBe('Someone else changed this record. Reload it and try again.');
        // Wolaytta has no title yet: English, not a key
        const wal = await app.inject({ method: 'GET', url: '/test/conflict', headers: { 'accept-language': 'wal' } });
        expect(wal.json<{ title: string }>().title).toBe('Someone else changed this record. Reload it and try again.');
    });

    it('sets Retry-After on 429', async () => {
        const res = await app.inject({ method: 'GET', url: '/test/limited' });
        expect(res.statusCode).toBe(429);
        expect(res.headers['retry-after']).toBe('30');
    });

    it('answers an unexpected error with 500 and nothing of its internals; the log has the cause, masked', async () => {
        const res = await app.inject({ method: 'GET', url: '/test/boom', headers: { 'accept-language': 'en' } });
        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({
            type: 'urn:itrms:problem:internal_error',
            title: 'Something went wrong. Quote the reference to support.',
            status: 500,
            code: 'internal_error',
            traceId: res.headers['x-request-id']
        });
        expect(res.body).not.toMatch(/hunter2|database|stack/i);
        expect(app.logs()).toContain('postgres://***@db/itrms');
        expect(app.logs()).toContain(`"requestId":"${String(res.headers['x-request-id'])}"`);
    });

    it('keeps the status of framework errors without their wording: malformed JSON, body too large', async () => {
        const bad = await app.inject({
            method: 'POST',
            url: '/test/things',
            payload: '{"name":',
            headers: { 'content-type': 'application/json' }
        });
        expect(bad.statusCode).toBe(400);
        expect(bad.json()).toMatchObject({ code: 'invalid_request' });
        const big = await app.inject({ method: 'POST', url: '/test/things', payload: { name: 'x'.repeat(4096) } });
        expect(big.statusCode).toBe(413);
        expect(big.json()).toMatchObject({ code: 'payload_too_large' });
    });

    it('answers another system’s 4xx as our 500, logged', async () => {
        const res = await app.inject({ method: 'GET', url: '/test/upstream' });
        expect(res.statusCode).toBe(500);
        expect(res.json()).toMatchObject({ code: 'internal_error' });
        expect(app.logs()).toContain('ResponseStatusCodeError');
    });

    it('takes the request id only from a trusted proxy', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/test/context',
            remoteAddress: '203.0.113.9',
            headers: { 'x-request-id': 'chosen-by-client' }
        });
        expect(res.headers['x-request-id']).not.toBe('chosen-by-client');
        expect(res.json()).toMatchObject({ requestId: res.headers['x-request-id'] });
    });

    it('replaces a request id it cannot echo safely', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/test/context',
            headers: { 'x-request-id': 'bad id\n<script>' }
        });
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.json()).toEqual({ requestId: res.headers['x-request-id'], language: 'am' });
    });
});

describe('database refusals', () => {
    it('are 409 for a taken unique key, 404 for a missing reference and 403 for a row-level security check, wrapped or not', () => {
        const unique = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        const rls = Object.assign(new Error('new row violates row-level security policy for table "org_units"'), {
            code: '42501'
        });
        const wrapped = new Error('Failed query: insert …', { cause: rls });
        expect(problemOf(unique, 'en')).toMatchObject({ status: 409, code: 'duplicate_reference' });
        expect(problemOf(wrapped, 'en')).toMatchObject({ status: 403, code: 'forbidden' });
        expect(problemOf(wrapped, 'en')).not.toHaveProperty('detail');
        const grant = Object.assign(new Error('permission denied for table org_units'), { code: '42501' });
        expect(problemOf(grant, 'en')).toMatchObject({ status: 500, code: 'internal_error' });
        const off = Object.assign(new Error('query would be affected by row-level security policy for table "x"'), {
            code: '42501'
        });
        expect(problemOf(off, 'en')).toMatchObject({ status: 500 });
        const missing = Object.assign(new Error('unit not found'), { code: '23503' });
        expect(problemOf(missing, 'en')).toMatchObject({ status: 404, code: 'not_found' });
    });

    it('record a row-level security refusal as a denial, like a guard refusal', async () => {
        const events: { type: string; data?: unknown }[] = [];
        const database = {
            recordSensitiveEvent: (_ctx: unknown, event: { type: string; data?: unknown }) =>
                Promise.resolve(void events.push(event))
        } as unknown as Database;
        const logger = { error: () => undefined } as unknown as Logger;
        const filter = new ProblemFilter(logger, database) as unknown as {
            recordDenial(error: unknown, route: string): Promise<void>;
        };
        const rls = Object.assign(new Error('new row violates row-level security policy for table "org_units"'), {
            code: '42501'
        });
        await filter.recordDenial(new Error('Failed query: update …', { cause: rls }), 'POST /api/v1/org-units');
        expect(events).toEqual([
            { type: 'access.denied', data: { route: 'POST /api/v1/org-units', reason: 'row_level_security' } }
        ]);
    });
});
