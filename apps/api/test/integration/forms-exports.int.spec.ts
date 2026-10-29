/**
 * Background exports and server-generated files (task 0.16e), over HTTP on a real PostgreSQL 16 and the dev stack's
 * SeaweedFS. An export asked for in the background is made by the worker's handler with the requester's scope and roles,
 * stored as a generated file, followed and downloaded by its requester alone (every download on record), and purged with
 * the other unlinked files once its week is up. A refusal the person can act on fails the export with its reason.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';
import { formsHandlers } from '@itrms/forms/api/worker';
import { SettingsService } from '@itrms/kernel/settings';
import { loadSlices } from '@itrms/kernel/api';
import { permissionsOf, rolePermissions } from '@itrms/kernel/iam';
import { S3ObjectStore } from '@itrms/integrations/api';
import { purgeExpiredUploads } from '@itrms/kernel/api/worker';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SLICES } from '../../src/slices';
import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const envFile = join(HERE, '..', '..', '..', '..', 'infra', 'compose', '.env');
if (!process.env.S3_ACCESS_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const S3 = {
    endpoint: process.env.S3_ENDPOINT ?? `http://127.0.0.1:${process.env.S3_HOST_PORT ?? '18333'}`,
    bucket: process.env.S3_BUCKET ?? 'itrms-test',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? ''
};

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000f401',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damot: '0199f0a0-d000-7000-8000-000000000202',
    damotHead: '0199f0a0-d000-7000-8000-00000000f402'
};

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let app: Database;
let store: S3ObjectStore;
const units = {} as Record<'ser' | 'zone' | 'damot', OrgUnit>;
const as = {
    bureau: (): As => ({ sub: SUB.bureau, unit: units.ser }),
    bureau2: (): As => ({ sub: SUB.bureau2, unit: units.ser }),
    zoneHead: (): As => ({ sub: SUB.zoneHead, unit: units.zone }),
    damot: (): As => ({ sub: SUB.damot, unit: units.damot }),
    damotHead: (): As => ({ sub: SUB.damotHead, unit: units.damot })
};
let form = { id: '', versionId: '' };

interface Job {
    id: string;
    status: string;
    rows: number | null;
    errorCode: string | null;
    error: string | null;
    keptUntil: string | null;
}

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    ...extra
});

const catalogue = rolePermissions(loadSlices(SLICES).manifests);

/** What the worker does when the outbox relays the event. */
const runWorker = (exportId: string, maxBytes?: number) =>
    formsHandlers(system, {
        database: app,
        store,
        permissionsOf: (roles) => permissionsOf(catalogue, roles),
        maxBytes,
        // the region's export limits, as the worker reads them (task 0.21a)
        settings: api.http.get(SettingsService)
    })['submission-export.requested.v1']?.({
        eventId: randomUUID(),
        type: 'submission-export.requested.v1',
        payload: { exportId }
    });

const ask = (who: As, body: object = {}) =>
    api.call('POST', '/api/v1/submission-exports', who, { formId: form.id, ...body });
const job = async (who: As, id: string) => api.call('GET', `/api/v1/submission-exports/${id}`, who);
const download = (who: As, id: string) => api.call('POST', `/api/v1/submission-exports/${id}/download`, who, {});

