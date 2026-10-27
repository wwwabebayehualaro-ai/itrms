/**
 * Form governance (task 0.18a), over HTTP on a real PostgreSQL 16: a key the published version holds stays (flagged removed
 * instead of renamed or deleted), a form with a failing test case or a lint error is not published, a warning alone is not
 * a block, and the publish check lists the saved views a change affects, never another person's private view.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000f301',
    damot: '0199f0a0-d000-7000-8000-000000000202',
    damotHead: '0199f0a0-d000-7000-8000-00000000f302',
    trx: '0199f0a0-d000-7000-8000-00000000f303'
};

const text = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    label: { am: `${id} አ`, en: `${id} en` },
    props: {},
    behavior: { validation: { supported: true } },
    ...extra
});
const office = (extra: Record<string, unknown> = {}) => ({
    id: 'office',
    type: 'Dropdown',
    label: { am: 'ጽ/ቤት', en: 'Office' },
    props: {},
    data: {
        dataSource: {
            staticData: [
                { label: 'Town', value: 'town' },
                { label: 'Woreda', value: 'woreda' }
            ]
        }
    },
    ...extra
});
const BASE = { schemaVersion: 2, fields: [text('fullName', { props: { required: true } }), office()] };

let pg: TestPostgres;
let api: TestApi;
const as = {} as Record<'bureau' | 'bureau2' | 'damot' | 'damotHead' | 'trx', As>;
let counter = 0;

interface Problem {
    code: string;
    errors: { path: string; code: string; message: string }[];
}
interface FormOut {
    id: string;
    version: number;
    document: { fields: Record<string, unknown>[]; testCases?: unknown[] };
}
interface PublicationOut {
    id: string;
    version: number;
    formVersion: { id: string };
}
interface CheckOut {
    canPublish: boolean;
    base: { id: string; number: number } | null;
    candidate: { id: string | null; number: number | null };
    problems: { code: string; severity: string; message: string }[];
    tests: { id: string; passed: boolean }[];
    diff: { removed: { key: string }[] };
    impact: { views: { id: string; name: string; visibility: string; mine: boolean; keys: { key: string }[] }[] };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

async function create(document: unknown = BASE): Promise<FormOut> {
    counter += 1;
    const res = await api.call('POST', '/api/v1/forms', as.bureau, {
        key: `governed-${counter}`,
        name: { am: `ቅጽ ${counter}`, en: `Form ${counter}` },
        document
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FormOut>();
}

const patch = (form: FormOut, document: unknown) =>
    api.call('PATCH', `/api/v1/forms/${form.id}`, as.bureau, { document }, ifMatch(form.version));
const request = (form: FormOut) => api.call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau, {});
const approve = (asked: PublicationOut) =>
    api.call('POST', `/api/v1/form-publications/${asked.id}/approval`, as.bureau2, {}, ifMatch(asked.version));

/** Creates a form and publishes it (the author asks, the second person approves). */
async function published(document: unknown = BASE): Promise<FormOut> {
    const form = await create(document);
    const asked = await request(form);
    expect(asked.statusCode, asked.body).toBe(201);
    expect((await approve(asked.json<PublicationOut>())).statusCode).toBe(200);
    return (await api.call('GET', `/api/v1/forms/${form.id}`, as.bureau)).json<FormOut>();
}

const viewConfig = { mode: 'table', filter: { op: 'and', items: [{ field: 'office', op: 'eq', value: 'town' }] } };
const addView = (who: As, form: FormOut, name: string, visibility: 'private' | 'unit') =>
    api.call('POST', `/api/v1/forms/${form.id}/views`, who, { name, visibility, config: viewConfig });

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
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
        },
        {
            username: 'test.trx.records',
            sub: SUB.trx,
            region: 'TRX',
            home: 'TRX-W1',
            roles: [['TRX-W1', 'records_officer']]
        }
    ]);
    const ser = await api.unit('SER', 'SER');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: ser };
    as.bureau2 = { sub: SUB.bureau2, unit: ser };
    as.damot = { sub: SUB.damot, unit: damot };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.trx = { sub: SUB.trx, unit: await api.unit('TRX', 'TRX-W1') };
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('key stability', () => {
    it('refuses to rename or delete a published key, and keeps one flagged removed', async () => {
        const form = await published();
        const renamed = BASE.fields.map((f) => (f.id === 'office' ? { ...f, id: 'office_type' } : f));
        const res = await patch(form, { ...BASE, fields: renamed });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>()).toMatchObject({ code: 'validation_failed' });
        expect(res.json<Problem>().errors[0]).toMatchObject({ code: 'key_stability' });

        const deleted = await patch(form, { ...BASE, fields: [BASE.fields[0]] });
        expect(deleted.statusCode).toBe(422);
        expect(deleted.json<Problem>().errors.map((e) => e.code)).toContain('key_stability');

        const flagged = await patch(form, { ...BASE, fields: [BASE.fields[0], office({ removed: true })] });
        expect(flagged.statusCode, flagged.body).toBe(200);
        expect(flagged.json<FormOut>().document.fields.find((f) => f.id === 'office')).toMatchObject({ removed: true });
    });

    it('lets a form never published change its keys freely', async () => {
        const form = await create();
        expect((await patch(form, { ...BASE, fields: [BASE.fields[0]] })).statusCode).toBe(200);
    });
});

