/**
 * Saved views, history and direct exports (task 0.16d; ported from the legacy test_saved_views.py and the export tests
 * of test_submission_query.py), over HTTP on a real PostgreSQL 16. A view is private to its owner or shared with the
 * office by someone allowed to; a view reopens as it was saved. An export is the viewer's rows as people read them,
 * every cell neutralised (SEC-IN-8), audited with its size, and refused above the direct limit. A submission's history
 * names who did what, never the answers' values.
 */
import { randomUUID } from 'node:crypto';

import ExcelJS from 'exceljs';
import { sheetNameOf } from '@itrms/forms/api';
import { MAX_DIRECT_EXPORT_ROWS } from '@itrms/forms/contracts';
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000f301',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    zoneFinance: '0199f0a0-d000-7000-8000-000000000108',
    damot: '0199f0a0-d000-7000-8000-000000000202',
    damotHead: '0199f0a0-d000-7000-8000-00000000f302',
    trx: '0199f0a0-d000-7000-8000-00000000f303'
};

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    ...extra
});
const FIELDS = [
    field('title', 'InputText', { label: 'Title' }),
    field('dept', 'Dropdown', {
        label: 'Department',
        data: {
            dataSource: {
                staticData: [
                    { label: 'Sales', value: 'sales' },
                    { label: 'Ops', value: 'ops' }
                ]
            }
        }
    }),
    field('urgent', 'Checkbox', { label: 'Urgent' }),
    field('docs', 'FileUpload', { label: 'Docs' }),
    field('lines', 'FormArray', { label: 'Lines', category: 'Layout', layout: { options: { isContainer: true } } }),
    field('line_qty', 'InputNumber', { label: 'Qty', parentId: 'lines' }),
    field('secret', 'InputText', { label: 'Secret', visibleToRoles: ['unit_head'] })
];
const CONFIG = {
    mode: 'board',
    search: 'x',
    filter: { op: 'and', items: [{ field: 'dept', op: 'eq', value: 'sales' }] },
    sort: [{ field: 'createdAt', desc: true }],
    columns: ['title', 'dept'],
    pageSize: 20,
    options: { month: '2026-10' }
};

let pg: TestPostgres;
let api: TestApi;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'trx', OrgUnit>;
const as = {
    bureau: (): As => ({ sub: SUB.bureau, unit: units.ser }),
    bureau2: (): As => ({ sub: SUB.bureau2, unit: units.ser }),
    zoneHead: (): As => ({ sub: SUB.zoneHead, unit: units.zone }),
    zoneFinance: (): As => ({ sub: SUB.zoneFinance, unit: units.zone }),
    damot: (): As => ({ sub: SUB.damot, unit: units.damot }),
    damotHead: (): As => ({ sub: SUB.damotHead, unit: units.damot }),
    trx: (): As => ({ sub: SUB.trx, unit: units.trx })
};
let form = { id: '', versionId: '' };

interface ViewOut {
    id: string;
    version: number;
    name: string;
    visibility: string;
    isDefault: boolean;
    canEdit: boolean;
    config: typeof CONFIG;
}
interface Problem {
    code: string;
    detail?: string;
}

