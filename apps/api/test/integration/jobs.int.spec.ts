/**
 * Numbering, idempotency and the outbox (task 0.11), on a real PostgreSQL 16 and a real Valkey:
 *   - 50 parallel issuers get 50 consecutive numbers; a rolled-back transaction leaves no gap;
 *   - a replayed POST gets the first response; another body with the key gets 422; a key in use gets 409;
 *   - a relay that dies after enqueueing replays without duplicates; a handler done is never run again;
 *   - an event whose job was lost (Valkey flushed, a worker died) is sent again by the sweep and handled.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { Module, type DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHttpApp, createLogger, KernelModule } from '@itrms/kernel/api';
import {
    handleOutboxJob,
    markDead,
    relayOnce,
    startJobs,
    sweepStuck,
    type JobQueue,
    type OutboxJob
} from '@itrms/kernel/api/worker';
import { loadConfig } from '@itrms/kernel/config';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import type { Authenticator, Principal } from '@itrms/kernel/iam';
import { nextNumber, setUpCounter } from '@itrms/kernel/numbering';
import { findUnitByCode, importOrg, orgUnits, parseOrgYaml, type OrgUnit } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import { contextFor } from '@itrms/kernel/testing';
import { Queue } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', '..', 'seed', 'org', 'south-ethiopia.wolaita.yaml');
// the image of the dev stack's queues (infra/compose/docker-compose.yml)
const VALKEY = 'valkey/valkey:8.1.10-alpine3.24';

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let app: Database;
let system: SystemDatabase;
let boditi: OrgUnit;
let damot: OrgUnit;
let zone: OrgUnit;
const quiet = new Writable({ write: (_c, _e, done) => done() });

async function unitAt(code: string): Promise<OrgUnit> {
    return installer.scoped({}, async (tx) => {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, 'SER')));
        const found = root && (await findUnitByCode(tx, root.id, code));
        if (!found) throw new Error(`no unit ${code}`);
        return found;
    });
}

const statusOf = async (id: string) =>
    (await owner.query<{ status: string }>('select status from kernel.outbox_events where id = $1', [id])).rows[0]
        ?.status;

beforeAll(async () => {
    pg = await startPostgres();
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    installer = createDatabase(pg.url('owner'));
    app = createDatabase(pg.url('app'));
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    await installer.scoped({}, (tx) => importOrg(tx, parseOrgYaml(readFileSync(SEED, 'utf8'))));
    [boditi, damot, zone] = await Promise.all([unitAt('WOL-BODITI'), unitAt('WOL-DAMOT-GALE'), unitAt('WOL')]);
    // the org import's own events (identity sync) are not this test's
    await owner.query("update kernel.outbox_events set status = 'done'");
}, 240_000);

afterAll(async () => {
    await system?.close();
    await app?.close();
    await installer?.close();
    await owner?.end();
    await pg?.stop();
});

describe('numbering (architecture.md §15)', () => {
    beforeAll(async () => {
        await installer.scoped({}, (tx) =>
            setUpCounter(tx, {
                key: 'fees.receipt',
                unitId: boditi.id,
                regionId: boditi.regionId,
                pattern: '{unit}/{seq:06}/{efy}',
                startAfter: 41n
            })
        );
    });

    it('gives 50 parallel issuers 50 consecutive numbers, after the migrated ones', async () => {
        const issued = await Promise.all(
            Array.from({ length: 50 }, () =>
                app.scoped(contextFor(boditi), (tx) => nextNumber(tx, 'fees.receipt', boditi.id))
            )
        );
        const values = issued.map((n) => Number(n.value)).sort((a, b) => a - b);
        expect(values).toEqual(Array.from({ length: 50 }, (_, i) => 42 + i));
        expect(issued.find((n) => n.value === 42n)?.number).toMatch(/^WOL-BODITI\/000042\/\d{4}$/);
    });

    it('leaves no gap when a transaction rolls back, and never lowers a counter', async () => {
        const failed = app.scoped(contextFor(boditi), async (tx) => {
            await nextNumber(tx, 'fees.receipt', boditi.id);
            throw new Error('the receipt was not saved');
        });
        await expect(failed).rejects.toThrow('the receipt was not saved');
        const next = await app.scoped(contextFor(boditi), (tx) => nextNumber(tx, 'fees.receipt', boditi.id));
        expect(next.value).toBe(92n);
        await installer.scoped({}, (tx) =>
            setUpCounter(tx, {
                key: 'fees.receipt',
                unitId: boditi.id,
                regionId: boditi.regionId,
                pattern: '{unit}/{seq:06}/{efy}',
                startAfter: 10n
            })
        );
        expect((await app.scoped(contextFor(boditi), (tx) => nextNumber(tx, 'fees.receipt', boditi.id))).value).toBe(
            93n
        );
    });

    it('lets request code move a counter only one number forward, and nobody move it back', async () => {
        const back = app.scoped(contextFor(boditi), (tx) =>
            tx.execute(sql`update kernel.number_counters set last_value = 1 where unit_id = ${boditi.id}`)
        );
        await expect(back).rejects.toMatchObject({ cause: { code: '23514' } });
        const jump = app.scoped(contextFor(boditi), (tx) =>
            tx.execute(sql`update kernel.number_counters set last_value = last_value + 5 where unit_id = ${boditi.id}`)
        );
        await expect(jump).rejects.toMatchObject({ cause: { code: '23514' } });
        await expect(
            owner.query('update kernel.number_counters set last_value = 0 where unit_id = $1', [boditi.id])
        ).rejects.toMatchObject({ code: '23514' });
    });

    it("keeps a unit's counter to its scope", async () => {
        await expect(
            app.scoped(contextFor(damot), (tx) => nextNumber(tx, 'fees.receipt', boditi.id))
        ).rejects.toMatchObject({ status: 409, code: 'not_configured' });
    });
});

describe('idempotent POSTs (architecture.md §15)', () => {
    let http: NestFastifyApplication;
    let principal: Principal;

    beforeAll(async () => {
        principal = {
            userId: '0199f0a0-0000-7000-8000-0000000000bb',
            unitId: zone.id,
            regionId: zone.regionId,
            scopePath: zone.path,
            roles: ['unit_admin'],
            permissions: new Set(['org-unit:read', 'org-unit:create', 'job:read', 'job:retry'])
        };
        const authenticator: Authenticator = { authenticate: () => Promise.resolve(principal) };
        const config = loadConfig('http', { DATABASE_URL: pg.url('app') });
        const logger = createLogger(config, quiet);
        @Module({})
        class Root {
            static forRoot(): DynamicModule {
                const database = createDatabase(config.DATABASE_URL);
                return { module: Root, imports: [KernelModule.forRoot(config, logger, { database, authenticator })] };
            }
        }
        http = await createHttpApp(Root.forRoot(), config, logger);
        await http.init();
        await http.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
        await http?.close();
    });

    const post = (url: string, body: object, key?: string) =>
        http
            .getHttpAdapter()
            .getInstance()
            .inject({ method: 'POST', url, payload: body, headers: key ? { 'idempotency-key': key } : {} });
    const town = (code: string) => ({
        parentId: zone.id,
        kind: 'town_admin',
        levelKey: 'town',
        code,
        name: { am: 'ከተማ', en: 'Town' }
    });

    it('asks every POST for a key', async () => {
        const res = await post('/api/v1/org-units', town('WOL-NO-KEY'));
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ code: 'invalid_request' });
    });

    it('answers a replay with the first response, writes once, and records the event once', async () => {
        const key = randomUUID();
        const first = await post('/api/v1/org-units', town('WOL-IDEM-1'), key);
        expect(first.statusCode).toBe(201);
        const again = await post('/api/v1/org-units', town('WOL-IDEM-1'), key);
        expect(again.statusCode).toBe(201);
        expect(again.headers['idempotent-replayed']).toBe('true');
        expect(again.json()).toEqual(first.json());
        const { rows } = await owner.query("select count(*)::int as n from kernel.org_units where code = 'WOL-IDEM-1'");
        expect(rows[0]).toEqual({ n: 1 });
        const events = await owner.query(
            "select count(*)::int as n from kernel.outbox_events where type = 'org-unit.changed.v1' and payload->>'unitId' = $1",
            [first.json<{ id: string }>().id]
        );
        expect(events.rows[0]).toEqual({ n: 1 });
    });

    it('refuses the key with another request (422), and while the first still runs (409)', async () => {
        const key = randomUUID();
        expect((await post('/api/v1/org-units', town('WOL-IDEM-2'), key)).statusCode).toBe(201);
        const other = await post('/api/v1/org-units', town('WOL-IDEM-3'), key);
        expect(other.statusCode).toBe(422);
        expect(other.json()).toMatchObject({ code: 'idempotency_mismatch' });

        // the first request with this key holds its lock (here: another session holds it)
        const busy = randomUUID();
        const lockKey = JSON.stringify([principal.userId, principal.unitId, 'POST', '/api/v1/org-units', busy]);
        // the idempotency locks' namespace (LOCK_NAMESPACE in @itrms/kernel's idempotency module)
        await owner.query('select pg_advisory_lock(7652, hashtext($1))', [lockKey]);
        try {
            const second = await post('/api/v1/org-units', town('WOL-IDEM-4'), busy);
            expect(second.statusCode).toBe(409);
            expect(second.json()).toMatchObject({ code: 'idempotency_in_progress' });
        } finally {
            await owner.query('select pg_advisory_unlock(7652, hashtext($1))', [lockKey]);
        }
    });

    it('keeps nothing for a request that failed: the corrected one may use the key', async () => {
        const key = randomUUID();
        const bad = await post('/api/v1/org-units', { ...town('WOL-IDEM-5'), levelKey: 'region' }, key);
        expect(bad.statusCode).toBe(422);
        expect((await post('/api/v1/org-units', town('WOL-IDEM-5'), key)).statusCode).toBe(201);
    });

    it('lists the dead events of the scope for an administrator, and sends one back', async () => {
        const dead = await app.scoped(contextFor(boditi), (tx) =>
            emit(tx, 'test-item.failed.v1', { reason: 'gone for good' })
        );
        await markDead(system, dead.id, 'the provider refused it');
        const list = await http.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/api/v1/admin/jobs' });
        expect(list.json()).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: dead.id, lastError: 'the provider refused it' })])
        );
        const retried = await post(`/api/v1/admin/jobs/${dead.id}/retries`, {}, randomUUID());
        expect(retried.statusCode).toBe(202);
        expect(await statusOf(dead.id)).toBe('pending');
        await owner.query("update kernel.outbox_events set status = 'done' where id = $1", [dead.id]);
    });
});

/** A queue like BullMQ's: an add whose jobId exists does nothing. */
function fakeQueue(failAfter?: number) {
    const jobs = new Map<string, OutboxJob>();
    let adds = 0;
    const queue: JobQueue = {
        add(_name, data, jobId) {
            adds++;
            if (failAfter !== undefined && adds > failAfter) return Promise.reject(new Error('the relay died'));
            if (!jobs.has(jobId)) jobs.set(jobId, data);
            return Promise.resolve();
        }
    };
    return { queue, jobs, adds: () => adds };
}