describe('the publication request', () => {
    it('is refused with a failing test case, naming it', async () => {
        const form = await create({
            ...BASE,
            testCases: [{ id: 'empty-is-valid', name: 'Empty is valid', values: {}, expect: { valid: true } }]
        });
        const res = await request(form);
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>().errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: 'document.testCases[0]', code: 'test_case' })])
        );
    });

    it('is refused with a lint error (a duplicated choice)', async () => {
        const dup = office({
            data: {
                dataSource: {
                    staticData: [
                        { label: 'A', value: 'a' },
                        { label: 'B', value: 'a' }
                    ]
                }
            }
        });
        const form = await create({ ...BASE, fields: [BASE.fields[0], dup] });
        const res = await request(form);
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>().errors.map((e) => e.code)).toContain('lint.duplicate-option');
    });

    it('goes through with a warning alone (a missing translation)', async () => {
        const form = await create({ ...BASE, fields: [text('fullName', { label: { am: 'ስም' } }), office()] });
        const check = (await api.call('GET', `/api/v1/forms/${form.id}/publish-check`, as.bureau)).json<CheckOut>();
        expect(check.canPublish).toBe(true);
        expect(check.problems.some((p) => p.severity === 'warning')).toBe(true);
        expect((await request(form)).statusCode).toBe(201);
    });

    it('publishes a rollback: an old version with the published keys kept, flagged removed', async () => {
        const form = await published();
        const first = (await api.call('GET', `/api/v1/forms/${form.id}/versions/published`, as.bureau)).json<{
            id: string;
        }>();
        const flagged = await patch(form, { ...BASE, fields: [BASE.fields[0], office({ removed: true })] });
        const v2 = flagged.json<FormOut>();
        const asked = (await request(v2)).json<PublicationOut>();
        expect((await approve(asked)).statusCode).toBe(200);
        // back to the first content: the flag is cleared (a restore), which is allowed
        const restored = await patch(
            (await api.call('GET', `/api/v1/forms/${form.id}`, as.bureau)).json<FormOut>(),
            BASE
        );
        expect(restored.statusCode, restored.body).toBe(200);
        const again = await request(restored.json<FormOut>());
        expect(again.statusCode, again.body).toBe(201);
        expect((await approve(again.json<PublicationOut>())).statusCode).toBe(200);
        const versions = (await api.call('GET', `/api/v1/forms/${form.id}/versions`, as.bureau)).json<{
            items: { id: string; published: boolean; publishedAt: string | null; createdByName: string | null }[];
        }>().items;
        // the content equals the first version's: it is reused and live again
        expect(versions.find((v) => v.id === first.id)).toMatchObject({ published: true });
        expect(versions.find((v) => v.id === first.id)?.publishedAt).not.toBeNull();
    });
});

describe('the review of a change', () => {
    it('lists a shared view and the caller own private view, never another person private view', async () => {
        const form = await published();
        expect((await addView(as.damotHead, form, 'Shared by the head', 'unit')).statusCode).toBe(201);
        expect((await addView(as.damot, form, 'Private of the officer', 'private')).statusCode).toBe(201);
        expect((await addView(as.bureau, form, 'Private of the bureau', 'private')).statusCode).toBe(201);

        const flagged = (
            await patch(form, { ...BASE, fields: [BASE.fields[0], office({ removed: true })] })
        ).json<FormOut>();
        const check = (await api.call('GET', `/api/v1/forms/${flagged.id}/publish-check`, as.bureau)).json<CheckOut>();
        expect(check.canPublish).toBe(true);
        expect(check.diff.removed.map((f) => f.key)).toEqual(['office']);
        const names = check.impact.views.map((v) => v.name).sort();
        expect(names).toEqual(['Private of the bureau', 'Shared by the head']);
        expect(check.impact.views.find((v) => v.name === 'Private of the bureau')).toMatchObject({ mine: true });
        expect(check.impact.views.every((v) => v.keys.some((k) => k.key === 'office'))).toBe(true);

        // the approver sees the same on the request
        const asked = (await request(flagged)).json<PublicationOut>();
        const review = await api.call('GET', `/api/v1/form-publications/${asked.id}/review`, as.bureau2);
        expect(review.statusCode, review.body).toBe(200);
        const seen = review.json<CheckOut>().impact.views.map((v) => v.name);
        expect(seen).toContain('Shared by the head');
        expect(seen).not.toContain('Private of the officer');
        expect(seen).not.toContain('Private of the bureau');
    });

    it('is not found outside the caller region', async () => {
        const form = await published();
        // a request needs a change: the published content itself is refused (409, already published)
        const flagged = (
            await patch(form, { ...BASE, fields: [BASE.fields[0], office({ removed: true })] })
        ).json<FormOut>();
        const sent = await request(flagged);
        expect(sent.statusCode, sent.body).toBe(201);
        const asked = sent.json<PublicationOut>();
        expect((await api.call('GET', `/api/v1/form-publications/${asked.id}/review`, as.bureau2)).statusCode).toBe(
            200
        );
        const res = await api.call('GET', `/api/v1/form-publications/${asked.id}/review`, as.trx);
        expect(res.statusCode).toBe(404);
    });
});
