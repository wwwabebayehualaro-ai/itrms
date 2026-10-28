/**
 * Sensitive answers (task 0.20d, SEC-PD-2, SEC-DC-2), on a real PostgreSQL 16: a field classified Sensitive is left out
 * of a submission as the API answers it (one, a list, the data viewer's rows), named in `masked`; it cannot be shown,
 * filtered or exported in the data viewer; its answers come only through the audited reveal, for someone who may reveal
 * personal data and with a reason. A repeating section's Sensitive field goes the same way, row by row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-e400-7000-8000-000000000001',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202'
};

const value = (id: string, classification: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    category: 'Input',
    label: { am: id, en: id },
    classification,
    props: {},
    behavior: { validation: { supported: true } },
    ...extra
});

interface SubmissionOut {
    id: string;
    answers: Record<string, unknown>;
    masked: string[];
}

let pg: TestPostgres;
let api: TestApi;
let formId: string;
let submissionId: string;
const as = {} as Record<keyof typeof SUB, As>;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.sensitive.bureau2',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        }
    ]);
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: await api.unit('SER', 'SER') };
    as.bureau2 = { sub: SUB.bureau2, unit: await api.unit('SER', 'SER') };
    as.zoneAdmin = { sub: SUB.zoneAdmin, unit: await api.unit('SER', 'WOL') };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    const created = await api.call('POST', '/api/v1/forms', as.bureau, {
        key: 'licence-renewal',
        name: { am: 'የፈቃድ እድሳት', en: 'Licence renewal' },
        document: {
            schemaVersion: 2,
            fields: [
                value('applicant', 'personal'),
                value('fin', 'sensitive'),
                {
                    id: 'children',
                    type: 'FormArray',
                    category: 'Layout',
                    label: { am: 'ልጆች', en: 'Children' },
                    classification: 'personal',
                    props: {},
                    layout: { options: { isContainer: true } }
                },
                value('childName', 'personal', { parentId: 'children' }),
                value('childFin', 'sensitive', { parentId: 'children' })
            ]
        }
    });
    expect(created.statusCode, created.body).toBe(201);
    formId = created.json<{ id: string }>().id;
    const asked = (await api.call('POST', `/api/v1/forms/${formId}/publications`, as.bureau, {})).json<{
        id: string;
        version: number;
    }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${asked.id}/approval`,
        as.bureau2,
        {},
        { 'if-match': `"${asked.version}"` }
    );
    expect(approved.statusCode, approved.body).toBe(200);
    const versionId = (await api.call('GET', `/api/v1/forms/${formId}`, as.bureau)).json<{
        publishedVersion: { id: string };
    }>().publishedVersion.id;
    const filed = await api.call('POST', '/api/v1/submissions', as.damotRecords, {
        formId,
        formVersionId: versionId,
        answers: {
            applicant: 'Abebe Kebede',
            fin: '1234 5678 9012',
            children: [{ childName: 'Almaz', childFin: '2222 3333 4444' }]
        }
    });
    expect(filed.statusCode, filed.body).toBe(201);
    submissionId = filed.json<SubmissionOut>().id;
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('a Sensitive answer', () => {
    it('is left out of a submission, a list and the data viewer, and named', async () => {
        const one = (
            await api.call('GET', `/api/v1/submissions/${submissionId}`, as.damotRecords)
        ).json<SubmissionOut>();
        expect(one.answers).toEqual({ applicant: 'Abebe Kebede', children: [{ childName: 'Almaz' }] });
        expect([...one.masked].sort()).toEqual(['childFin', 'fin']);
        const listed = (await api.call('GET', `/api/v1/submissions?formId=${formId}`, as.damotRecords)).json<{
            items: SubmissionOut[];
        }>().items;
        expect(listed[0]?.answers).not.toHaveProperty('fin');

        // the data viewer: not a field it shows, filters or sorts by (each would tell the value)
        const view = (await api.call('GET', `/api/v1/forms/${formId}/view`, as.damotRecords)).json<{
            fields: { key: string }[];
        }>();
        expect(view.fields.map((f) => f.key)).not.toContain('fin');
        const filtered = await api.call('POST', '/api/v1/submissions/query', as.damotRecords, {
            formId,
            filter: { op: 'and', items: [{ field: 'fin', op: 'eq', value: '1234 5678 9012' }] }
        });
        expect(filtered.statusCode).toBeGreaterThanOrEqual(400);
        expect(filtered.statusCode).toBeLessThan(500);
        const rows = await api.call('POST', '/api/v1/submissions/query', as.damotRecords, { formId });
        expect(rows.statusCode, rows.body).toBe(200);
        expect(JSON.stringify(rows.json())).not.toContain('1234 5678 9012');
        expect(JSON.stringify(rows.json())).not.toContain('2222 3333 4444');
    });

    it('never leaves in an export', async () => {
        const res = await api.call('POST', '/api/v1/submissions/export', as.damotHead, { formId });
        expect(res.statusCode, res.body).toBe(200);
        const csv = res.rawPayload.toString('utf8');
        expect(csv).toContain('Abebe Kebede');
        expect(csv).not.toContain('1234 5678 9012');
        expect(csv).not.toContain('2222 3333 4444');
        // asking for it by name is refused
        const named = await api.call('POST', '/api/v1/submissions/export', as.damotHead, { formId, fields: ['fin'] });
        expect(named.statusCode).toBeGreaterThanOrEqual(400);
        expect(named.statusCode).toBeLessThan(500);
    });

    it('comes through the reveal, with a reason, on record; for those who may reveal personal data', async () => {
        const res = await api.call('POST', `/api/v1/submissions/${submissionId}/reveal`, as.damotHead, {
            reason: 'Checking the FIN against the national ID card'
        });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json()).toEqual({
            answers: { fin: '1234 5678 9012', children: [{ childFin: '2222 3333 4444' }] }
        });
        const audit = await api.owner.query<{ data: { fields: string[]; reason: string } }>(
            `select diff as data from kernel.audit_log where event_type = 'submission.revealed' and row_id = $1::uuid`,
            [submissionId]
        );
        expect(audit.rows).toHaveLength(1);
        expect(JSON.stringify(audit.rows[0]?.data)).toContain('Checking the FIN against the national ID card');
        // never kept for a replay (it answers in clear)
        const kept = await api.owner.query(
            `select 1 from kernel.idempotency_keys where response::text like '%1234 5678 9012%'`
        );
        expect(kept.rowCount).toBe(0);

        // without the right, without a reason
        const zone = await api.call('POST', `/api/v1/submissions/${submissionId}/reveal`, as.zoneAdmin, {
            reason: 'Just looking at it'
        });
        expect(zone.statusCode).toBe(403);
        const short = await api.call('POST', `/api/v1/submissions/${submissionId}/reveal`, as.damotHead, {
            reason: 'x'
        });
        expect(short.statusCode).toBe(422);
    });
});

describe('the approvals', () => {
    it('lists what the caller may decide, a page at a time past any limit, and counts it', async () => {
        // three more forms waiting for a publication, asked for by the bureau's first admin
        for (const key of ['form-a', 'form-b', 'form-c']) {
            const form = await api.call('POST', '/api/v1/forms', as.bureau, {
                key,
                name: { am: key, en: key },
                document: { schemaVersion: 2, fields: [value('x', 'internal')] }
            });
            expect(form.statusCode, form.body).toBe(201);
            const asked = await api.call(
                'POST',
                `/api/v1/forms/${form.json<{ id: string }>().id}/publications`,
                as.bureau,
                {}
            );
            expect(asked.statusCode, asked.body).toBe(201);
        }
        type Page = { items: { id: string; canDecide: boolean }[]; next: string | null };
        const page = async (who: As, query: string) => {
            const res = await api.call('GET', `/api/v1/form-publications?${query}`, who);
            expect(res.statusCode, res.body).toBe(200);
            return res.json<Page>();
        };
        const first = await page(as.bureau2, 'scope=decidable&limit=2');
        expect(first.items).toHaveLength(2);
        expect(first.items.every((p) => p.canDecide)).toBe(true);
        expect(first.next).toEqual(expect.any(String));
        const second = await page(as.bureau2, `scope=decidable&limit=2&before=${first.next ?? ''}`);
        expect(second.items).toHaveLength(1);
        expect(second.next).toBeNull();
        expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(3);
        // the requester decides none of their own; they see them as theirs
        expect((await page(as.bureau, 'scope=decidable')).items).toEqual([]);
        expect((await page(as.bureau, 'scope=mine')).items).toHaveLength(3);
        // the counts behind the badge
        const count = async (who: As) =>
            (await api.call('GET', '/api/v1/form-publications/count', who)).json<{ decidable: number }>().decidable;
        expect(await count(as.bureau2)).toBe(3);
        expect(await count(as.bureau)).toBe(0);
        expect(await count(as.damotRecords)).toBe(0);
    });
});