describe('the outbox (architecture.md §12)', () => {
    // each test counts its own events: those of earlier tests (units created over HTTP emit one each) are done
    beforeEach(async () => {
        await owner.query("update kernel.outbox_events set status = 'done' where status <> 'done'");
    });

    const emitTwo = () =>
        app.scoped(contextFor(boditi), async (tx) => [
            await emit(tx, 'test-item.created.v1', { n: 1 }),
            await emit(tx, 'test-item.created.v1', { n: 2 })
        ]);

    it('writes events only with their transaction', async () => {
        const failed = app.scoped(contextFor(boditi), async (tx) => {
            await emit(tx, 'test-item.created.v1', { n: 0 });
            throw new Error('rolled back');
        });
        await expect(failed).rejects.toThrow('rolled back');
        const { rows } = await owner.query(
            "select count(*)::int as n from kernel.outbox_events where payload->>'n' = '0'"
        );
        expect(rows[0]).toEqual({ n: 0 });
    });

    it('replays a relay that died after enqueueing, without duplicates', async () => {
        const events = await emitTwo();
        const crashing = fakeQueue(1);
        await expect(relayOnce(system, crashing.queue)).rejects.toThrow('the relay died');
        // the queue took one job, the database still has both pending
        expect(crashing.jobs.size).toBe(1);
        for (const e of events) expect(await statusOf(e.id)).toBe('pending');

        const sharedJobs = crashing.jobs;
        const again: JobQueue = {
            add: (_name, data, jobId) => {
                if (!sharedJobs.has(jobId)) sharedJobs.set(jobId, data);
                return Promise.resolve();
            }
        };
        expect(await relayOnce(system, again)).toBe(2);
        expect([...sharedJobs.keys()].sort()).toEqual(events.map((e) => e.id).sort());
        for (const e of events) expect(await statusOf(e.id)).toBe('enqueued');

        // handlers run once to completion; a redelivered job is skipped
        let runs = 0;
        const handlers = { 'test-item.created.v1': () => Promise.resolve(void runs++) };
        for (const job of sharedJobs.values()) expect(await handleOutboxJob(system, handlers, job)).toBe('done');
        for (const job of sharedJobs.values()) expect(await handleOutboxJob(system, handlers, job)).toBe('skipped');
        expect(runs).toBe(2);
    });

    it('sends back events whose job was lost, and keeps a failing one for its retries', async () => {
        const [e] = await emitTwo();
        const lost = fakeQueue();
        await relayOnce(system, lost.queue);
        // the job vanished (Valkey flushed, a worker died): nothing happens until the sweep
        lost.jobs.clear();
        await owner.query(
            "update kernel.outbox_events set enqueued_at = now() - interval '10 minutes' where status = 'enqueued'"
        );
        expect(await sweepStuck(system, 300)).toBeGreaterThanOrEqual(1);
        expect(await statusOf(e?.id ?? '')).toBe('pending');
        await relayOnce(system, lost.queue);
        expect(lost.jobs.has(e?.id ?? '')).toBe(true);

        const failing = { 'test-item.created.v1': () => Promise.reject(new Error('the provider is down')) };
        const job = lost.jobs.get(e?.id ?? '');
        if (!job) throw new Error('no job');
        await expect(handleOutboxJob(system, failing, job)).rejects.toThrow('the provider is down');
        expect(await statusOf(job.eventId)).toBe('enqueued');
        await owner.query("update kernel.outbox_events set status = 'done' where status <> 'done'");
    });
});