async function createAndPublish(key: string): Promise<{ id: string; versionId: string }> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau(), {
        key,
        name: { am: `ቅጽ ${key}`, en: `Form ${key}` },
        document: { fields: FIELDS }
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const asked = (await api.call('POST', `/api/v1/forms/${id}/publications`, as.bureau(), {})).json<{
        id: string;
        version: number;
        formVersion: { id: string };
    }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${asked.id}/approval`,
        as.bureau2(),
        {},
        { 'if-match': `"${asked.version}"` }
    );
    expect(approved.statusCode, approved.body).toBe(200);
    return { id, versionId: asked.formVersion.id };
}

async function submit(who: As, answers: Record<string, unknown>, target = form): Promise<string> {
    const res = await api.call('POST', '/api/v1/submissions', who, {
        formId: target.id,
        formVersionId: target.versionId,
        answers
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

/** A stored, unlinked upload of the Damot Gale records officer, as a confirmation leaves it (task 0.18: a file answer names one). */
async function storedFile(): Promise<string> {
    const id = randomUUID();
    await api.owner.query(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
             confirmed_at, origin, created_by)
         values ($1, $2, $3, 'stored', 'a.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
        [id, units.damot.regionId, units.damot.id, `files/${units.damot.regionId}/${id}`, await api.userId(SUB.damot)]
    );
    return id;
}

const views = (who: As, formId = form.id) => api.call('GET', `/api/v1/forms/${formId}/views`, who);
const listed = async (who: As) => (await views(who)).json<{ items: ViewOut[] }>().items;
const post = (who: As, body: Record<string, unknown> = {}, formId = form.id) =>
    api.call('POST', `/api/v1/forms/${formId}/views`, who, { name: 'Mine', config: CONFIG, ...body });
const patch = (who: As, view: ViewOut, body: object) =>
    api.call('PATCH', `/api/v1/saved-views/${view.id}`, who, body, { 'if-match': `"${view.version}"` });
const remove = (who: As, view: ViewOut) =>
    api.call('DELETE', `/api/v1/saved-views/${view.id}`, who, undefined, { 'if-match': `"${view.version}"` });
const exportOf = (who: As, body: object = {}) =>
    api.call('POST', '/api/v1/submissions/export', who, { formId: form.id, ...body });

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
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.trx = await api.unit('TRX', 'TRX-W1');
    form = await createAndPublish('requests');
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('a private view', () => {
    it('belongs to its owner: nobody else sees, changes or deletes it, and it reopens as saved', async () => {
        const created = await post(as.damot(), { name: 'My open items' });
        expect(created.statusCode, created.body).toBe(201);
        const mine = created.json<ViewOut>();
        expect(mine).toMatchObject({ visibility: 'private', canEdit: true, isDefault: false });
        // it reopens with its filters, search, sort, columns and the mode's options
        const reopened = (await listed(as.damot())).find((v) => v.id === mine.id);
        expect(reopened?.config).toEqual(CONFIG);
        // not even the unit's head, nor the zone's, sees it, and its id leads nowhere
        for (const other of [as.damotHead(), as.zoneHead()]) {
            expect((await listed(other)).map((v) => v.id)).not.toContain(mine.id);
            expect((await patch(other, mine, { name: 'x' })).statusCode).toBe(404);
            expect((await remove(other, mine)).statusCode).toBe(404);
        }
        const renamed = await patch(as.damot(), mine, { name: 'Renamed', config: { ...CONFIG, mode: 'table' } });
        expect(renamed.statusCode, renamed.body).toBe(200);
        expect(renamed.json<ViewOut>()).toMatchObject({ name: 'Renamed', config: { mode: 'table' } });
        expect((await remove(as.damot(), renamed.json<ViewOut>())).statusCode).toBe(204);
        expect((await listed(as.damot())).map((v) => v.id)).not.toContain(mine.id);
    });
});

describe('a shared view', () => {
    it('needs the right to share, and is seen but not changed by the rest of the office', async () => {
        expect((await post(as.damot(), { visibility: 'unit' })).statusCode).toBe(403);
        expect((await post(as.damot(), { isDefault: true })).statusCode).toBe(403);
        const mine = (await post(as.damot())).json<ViewOut>();
        expect((await patch(as.damot(), mine, { visibility: 'unit' })).statusCode).toBe(403);

        const shared = (await post(as.damotHead(), { name: 'Pending', visibility: 'unit' })).json<ViewOut>();
        expect(shared.visibility).toBe('unit');
        const seen = (await listed(as.damot())).find((v) => v.id === shared.id);
        expect(seen).toMatchObject({ name: 'Pending', canEdit: false });
        expect((await patch(as.damot(), shared, { name: 'x' })).statusCode).toBe(403);
        expect((await remove(as.damot(), shared)).statusCode).toBe(403);
        await remove(as.damot(), mine);
        await remove(as.damotHead(), shared);
    });

    it('is one default per form and office; a private view is never the default', async () => {
        const a = (await post(as.damotHead(), { name: 'A', isDefault: true })).json<ViewOut>();
        expect(a).toMatchObject({ isDefault: true, visibility: 'unit' });
        const b = (await post(as.damotHead(), { name: 'B', isDefault: true })).json<ViewOut>();
        const defaults = async () =>
            Object.fromEntries((await listed(as.damotHead())).map((v) => [v.name, v.isDefault]));
        expect(await defaults()).toMatchObject({ A: false, B: true });
        const current = (await listed(as.damotHead())).find((v) => v.id === a.id) as ViewOut;
        const again = await patch(as.damotHead(), current, { isDefault: true });
        expect(again.statusCode, again.body).toBe(200);
        expect(await defaults()).toMatchObject({ A: true, B: false });
        const unshared = await patch(as.damotHead(), again.json<ViewOut>(), { visibility: 'private' });
        expect(unshared.json<ViewOut>()).toMatchObject({ visibility: 'private', isDefault: false });
        await remove(as.damotHead(), unshared.json<ViewOut>());
        await remove(as.damotHead(), (await listed(as.damotHead())).find((v) => v.id === b.id) as ViewOut);
    });
});

describe('views', () => {
    it('stay in their region and have a bounded config', async () => {
        expect((await views(as.trx())).statusCode).toBe(404);
        expect((await post(as.trx())).statusCode).toBe(404);
        const bad: object[] = [
            { mode: 'Not A Mode' },
            { search: 'x'.repeat(101) },
            { pageSize: 0 },
            { pageSize: 101 },
            { columns: Array.from({ length: 51 }, () => 'c') },
            { columns: ['c'.repeat(65)] },
            { sort: Array.from({ length: 4 }, () => ({ field: 'a' })) },
            { options: { x: 'y'.repeat(5000) } },
            {
                filter: { op: 'and', items: Array.from({ length: 51 }, (_, i) => ({ field: 'a', op: 'eq', value: i })) }
            },
            { filter: { op: 'and', items: [{ field: 'a', op: 'bogus', value: 1 }] } },
            { unknown: true }
        ];
        for (const over of bad) {
            const res = await post(as.damot(), { config: { ...CONFIG, ...over } });
            expect(res.statusCode, JSON.stringify(over)).toBe(422);
        }
        expect((await post(as.damot(), { name: '   ' })).statusCode).toBe(422);
    });
});

describe('a submission history', () => {
    it('names who did what and when, and stays in scope', async () => {
        const id = await submit(as.damot(), { title: 'History', dept: 'ops' });
        const res = await api.call('GET', `/api/v1/submissions/${id}/history`, as.damot());
        expect(res.statusCode, res.body).toBe(200);
        const history = res.json<{
            items: { action: string; actorId: string; actorName: string | null; changes: string[] }[];
            truncated: boolean;
        }>();
        expect(history.truncated).toBe(false);
        const items = history.items;
        expect(items).toEqual([
            expect.objectContaining({ action: 'insert', actorId: await api.userId(SUB.damot), changes: [] })
        ]);
        expect(items[0]?.actorName).toBeTruthy();
        // the answers are never in it
        expect(JSON.stringify(items)).not.toContain('History');
        expect((await api.call('GET', `/api/v1/submissions/${id}/history`, as.trx())).statusCode).toBe(404);
    });
});

describe('an export', () => {
    beforeAll(async () => {
        for (const answers of [
            { title: 'Alpha', dept: 'sales', urgent: true, lines: [{ line_qty: 1 }] },
            {
                title: 'Gamma',
                dept: 'ops',
                urgent: false,
                docs: [{ file_id: await storedFile() }],
                lines: [{ line_qty: 2 }, { line_qty: 3 }]
            },
            { title: '=HYPERLINK("http://evil.example")', dept: 'sales' }
        ])
            await submit(as.damot(), answers);
        await submit(as.damotHead(), { title: 'Secretive', secret: 'only for heads' });
    });

    const table = (body: Buffer) =>
        body
            .toString('utf8')
            .replace(/^\uFEFF/, '')
            .trimEnd()
            .split('\r\n');

    it("is the viewer's rows as people read them, every cell neutralised, and on record with its size", async () => {
        const res = await exportOf(as.damotHead(), { sort: [{ field: 'title' }] });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/csv/);
        expect(res.headers['content-disposition']).toMatch(/^attachment; filename="requests-\d{8}\.csv"$/);
        expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        const lines = table(res.rawPayload);
        // every cell quoted: no separator (a semicolon, a tab) ever splits one
        expect(lines[0]).toBe(
            '"Submitted","Submitted by","Office","Title","Department","Urgent","Docs","Lines","Secret"'
        );
        // the History row of the test above is in the form too
        expect(res.headers['x-row-count']).toBe('5');
        const csv = res.rawPayload.toString('utf8');
        expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
        expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
        const gamma = lines.find((l) => l.includes(',"Gamma",')) ?? '';
        // labels, not values; Yes/No; file names; a count of rows; names, not ids
        expect(gamma).toContain(',"Gamma","Ops","No","a.pdf","2 rows",');
        expect(gamma).not.toContain(await api.userId(SUB.damot));
        expect(lines.find((l) => l.includes(',"Alpha",'))).toContain(',"Alpha","Sales","Yes","","1 row",');
        const events = await api.owner.query<{ diff: { rows: number; format: string } }>(
            "select diff from kernel.audit_log where event_type = 'submissions.exported' order by at"
        );
        expect(events.rows.map((r) => [r.diff.format, r.diff.rows])).toEqual([['csv', 5]]);
    });

    it('takes the same filter as the viewer and only the fields chosen; a field restricted to others is not in it', async () => {
        const only = await exportOf(as.damot(), {
            filter: { op: 'and', items: [{ field: 'dept', op: 'eq', value: 'ops' }] },
            fields: ['title', 'dept']
        });
        // a records officer may not export (leaving the system with data is a right of its own)
        expect(only.statusCode).toBe(403);
        const head = await exportOf(as.damotHead(), {
            filter: { op: 'and', items: [{ field: 'dept', op: 'eq', value: 'ops' }] },
            fields: ['title', 'dept'],
            sort: [{ field: 'title' }]
        });
        // Gamma, and the history test's submission
        expect(table(head.rawPayload)).toEqual(['"Title","Department"', '"Gamma","Ops"', '"History","Ops"']);
        // the zone's finance officer may export, but not see the heads' field: it is no column of theirs
        const finance = await exportOf(as.zoneFinance(), { fields: ['title', 'secret'] });
        expect(finance.statusCode).toBe(400);
        const all = table((await exportOf(as.zoneFinance())).rawPayload);
        expect(all[0]).not.toContain('Secret');
        expect(all.join('\n')).not.toContain('only for heads');
        // the zone's head holds it, and sees it
        const zone = await exportOf(as.zoneHead(), { fields: ['title', 'secret'] });
        expect(table(zone.rawPayload).join('\n')).toContain('only for heads');
        for (const body of [
            { fields: ['nope'] },
            { filter: { op: 'and', items: [{ field: 'nope', op: 'eq', value: 1 }] } }
        ])
            expect((await exportOf(as.damotHead(), body)).statusCode).toBe(400);
        // another region's officer may not export at all (the query suite shows its 404 on the same path)
        expect((await exportOf(as.trx())).statusCode).toBe(403);
    });

    it('as an Excel workbook: text cells, a bold header, the formula neutralised', async () => {
        const res = await exportOf(as.damotHead(), {
            format: 'xlsx',
            fields: ['title', 'dept'],
            sort: [{ field: 'title' }]
        });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.rawPayload as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        const sheet = workbook.worksheets[0];
        const values = (n: number) => (sheet?.getRow(n).values as unknown[]).slice(1);
        expect(values(1)).toEqual(['Title', 'Department']);
        // the formula as typed, with the text format: never evaluated, not even when edited
        const evil = sheet?.getColumn(1).values.findIndex((v) => typeof v === 'string' && v.startsWith('=HYPERLINK'));
        expect(evil).toBeGreaterThan(1);
        expect(sheet?.getRow(evil ?? 0).getCell(1).numFmt).toBe('@');
        expect(sheet?.getRow(1).getCell(1).font?.bold).toBe(true);
        const titles = Array.from({ length: (sheet?.rowCount ?? 1) - 1 }, (_, i) => values(i + 2)[0]);
        expect(titles).toContain('=HYPERLINK("http://evil.example")');
        // every cell is a string, never a formula
        sheet?.eachRow((row) => row.eachCell((cell) => expect(cell.type).toBe(ExcelJS.ValueType.String)));
    });

    it('quotes every CSV cell, so no separator splits a formula out of one', async () => {
        await submit(as.damot(), { title: 'a;=1+1', dept: 'ops' });
        await submit(as.damot(), { title: 'b\t=2+2', dept: 'ops' });
        const csv = (await exportOf(as.damotHead(), { fields: ['title'] })).rawPayload.toString('utf8');
        expect(csv).toContain('"a;=1+1"');
        expect(csv).toContain('"b\t=2+2"');
    });

    it('names an Excel sheet as Excel accepts', () => {
        // cut at 31 characters, it would end with a quote
        expect(sheetNameOf(`${'a'.repeat(30)}' licence`)).toBe('a'.repeat(30));
        expect(sheetNameOf('History')).toBe('Export');
        expect(sheetNameOf('a:b/c?d*e[f]')).toBe('a b c d e f');
        expect(sheetNameOf("''")).toBe('Export');
    });

    it('answers at most the direct limit, and says to narrow the filter', async () => {
        const big = await createAndPublish('big');
        await api.owner.query(
            `insert into forms.submissions (id, region_id, handling_unit_id, form_id, form_version_id, answers)
             select gen_random_uuid(), $1, $2, $3, $4, jsonb_build_object('title', 'row ' || n)
               from generate_series(1, $5::int) n`,
            [units.damot.regionId, units.damot.id, big.id, big.versionId, MAX_DIRECT_EXPORT_ROWS + 1]
        );
        const res = await exportOf(as.damotHead(), { formId: big.id });
        expect(res.statusCode).toBe(400);
        expect(res.json<Problem>()).toMatchObject({
            code: 'invalid_query',
            detail: expect.stringMatching(/at most 5000/) as unknown
        });
    });
});

