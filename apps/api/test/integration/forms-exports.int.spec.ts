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
import { S3ObjectStore } from '@itrms/integrations/api';
import { purgeExpiredUploads } from '@itrms/kernel/api/worker';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/** What the worker does when the outbox relays the event. */
const runWorker = (exportId: string) =>
    formsHandlers(system, { database: app, store })['submission-export.requested.v1']?.({
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
            error: expect.stringMatching(/unknown field "nope"/) as unknown
        });
        expect((await download(as.damotHead(), id)).statusCode).toBe(404);
    });

    it('is purged with the other unlinked files once its week is up', async () => {
        const removed = await purgeExpiredUploads(system, store, { now: Date.now() + 8 * 86_400_000 });
        expect(removed).toBeGreaterThanOrEqual(2);
        expect((await job(as.damotHead(), exportId)).json<Job>().status).toBe('expired');
        expect((await download(as.damotHead(), exportId)).statusCode).toBe(404);
    });
});