beforeAll(async () => {
    if (!S3.accessKeyId || !S3.secretAccessKey) throw new Error('S3 credentials missing: run pnpm dev:infra first');
    pg = await startPostgres();
    store = new S3ObjectStore({ ...S3 });
    api = await startApi(
        pg,
        [
            {
                username: 'test.bureau.admin2',
                sub: SUB.bureau2,
                region: 'SER',
                home: 'SER',
                roles: [['SER', 'bureau_admin']]
            },
            {
                username: 'test.damot.head.records',
                sub: SUB.damotHead,
                region: 'SER',
                home: 'WOL-DAMOT-GALE',
                roles: [
                    ['WOL-DAMOT-GALE', 'unit_head'],
                    ['WOL-DAMOT-GALE', 'records_officer']
                ]
            }
        ],
        { objectStore: store }
    );
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    app = createDatabase(pg.url('app'));
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');

    const created = await api.call('POST', '/api/v1/forms', as.bureau(), {
        key: 'inspections',
        name: { am: 'ምርመራ', en: 'Inspections' },
        document: {
            fields: [field('plate', 'InputText', { label: 'Plate' }), field('remark', 'InputText', { label: 'Remark' })]
        }
    });
    const id = created.json<{ id: string }>().id;
    const asked = (await api.call('POST', `/api/v1/forms/${id}/publications`, as.bureau(), {})).json<{
        id: string;
        version: number;
        formVersion: { id: string };
    }>();
    await api.call(
        'POST',
        `/api/v1/form-publications/${asked.id}/approval`,
        as.bureau2(),
        {},
        {
            'if-match': `"${asked.version}"`
        }
    );
    form = { id, versionId: asked.formVersion.id };
    for (const [plate, remark] of [
        ['ETH ABC 0001', 'ok'],
        ['ETH ABC 0002', '=cmd|calc'],
        ['ETH ABC 0003', 'ok']
    ])
        await api.call('POST', '/api/v1/submissions', as.damot(), {
            formId: form.id,
            formVersionId: form.versionId,
            answers: { plate, remark }
        });
}, 240_000);

afterAll(async () => {
    await app?.close();
    await system?.close();
    await api?.close();
    await pg?.stop();
});

/** The notices about an export (task 0.20b): who was told what. */
const notices = async (exportId: string) =>
    (
        await api.owner.query<{ message_key: string; user_id: string; rows: string | null }>(
            `select message_key, user_id, params ->> 'rows' as rows from kernel.notifications
              where link ->> 'exportId' = $1 order by created_at`,
            [exportId]
        )
    ).rows;

