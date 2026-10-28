/**
 * Drafts of a request (task 0.20c), on a real PostgreSQL 16: a records officer keeps a half-filled request as a draft on
 * the published version and goes on with it; it holds only the form's own fields; it is theirs alone (a colleague in
 * the same office, another office, another role: not found or refused); it moves to a newer published version when it
 * is saved again; filing the request removes it in the same transaction; every write is audited with the answers
 * masked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-e300-7000-8000-000000000001',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    damotRecords2: '0199f0a0-e300-7000-8000-000000000002',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302'
};

interface DraftOut {
    id: string;
    version: number;
    formId: string;
    formVersion: { id: string; number: number };
    outdated: boolean;
    unit: { id: string };
    answers: Record<string, unknown>;
}

const fieldOf = (id: string, classification = 'personal') => ({
    id,
    type: 'InputText',
    category: 'Input',
    label: { am: id, en: id },
    classification,
    props: {},
    behavior: { validation: { supported: true } }
});

let pg: TestPostgres;
let api: TestApi;
let formId: string;
let v1: string;
const as = {} as Record<keyof typeof SUB, As>;

/** Publishes the form's working copy (a second bureau admin approves); the published version's id. */
async function publish(): Promise<string> {
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
    return (await api.call('GET', `/api/v1/forms/${formId}`, as.bureau)).json<{ publishedVersion: { id: string } }>()
        .publishedVersion.id;
}

const draft = (who: As, body: Record<string, unknown>) => api.call('POST', '/api/v1/form-drafts', who, body);
const get = (who: As, id: string) => api.call('GET', `/api/v1/form-drafts/${id}`, who);
const save = (who: As, d: { id: string; version: number }, body: Record<string, unknown>) =>
    api.call('PATCH', `/api/v1/form-drafts/${d.id}`, who, body, { 'if-match': `"${d.version}"` });