describe('the outbox on Valkey (BullMQ)', () => {
    let valkey: StartedTestContainer;
    let connection: { host: string; port: number; maxRetriesPerRequest: null };

    beforeAll(async () => {
        valkey = await new GenericContainer(VALKEY)
            .withCommand(['valkey-server', '--appendonly', 'yes', '--maxmemory-policy', 'noeviction'])
            .withExposedPorts(6379)
            .start();
        connection = { host: valkey.getHost(), port: valkey.getMappedPort(6379), maxRetriesPerRequest: null };
    }, 120_000);

    afterAll(async () => {
        await valkey?.stop();
    });

    const waitFor = async (check: () => Promise<boolean>, ms = 20_000) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (await check()) return;
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error('timed out');
    };

    it('ignores a jobId added twice, so a replayed relay runs nothing twice', async () => {
        const queue = new Queue<OutboxJob>('dedupe-check', { connection });
        try {
            const job = { eventId: randomUUID(), type: 'test-item.created.v1', payload: {} };
            await queue.add(job.type, job, { jobId: job.eventId });
            await queue.add(job.type, job, { jobId: job.eventId });
            expect(await queue.count()).toBe(1);
        } finally {
            await queue.close();
        }
    });

    it('marks an event dead after its last retry, and runs it again when an administrator sends it back', async () => {
        await owner.query("update kernel.outbox_events set status = 'done' where status <> 'done'");
        const e = await app.scoped(contextFor(boditi), (tx) => emit(tx, 'test-item.retried.v1', { n: 1 }));
        let failing = true;
        let handled = 0;
        const logger = createLogger(loadConfig('worker', { DATABASE_URL: pg.url('app') }), quiet);
        const jobs = startJobs({
            connection,
            system,
            logger,
            handlers: {
                'test-item.retried.v1': () =>
                    failing ? Promise.reject(new Error('the provider is down')) : Promise.resolve(void handled++)
            },
            relayEveryMs: 200,
            sweepEveryMs: 60_000,
            jobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 50 }, removeOnFail: { age: 3600 } }
        });
        try {
            await waitFor(async () => (await statusOf(e.id)) === 'dead');
            // the failed job is still in Valkey under the event's id: the retry must not be swallowed by it
            failing = false;
            await owner.query("update kernel.outbox_events set status = 'pending', attempts = 0 where id = $1", [e.id]);
            await waitFor(async () => (await statusOf(e.id)) === 'done');
            expect(handled).toBe(1);
        } finally {
            await jobs.stop();
        }
    }, 60_000);

    it('loses no event when Valkey is flushed: the sweep sends it again and the worker handles it', async () => {
        const [e] = await app.scoped(contextFor(boditi), async (tx) => [
            await emit(tx, 'test-item.created.v1', { n: 9 })
        ]);
        if (!e) throw new Error('no event');
        // relayed into Valkey, then everything in Valkey is lost
        const queue = new Queue<OutboxJob>('outbox', { connection });
        await relayOnce(system, {
            add: async (name, data, jobId) => {
                await queue.add(name, data, { jobId });
            }
        });
        await queue.close();
        const redis = new Redis(connection);
        await redis.flushall();
        await redis.quit();
        expect(await statusOf(e.id)).toBe('enqueued');

        let handled = 0;
        const logger = createLogger(loadConfig('worker', { DATABASE_URL: pg.url('app') }), quiet);
        const jobs = startJobs({
            connection,
            system,
            logger,
            handlers: { 'test-item.created.v1': () => Promise.resolve(void handled++) },
            relayEveryMs: 200,
            sweepEveryMs: 200
        });
        try {
            // the sweep's threshold is minutes; here the event is made old enough at once
            await owner.query("update kernel.outbox_events set enqueued_at = now() - interval '1 hour' where id = $1", [
                e.id
            ]);
            await waitFor(async () => (await statusOf(e.id)) === 'done');
            expect(handled).toBe(1);
        } finally {
            await jobs.stop();
        }
    }, 60_000);
});