describe('a background export', () => {
    let exportId = '';

    it('is queued for its requester, and only they follow it', async () => {
        const asked = await ask(as.damotHead(), { sort: [{ field: 'plate' }] });
        expect(asked.statusCode, asked.body).toBe(202);
        exportId = asked.json<Job>().id;
        expect(asked.json<Job>()).toMatchObject({ status: 'queued', rows: null });
        expect((await job(as.damotHead(), exportId)).json<Job>().status).toBe('queued');
        // not even the zone's head (who may export, and reads the unit's rows) sees someone else's export
        expect((await job(as.zoneHead(), exportId)).statusCode).toBe(404);
        // a records officer may not export at all
        expect((await ask(as.damot())).statusCode).toBe(403);
    });

    it('is made by the worker as its requester, stored as a generated file, and downloaded by them alone', async () => {
        await runWorker(exportId);
        const done = (await job(as.damotHead(), exportId)).json<Job>();
        expect(done).toMatchObject({ status: 'done', rows: 3, error: null });
        const kept = Date.parse(done.keptUntil ?? '') - Date.now();
        expect(kept).toBeGreaterThan(6.9 * 86_400_000);
        expect(kept).toBeLessThan(7.1 * 86_400_000);
        // again (a second delivery of the event): nothing changes
        await runWorker(exportId);
        expect((await job(as.damotHead(), exportId)).json<Job>().rows).toBe(3);
        // its requester is told once that it is ready (task 0.20b), whatever the deliveries
        expect(await notices(exportId)).toEqual([
            { message_key: 'forms.notify.export-ready', user_id: await api.userId(SUB.damotHead), rows: '3' }
        ]);

        expect((await download(as.zoneHead(), exportId)).statusCode).toBe(404);
        const link = await download(as.damotHead(), exportId);
        expect(link.statusCode, link.body).toBe(200);
        const got = await fetch(link.json<{ url: string }>().url);
        expect(got.status).toBe(200);
        const csv = (await got.text()).replace(String.fromCharCode(0xfeff), '');
        expect(csv.split('\r\n')[0]).toBe('"Submitted","Submitted by","Office","Plate","Remark"');
        expect(csv).toContain(`"'=cmd|calc"`);
        expect(csv.match(/ETH ABC 000\d/g)).toEqual(['ETH ABC 0001', 'ETH ABC 0002', 'ETH ABC 0003']);

        const file = await api.owner.query<{ origin: string; content_type: string; status: string; unit_id: string }>(
            `select f.origin, f.content_type, f.status, f.unit_id from kernel.files f
               join forms.submission_exports e on e.file_id = f.id where e.id = $1`,
            [exportId]
        );
        expect(file.rows[0]).toEqual({
            origin: 'generated',
            content_type: 'text/csv',
            status: 'stored',
            unit_id: units.damot.id
        });
        const events = await api.owner.query<{ event_type: string; diff: Record<string, unknown> }>(
            `select event_type, diff from kernel.audit_log
              where event_type in ('submissions.exported', 'submissions.export_downloaded', 'file.downloaded') order by at`
        );
        expect(events.rows.map((e) => e.event_type)).toEqual([
            'submissions.exported',
            'file.downloaded',
            'submissions.export_downloaded'
        ]);
        expect(events.rows[0]?.diff).toMatchObject({
            background: true,
            rows: 3,
            fieldKeys: expect.arrayContaining(['plate']) as unknown
        });
    });

    it('as an Excel workbook too', async () => {
        const id = (await ask(as.damotHead(), { format: 'xlsx', fields: ['plate', 'remark'] })).json<Job>().id;
        await runWorker(id);
        const got = await fetch((await download(as.damotHead(), id)).json<{ url: string }>().url);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await got.arrayBuffer());
        const sheet = workbook.worksheets[0];
        expect(sheet?.name).toBe('Inspections');
        expect((sheet?.getRow(1).values as unknown[]).slice(1)).toEqual(['Plate', 'Remark']);
        expect(sheet?.rowCount).toBe(4);
    });

    it('fails with its reason when the person can act on it', async () => {
        const id = (await ask(as.damotHead(), { fields: ['nope'] })).json<Job>().id;
        await runWorker(id);
        expect((await job(as.damotHead(), id)).json<Job>()).toMatchObject({
            status: 'failed',
            errorCode: 'invalid_query',
            error: expect.stringMatching(/unknown field "nope"/) as unknown
        });
        expect((await download(as.damotHead(), id)).statusCode).toBe(404);
        expect((await notices(id)).map((n) => n.message_key)).toEqual(['forms.notify.export-failed']);
    });

    it("is its requester's file alone, through the kernel's file routes too", async () => {
        const [row] = (
            await api.owner.query<{ file_id: string }>('select file_id from forms.submission_exports where id = $1', [
                exportId
            ])
        ).rows;
        const fileId = row?.file_id ?? '';
        expect((await api.call('GET', `/api/v1/files/${fileId}`, as.damotHead())).statusCode).toBe(200);
        // the zone's head and the unit's records officer may read the unit's files, not someone's export
        for (const other of [as.zoneHead(), as.damot()]) {
            expect((await api.call('GET', `/api/v1/files/${fileId}`, other)).statusCode).toBe(404);
            expect((await api.call('POST', `/api/v1/files/${fileId}/download`, other, {})).statusCode).toBe(404);
        }
    });

    it('fails with too_large when its file would pass the limit, leaving no object behind', async () => {
        const id = (await ask(as.damotHead())).json<Job>().id;
        await runWorker(id, 100);
        expect((await job(as.damotHead(), id)).json<Job>()).toMatchObject({ status: 'failed', errorCode: 'too_large' });
        const owned = new Set(
            (await api.owner.query<{ object_key: string }>('select object_key from kernel.files')).rows.map(
                (r) => r.object_key
            )
        );
        const objects = await store.listObjects(`files/${units.damot.regionId}/`);
        expect(objects.filter((o) => !owned.has(o.key))).toEqual([]);
    });

    it('is made once when it is delivered twice at the same time', async () => {
        const id = (await ask(as.damotHead())).json<Job>().id;
        await Promise.allSettled([runWorker(id), runWorker(id)]);
        expect((await job(as.damotHead(), id)).json<Job>()).toMatchObject({ status: 'done', rows: 3 });
        const owned = new Set(
            (await api.owner.query<{ object_key: string }>('select object_key from kernel.files')).rows.map(
                (r) => r.object_key
            )
        );
        const objects = await store.listObjects(`files/${units.damot.regionId}/`);
        expect(objects.filter((o) => !owned.has(o.key))).toEqual([]);
    });

    it('runs with the rights its requester holds when it runs', async () => {
        const id = (await ask(as.damotHead())).json<Job>().id;
        // their unit_head role (the one that gives the right to export) ends before the worker gets to it
        await api.owner.query(
            `update kernel.role_assignments set valid_to = now() where role_key = 'unit_head'
               and user_id = (select id from kernel.users where keycloak_sub = $1)`,
            [SUB.damotHead]
        );
        try {
            await runWorker(id);
            // they cannot even follow it now (the right is gone): the job itself says why it ended
            expect((await job(as.damotHead(), id)).statusCode).toBe(403);
            const ended = await api.owner.query<{ status: string; error_code: string; file_id: string | null }>(
                'select status, error_code, file_id from forms.submission_exports where id = $1',
                [id]
            );
            expect(ended.rows[0]).toEqual({ status: 'failed', error_code: 'not_permitted', file_id: null });
        } finally {
            await api.owner.query(
                `update kernel.role_assignments set valid_to = null where role_key = 'unit_head'
                   and user_id = (select id from kernel.users where keycloak_sub = $1)`,
                [SUB.damotHead]
            );
        }
    });

    it('waits its turn: at most two being made per person', async () => {
        const first = await ask(as.damotHead());
        const second = await ask(as.damotHead());
        expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
        const third = await ask(as.damotHead());
        expect(third.statusCode).toBe(429);
        for (const r of [first, second]) await runWorker(r.json<Job>().id);
        expect((await ask(as.damotHead())).statusCode).toBe(202);
    });

    it('is purged with the other unlinked files once its week is up', async () => {
        const [kept] = (
            await api.owner.query<{ object_key: string }>(
                'select f.object_key from kernel.files f join forms.submission_exports e on e.file_id = f.id where e.id = $1',
                [exportId]
            )
        ).rows;
        expect(await store.head(kept?.object_key ?? '')).toBeDefined();
        const removed = await purgeExpiredUploads(system, store, { now: Date.now() + 8 * 86_400_000 });
        // the object itself is gone from the store, not only its row
        expect(await store.head(kept?.object_key ?? '')).toBeUndefined();
        expect(removed).toBeGreaterThanOrEqual(2);
        expect((await job(as.damotHead(), exportId)).json<Job>().status).toBe('expired');
        expect((await download(as.damotHead(), exportId)).statusCode).toBe(404);
    });

    it("keeps its file for the region's number of days (a region setting, task 0.21a)", async () => {
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${units.ser.id}/settings/forms.exports.keepDays`,
            as.bureau(),
            { value: 3 },
            { 'if-match': '"0"' }
        );
        expect(set.statusCode, set.body).toBe(200);
        const id = (await ask(as.damotHead())).json<Job>().id;
        await runWorker(id);
        const done = (await job(as.damotHead(), id)).json<Job>();
        expect(done.status).toBe('done');
        const kept = Date.parse(done.keptUntil ?? '') - Date.now();
        expect(kept).toBeGreaterThan(2.9 * 86_400_000);
        expect(kept).toBeLessThan(3.1 * 86_400_000);
    });
});