describe("texts in the caller's language", () => {
    let texts = { id: '', versionId: '' };
    const labelled = (id: string, type: string, label: unknown, extra: Record<string, unknown> = {}) => ({
        id,
        type,
        label,
        props: {},
        ...extra
    });

    beforeAll(async () => {
        const created = await api.call('POST', '/api/v1/forms', as.bureau(), {
            key: 'texts',
            name: { am: 'ጽሑፎች', en: 'Texts' },
            document: {
                fields: [
                    labelled('title', 'InputText', { am: 'ርዕስ', en: 'Title' }),
                    labelled(
                        'dept',
                        'Dropdown',
                        { am: 'ክፍል', en: 'Department' },
                        {
                            data: {
                                dataSource: {
                                    staticData: [
                                        { label: { am: 'ሽያጭ', en: 'Sales' }, value: 'sales' },
                                        { label: { am: 'ሥራ' }, value: 'ops' },
                                        { label: 'Plain', value: 'plain' }
                                    ]
                                }
                            }
                        }
                    ),
                    labelled('note', 'InputText', { am: 'ማስታወሻ' }),
                    labelled('plain', 'InputText', 'Plain label')
                ]
            }
        });
        expect(created.statusCode, created.body).toBe(201);
        const id = created.json<{ id: string }>().id;
        const asked = (await api.call('POST', `/api/v1/forms/${id}/publications`, as.bureau(), {})).json<{
            id: string;
            version: number;
            formVersion: { id: string };
        }>();
        const approved = await api.call(
            'POST',
            `/api/v1/form-publications/${asked.id}/approval`,
            as.bureau2(),
            {},
            { 'if-match': `"${asked.version}"` }
        );
        expect(approved.statusCode, approved.body).toBe(200);
        texts = { id, versionId: asked.formVersion.id };
        await submit(as.damot(), { title: 'x', dept: 'sales' }, texts);
        await submit(as.damot(), { title: 'y', dept: 'ops' }, texts);
        await submit(as.damot(), { title: 'z', dept: 'plain' }, texts);
    });

    const viewIn = async (language: string) => {
        const res = await api.call('GET', `/api/v1/forms/${texts.id}/view`, as.damotHead(), undefined, {
            'accept-language': language
        });
        expect(res.statusCode, res.body).toBe(200);
        const { fields } = res.json<{
            fields: { key: string; label: string; options: { value: string; label: string }[] }[];
        }>();
        const by = (key: string) => fields.find((f) => f.key === key);
        return {
            labels: Object.fromEntries(fields.map((f) => [f.key, f.label])),
            options: Object.fromEntries((by('dept')?.options ?? []).map((o) => [o.value, o.label]))
        };
    };

    it('shows field, option and built-in labels in the language asked, falling back to Amharic', async () => {
        expect(await viewIn('am')).toEqual({
            labels: {
                createdAt: 'የቀረበበት',
                submittedBy: 'ያቀረበው',
                handlingUnit: 'ጽሕፈት ቤት',
                title: 'ርዕስ',
                dept: 'ክፍል',
                note: 'ማስታወሻ',
                plain: 'Plain label'
            },
            options: { sales: 'ሽያጭ', ops: 'ሥራ', plain: 'Plain' }
        });
        expect(await viewIn('en')).toEqual({
            labels: {
                createdAt: 'Submitted',
                submittedBy: 'Submitted by',
                handlingUnit: 'Office',
                title: 'Title',
                dept: 'Department',
                // only Amharic: the fallback
                note: 'ማስታወሻ',
                plain: 'Plain label'
            },
            options: { sales: 'Sales', ops: 'ሥራ', plain: 'Plain' }
        });
        // Wolaytta has no text here: Amharic, not English; the built-ins' catalogue falls back to English
        const wal = await viewIn('wal-Latn');
        expect(wal.labels).toMatchObject({ title: 'ርዕስ', dept: 'ክፍል', createdAt: 'Submitted' });
        expect(wal.options).toEqual({ sales: 'ሽያጭ', ops: 'ሥራ', plain: 'Plain' });
    });

    it('exports the header and the option cells in the language asked', async () => {
        const csvIn = async (language: string) => {
            const res = await api.call(
                'POST',
                '/api/v1/submissions/export',
                as.damotHead(),
                { formId: texts.id, fields: ['title', 'dept', 'note'], sort: [{ field: 'title' }] },
                { 'accept-language': language }
            );
            expect(res.statusCode, res.body).toBe(200);
            return res.rawPayload
                .toString('utf8')
                .replace(/^\uFEFF/, '')
                .trimEnd()
                .split('\r\n');
        };
        expect(await csvIn('am')).toEqual(['"ርዕስ","ክፍል","ማስታወሻ"', '"x","ሽያጭ",""', '"y","ሥራ",""', '"z","Plain",""']);
        expect(await csvIn('en')).toEqual([
            '"Title","Department","ማስታወሻ"',
            '"x","Sales",""',
            '"y","ሥራ",""',
            '"z","Plain",""'
        ]);
    });
});