const mine = async (who: As) =>
    (await api.call('GET', `/api/v1/form-drafts?formId=${formId}`, who)).json<{ items: DraftOut[] }>().items;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.drafts.bureau2',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        },
        {
            username: 'test.drafts.records2',
            sub: SUB.damotRecords2,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'records_officer']]
        }
    ]);
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: await api.unit('SER', 'SER') };
    as.bureau2 = { sub: SUB.bureau2, unit: await api.unit('SER', 'SER') };
    as.zoneHead = { sub: SUB.zoneHead, unit: await api.unit('SER', 'WOL') };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.damotRecords2 = { sub: SUB.damotRecords2, unit: damot };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: await api.unit('SER', 'WOL-BODITI') };
    const created = await api.call('POST', '/api/v1/forms', as.bureau, {
        key: 'licence-application',
        name: { am: 'የመንጃ ፈቃድ ማመልከቻ', en: 'Licence application' },
        document: { schemaVersion: 2, fields: [fieldOf('name'), fieldOf('fin', 'sensitive'), fieldOf('town')] }
    });
    expect(created.statusCode, created.body).toBe(201);
    formId = created.json<{ id: string }>().id;
    v1 = await publish();
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('a draft', () => {
    it("keeps the form's own answers on the published version, and is its creator's alone", async () => {
        const res = await draft(as.damotRecords, {
            formId,
            formVersionId: v1,
            answers: { name: 'Abebe', fin: '1234 5678 9012', ghost: 'not a field' }
        });
        expect(res.statusCode, res.body).toBe(201);
        const d = res.json<DraftOut>();
        // the server keeps the Sensitive answer (only the browser may not)
        expect(d).toMatchObject({
            formId,
            formVersion: { id: v1, number: 1 },
            outdated: false,
            unit: { id: as.damotRecords.unit.id },
            answers: { name: 'Abebe', fin: '1234 5678 9012' }
        });
        expect(d.answers).not.toHaveProperty('ghost');
        expect((await mine(as.damotRecords)).map((x) => x.id)).toContain(d.id);

        // a colleague at the same counter, another office, the office above: never theirs
        expect((await mine(as.damotRecords2)).map((x) => x.id)).not.toContain(d.id);
        expect((await get(as.damotRecords2, d.id)).statusCode).toBe(404);
        expect((await save(as.damotRecords2, d, { answers: {} })).statusCode).toBe(404);
        expect((await get(as.boditiRecords, d.id)).statusCode).toBe(404);
        // a role that files no requests keeps no drafts
        expect((await api.call('GET', `/api/v1/form-drafts/${d.id}`, as.zoneHead)).statusCode).toBe(403);
    });

    it('goes on where it was left, refuses a stale save, and starts only on the published version', async () => {
        const d = (
            await draft(as.damotRecords, { formId, formVersionId: v1, answers: { name: 'Almaz' } })
        ).json<DraftOut>();
        const saved = await save(as.damotRecords, d, { answers: { name: 'Almaz', town: 'Damot' } });
        expect(saved.statusCode, saved.body).toBe(200);
        const again = (await get(as.damotRecords, d.id)).json<DraftOut>();
        expect(again).toMatchObject({ version: d.version + 1, answers: { name: 'Almaz', town: 'Damot' } });
        expect((await save(as.damotRecords, d, { answers: { name: 'old' } })).statusCode).toBe(409);
        const unknownVersion = await draft(as.damotRecords, {
            formId,
            formVersionId: '0199f0a0-0000-7000-8000-00000000beef',
            answers: {}
        });
        expect(unknownVersion.statusCode).toBe(409);
    });

    it('moves to a newer published version when it is saved again', async () => {
        const d = (
            await draft(as.damotRecords, { formId, formVersionId: v1, answers: { name: 'Kebede' } })
        ).json<DraftOut>();
        const form = (await api.call('GET', `/api/v1/forms/${formId}`, as.bureau)).json<{ version: number }>();
        const changed = await api.call(
            'PATCH',
            `/api/v1/forms/${formId}`,
            as.bureau,
            {
                document: {
                    schemaVersion: 2,
                    fields: [fieldOf('name'), fieldOf('fin', 'sensitive'), fieldOf('town'), fieldOf('plate')]
                }
            },
            { 'if-match': `"${form.version}"` }
        );
        expect(changed.statusCode, changed.body).toBe(200);
        const v2 = await publish();
        expect((await get(as.damotRecords, d.id)).json<DraftOut>().outdated).toBe(true);
        // a new draft on the old version is refused: people fill in the published one
        expect((await draft(as.damotRecords, { formId, formVersionId: v1, answers: {} })).statusCode).toBe(409);
        const moved = await save(as.damotRecords, d, {
            formVersionId: v2,
            answers: { name: 'Kebede', plate: 'ETH-ABC-1234' }
        });
        expect(moved.statusCode, moved.body).toBe(200);
        expect(moved.json<DraftOut>()).toMatchObject({
            formVersion: { id: v2, number: 2 },
            outdated: false,
            answers: { name: 'Kebede', plate: 'ETH-ABC-1234' }
        });
        v1 = v2;
    });

    it('is removed with the request filed from it, in its transaction; every write audited, the answers masked', async () => {
        const d = (
            await draft(as.damotRecords, { formId, formVersionId: v1, answers: { name: 'Hana' } })
        ).json<DraftOut>();
        const saved = (await save(as.damotRecords, d, { answers: { name: 'Hana', town: 'Boditi' } })).json<DraftOut>();
        // another's draft id is ignored by a filing (nobody removes a draft that is not theirs)
        const other = (
            await draft(as.damotRecords2, { formId, formVersionId: v1, answers: { name: 'X' } })
        ).json<DraftOut>();
        const filed = await api.call('POST', '/api/v1/submissions', as.damotRecords, {
            formId,
            formVersionId: v1,
            answers: { name: 'Hana', town: 'Boditi' },
            draftId: saved.id
        });
        expect(filed.statusCode, filed.body).toBe(201);
        expect((await get(as.damotRecords, d.id)).statusCode).toBe(404);
        const ignored = await api.call('POST', '/api/v1/submissions', as.damotRecords, {
            formId,
            formVersionId: v1,
            answers: { name: 'Y' },
            draftId: other.id
        });
        expect(ignored.statusCode, ignored.body).toBe(201);
        expect((await get(as.damotRecords2, other.id)).statusCode).toBe(200);

        const audit = await api.owner.query<{ action: string; diff: unknown }>(
            `select action, diff from kernel.audit_log where table_name = 'forms.submission_drafts' and row_id = $1::uuid
              order by at, id`,
            [d.id]
        );
        expect(audit.rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete']);
        expect(JSON.stringify(audit.rows.map((r) => r.diff))).not.toContain('Hana');
    });

    it('is thrown away on request (If-Match)', async () => {
        const d = (
            await draft(as.damotRecords, { formId, formVersionId: v1, answers: { name: 'Tsion' } })
        ).json<DraftOut>();
        expect(
            (
                await api.call('DELETE', `/api/v1/form-drafts/${d.id}`, as.damotRecords2, undefined, {
                    'if-match': `"${d.version}"`
                })
            ).statusCode
        ).toBe(404);
        const removed = await api.call('DELETE', `/api/v1/form-drafts/${d.id}`, as.damotRecords, undefined, {
            'if-match': `"${d.version}"`
        });
        expect(removed.statusCode, removed.body).toBe(204);
        expect((await get(as.damotRecords, d.id)).statusCode).toBe(404);
    });
});
