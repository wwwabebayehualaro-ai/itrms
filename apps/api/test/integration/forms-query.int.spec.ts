/**
 * Queries over a form's submissions (task 0.16b; ported from the legacy test_submission_query.py), over HTTP on a real
 * PostgreSQL 16. The same rows are submitted to two forms: one whose fields are filterable (their values in
 * forms.submission_values, ADR-0035), one without. Every filter must answer the same on both: the value table and the
 * answers are two ways to one result. Then: sort, pages, aggregates, groups, facets, the allow-list, isolation, the fill
 * of a newly filterable field and the statement timeout.
 */
import { randomUUID } from 'node:crypto';

import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { contextFor } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { SubmissionQueryService } from '@itrms/forms/api';
import { fillValues } from '@itrms/forms/api/worker';
import { submissionQuerySchema } from '@itrms/forms/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000f201',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damot: '0199f0a0-d000-7000-8000-000000000202',
    boditi: '0199f0a0-d000-7000-8000-000000000302',
    trx: '0199f0a0-d000-7000-8000-00000000f206'
};

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    ...extra
});
const choices = {
    data: {
        dataSource: {
            staticData: [
                { label: 'Sales', value: 'sales' },
                { label: 'Ops', value: 'ops' },
                { label: 'HR', value: 'hr' }
            ]
        }
    }
};
/** The legacy suite's form; `filterable` marks the fields the value table holds. */
const fieldsOf = (filterable: boolean) => [
    field('title', 'InputText', { label: 'Title' }),
    field('dept', 'Dropdown', { label: 'Department', filterable, ...choices }),
    field('tags', 'MultiSelect', { label: 'Tags', filterable }),
    field('amount', 'InputNumber', { label: 'Amount', filterable, props: { mode: 'currency', currency: 'ETB' } }),
    field('when', 'Calendar', { label: 'Date', filterable }),
    field('urgent', 'Checkbox', { label: 'Urgent', filterable }),
    field('docs', 'FileUpload', { label: 'Docs' }),
    field('lines', 'FormArray', { label: 'Lines', category: 'Layout', layout: { options: { isContainer: true } } }),
    field('line_qty', 'InputNumber', { label: 'Qty', parentId: 'lines' }),
    field('secret', 'Password', { label: 'Pwd' })
];
const ROWS = [
    {
        title: 'Alpha 100%',
        dept: 'sales',
        tags: ['a', 'b'],
        amount: 100,
        when: '2026-09-01T00:00:00.000Z',
        urgent: true,
        lines: [{ line_qty: 1 }]
    },
    {
        title: 'Beta_x',
        dept: 'sales',
        tags: ['b'],
        amount: 250.5,
        when: '2026-09-15T10:00:00.000Z',
        urgent: false,
        lines: []
    },
    {
        title: 'Gamma',
        dept: 'ops',
        tags: [],
        amount: 40,
        when: '2026-10-02T00:00:00.000Z',
        urgent: false,
        docs: [{ name: 'a.pdf', size: 10 }],
        lines: [{ line_qty: 2 }, { line_qty: 3 }]
    },
    // a value of the wrong type and missing values must not break a query
    { title: 'delta', dept: 'hr', amount: 'n/a', when: null, urgent: null }
];

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'boditi' | 'trx', OrgUnit>;
const as = {
    bureau: (): As => ({ sub: SUB.bureau, unit: units.ser }),
    bureau2: (): As => ({ sub: SUB.bureau2, unit: units.ser }),
    zoneHead: (): As => ({ sub: SUB.zoneHead, unit: units.zone }),
    damot: (): As => ({ sub: SUB.damot, unit: units.damot }),
    boditi: (): As => ({ sub: SUB.boditi, unit: units.boditi }),
    trx: (): As => ({ sub: SUB.trx, unit: units.trx })
};
/** The form whose fields are filterable, and the one without. */
const forms = { indexed: '', plain: '' };

interface Result {
    items: { id: string; answers: Record<string, unknown> }[];
    total: number;
    aggregates: Record<string, number | null>;
    groups: { key: string | null; key2: string | null; count: number; aggregates: Record<string, number | null> }[];
    facets: Record<string, { value: string | null; count: number }[]>;
}

async function createAndPublish(key: string, fields: unknown[]): Promise<{ id: string; versionId: string }> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau(), {
        key,
        name: { am: `ቅጽ ${key}`, en: `Form ${key}` },
        document: { fields }
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
        {
            'if-match': `"${asked.version}"`
        }
    );
    expect(approved.statusCode, approved.body).toBe(200);
    return { id, versionId: asked.formVersion.id };
}

async function submit(who: As, formId: string, versionId: string, answers: Record<string, unknown>) {
    const res = await api.call('POST', '/api/v1/submissions', who, { formId, formVersionId: versionId, answers });
    expect(res.statusCode, res.body).toBe(201);
}

const query = (formId: string, body: object = {}, who: As = as.damot()) =>
    api.call('POST', '/api/v1/submissions/query', who, { formId, ...body });
const titles = (r: { json: () => unknown }) => (r.json() as Result).items.map((i) => String(i.answers.title));
const cond = (f: string, op: string, value?: unknown) => ({ filter: { op: 'and', items: [{ field: f, op, value }] } });

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
            username: 'test.trx.records',
            sub: SUB.trx,
            region: 'TRX',
            home: 'TRX-W1',
            roles: [['TRX-W1', 'records_officer']]
        }
    ]);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.trx = await api.unit('TRX', 'TRX-W1');
    for (const [name, filterable] of [
        ['indexed', true],
        ['plain', false]
    ] as const) {
        const form = await createAndPublish(`requests-${name}`, fieldsOf(filterable));
        forms[name] = form.id;
        for (const row of ROWS) await submit(as.damot(), form.id, form.versionId, row);
        // another office's request, which Damot Gale never sees
        await submit(as.boditi(), form.id, form.versionId, { title: 'Boditi only', dept: 'sales', amount: 1 });
    }
    // the worker's job after the publication: the fields count as indexed once every submission has its values
    expect((await fillValues(system, forms.indexed)).sort()).toEqual(['amount', 'dept', 'tags', 'urgent', 'when']);
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('the view schema', () => {
    it("describes the form's fields, the part each plays and the view modes", async () => {
        const res = await api.call('GET', `/api/v1/forms/${forms.indexed}/view`, as.damot());
        expect(res.statusCode, res.body).toBe(200);
        const view = res.json<{
            fields: { key: string; kind: string; indexed: boolean; options: unknown[] }[];
            roles: Record<string, unknown>;
            modes: string[];
        }>();
        const kinds = Object.fromEntries(view.fields.map((f) => [f.key, f.kind]));
        expect(kinds).toMatchObject({
            title: 'text',
            dept: 'choice',
            tags: 'multi',
            amount: 'number',
            when: 'date',
            urgent: 'boolean',
            docs: 'files',
            lines: 'rows',
            createdAt: 'datetime',
            submittedBy: 'person',
            handlingUnit: 'unit'
        });
        // passwords and row-scoped fields are not queryable
        expect(kinds).not.toHaveProperty('secret');
        expect(kinds).not.toHaveProperty('line_qty');
        expect(view.roles).toMatchObject({ title: 'title', stage: 'dept', date: 'when', measures: ['amount'] });
        expect(view.modes).toEqual(['table', 'cards', 'board', 'calendar', 'pivot', 'dashboard']);
        expect(view.fields.find((f) => f.key === 'dept')?.options[0]).toEqual({ value: 'sales', label: 'Sales' });
        const indexed = (formId: string) =>
            api.call('GET', `/api/v1/forms/${formId}/view`, as.damot()).then((r) =>
                r
                    .json<typeof view>()
                    .fields.filter((f) => f.indexed && !['createdAt', 'submittedBy', 'handlingUnit'].includes(f.key))
                    .map((f) => f.key)
            );
        expect((await indexed(forms.indexed)).sort()).toEqual(['amount', 'dept', 'tags', 'urgent', 'when']);
        expect(await indexed(forms.plain)).toEqual([]);
    });
});

describe('filters, the same on the value table and on the answers', () => {
    const cases: [string, object, string[]][] = [
        ['dept eq', cond('dept', 'eq', 'sales'), ['Alpha 100%', 'Beta_x']],
        ['dept in', cond('dept', 'in', ['ops', 'hr']), ['Gamma', 'delta']],
        ['dept ne', cond('dept', 'ne', 'sales'), ['Gamma', 'delta']],
        ['title contains, case folded', cond('title', 'contains', 'ALPHA'), ['Alpha 100%']],
        ['% is literal', cond('title', 'contains', '100%'), ['Alpha 100%']],
        ['_ is literal', cond('title', 'contains', '_'), ['Beta_x']],
        ['title starts', cond('title', 'starts', 'ga'), ['Gamma']],
        ['title ncontains', cond('title', 'ncontains', 'a'), []],
        ['amount gt', cond('amount', 'gt', 100), ['Beta_x']],
        ['amount gte', cond('amount', 'gte', 100), ['Alpha 100%', 'Beta_x']],
        ['amount eq', cond('amount', 'eq', 250.5), ['Beta_x']],
        ['amount between', cond('amount', 'between', [40, 100]), ['Alpha 100%', 'Gamma']],
        ['"n/a" reads as no number', cond('amount', 'empty'), ['delta']],
        ['amount notempty', cond('amount', 'notempty'), ['Alpha 100%', 'Beta_x', 'Gamma']],
        ['when eq', cond('when', 'eq', '2026-09-15'), ['Beta_x']],
        ['when gte', cond('when', 'gte', '2026-09-15'), ['Beta_x', 'Gamma']],
        ['when gt', cond('when', 'gt', '2026-09-15'), ['Gamma']],
        ['when lte', cond('when', 'lte', '2026-09-15'), ['Alpha 100%', 'Beta_x']],
        ['when between', cond('when', 'between', ['2026-09-01', '2026-09-30']), ['Alpha 100%', 'Beta_x']],
        ['when empty', cond('when', 'empty'), ['delta']],
        ['urgent true', cond('urgent', 'eq', true), ['Alpha 100%']],
        ['urgent false', cond('urgent', 'eq', false), ['Beta_x', 'Gamma']],
        ['tags has', cond('tags', 'has', 'b'), ['Alpha 100%', 'Beta_x']],
        ['tags hasany', cond('tags', 'hasany', ['a', 'zzz']), ['Alpha 100%']],
        ['tags empty', cond('tags', 'empty'), ['Gamma', 'delta']],
        ['docs notempty', cond('docs', 'notempty'), ['Gamma']],
        ['lines notempty', cond('lines', 'notempty'), ['Alpha 100%', 'Gamma']],
        ['lines empty', cond('lines', 'empty'), ['Beta_x', 'delta']],
        [
            'nested and/or',
            {
                filter: {
                    op: 'or',
                    items: [
                        { field: 'dept', op: 'eq', value: 'hr' },
                        {
                            op: 'and',
                            items: [
                                { field: 'amount', op: 'lt', value: 50 },
                                { field: 'urgent', op: 'eq', value: false }
                            ]
                        }
                    ]
                }
            },
            ['Gamma', 'delta']
        ],
        ['search a title', { search: 'beta' }, ['Beta_x']],
        ['search a choice', { search: 'ops' }, ['Gamma']],
        ['search a literal %', { search: '%' }, ['Alpha 100%']],
        ['nothing', {}, ['Alpha 100%', 'Beta_x', 'Gamma', 'delta']]
    ];

    it.each(cases)('%s', async (_name, body, expected) => {
        for (const formId of [forms.indexed, forms.plain]) {
            const res = await query(formId, body);
            expect(res.statusCode, res.body).toBe(200);
            expect(titles(res).sort(), formId === forms.indexed ? 'value table' : 'answers').toEqual(
                [...expected].sort()
            );
            expect(res.json<Result>().total).toBe(expected.length);
        }
    });
});

describe('built-in fields, sort and pages', () => {
    it('filter by who submitted, the office and the day', async () => {
        const me = await api.userId(SUB.damot);
        expect((await query(forms.indexed, cond('submittedBy', 'eq', me))).json<Result>().total).toBe(4);
        expect((await query(forms.indexed, cond('submittedBy', 'eq', randomUUID()))).json<Result>().total).toBe(0);
        expect((await query(forms.indexed, cond('handlingUnit', 'eq', units.damot.id))).json<Result>().total).toBe(4);
        expect((await query(forms.indexed, cond('createdAt', 'gte', '2020-01-01'))).json<Result>().total).toBe(4);
        expect((await query(forms.indexed, cond('createdAt', 'lt', '2020-01-01'))).json<Result>().total).toBe(0);
    });

    it('sorts with missing values last, in pages', async () => {
        const by = async (sort: object[], extra: object = {}) => titles(await query(forms.indexed, { sort, ...extra }));
        expect(await by([{ field: 'amount' }])).toEqual(['Gamma', 'Alpha 100%', 'Beta_x', 'delta']);
        expect(await by([{ field: 'amount', desc: true }])).toEqual(['Beta_x', 'Alpha 100%', 'Gamma', 'delta']);
        expect(await by([{ field: 'dept' }, { field: 'title' }])).toEqual(['delta', 'Gamma', 'Alpha 100%', 'Beta_x']);
        const page = await query(forms.indexed, { sort: [{ field: 'amount' }], page: 2, pageSize: 3 });
        expect(page.json<Result>().total).toBe(4);
        expect(titles(page)).toEqual(['delta']);
        // a multiple choice has no order
        expect((await query(forms.indexed, { sort: [{ field: 'tags' }] })).statusCode).toBe(400);
    });
});

describe('aggregates, groups and facets', () => {
    it('count, sum and average what the filter matches; group and count values', async () => {
        const r = (
            await query(forms.indexed, {
                rows: false,
                aggregates: [
                    { fn: 'count' },
                    { fn: 'sum', field: 'amount' },
                    { fn: 'avg', field: 'amount', alias: 'mean' },
                    { fn: 'max', field: 'amount' }
                ],
                groupBy: { field: 'dept' },
                facets: ['dept', 'urgent']
            })
        ).json<Result>();
        expect(r.items).toEqual([]);
        expect(r.total).toBe(4);
        expect(r.aggregates.count).toBe(4);
        expect(r.aggregates.sum_amount).toBeCloseTo(390.5);
        expect(r.aggregates.mean).toBeCloseTo(390.5 / 3);
        expect(r.aggregates.max_amount).toBe(250.5);
        const groups = Object.fromEntries(r.groups.map((g): [string, Result['groups'][number]] => [String(g.key), g]));
        expect(groups.sales?.count).toBe(2);
        expect(groups.sales?.aggregates.sum_amount).toBeCloseTo(350.5);
        expect(groups.ops?.count).toBe(1);
        // the biggest group first
        expect(r.groups[0]?.key).toBe('sales');
        const facet = (name: string) =>
            Object.fromEntries((r.facets[name] ?? []).map((f) => [String(f.value), f.count]));
        expect(facet('dept')).toEqual({ sales: 2, ops: 1, hr: 1 });
        expect(facet('urgent')).toEqual({ true: 1, false: 2, null: 1 });
        const months = (
            await query(forms.indexed, { rows: false, groupBy: { field: 'when', bucket: 'month' } })
        ).json<Result>();
        expect(months.groups.filter((g) => g.key).map((g) => [g.key, g.count])).toEqual([
            ['2026-09', 2],
            ['2026-10', 1]
        ]);
        const sales = (
            await query(forms.indexed, {
                rows: false,
                aggregates: [{ fn: 'sum', field: 'amount' }],
                ...cond('dept', 'eq', 'sales')
            })
        ).json<Result>();
        expect(sales.aggregates.sum_amount).toBeCloseTo(350.5);
    });

    it('group in two dimensions for pivots', async () => {
        const r = (
            await query(forms.indexed, {
                rows: false,
                groupBy: { field: 'dept' },
                thenBy: { field: 'urgent' },
                aggregates: [{ fn: 'sum', field: 'amount' }]
            })
        ).json<Result>();
        const cells = Object.fromEntries(
            r.groups.map((g) => [`${g.key}/${g.key2}`, [g.count, g.aggregates.sum_amount]])
        );
        expect(cells['sales/true']).toEqual([1, 100]);
        expect(cells['sales/false']).toEqual([1, 250.5]);
        expect(cells['ops/false']).toEqual([1, 40]);
        // no value is its own cell
        expect(cells['hr/null']?.[0]).toBe(1);
        expect(r.groups.reduce((n, g) => n + g.count, 0)).toBe(4);
        expect((await query(forms.indexed, { thenBy: { field: 'dept' } })).statusCode).toBe(400);
        expect((await query(forms.indexed, { groupBy: { field: 'dept' }, thenBy: { field: 'tags' } })).statusCode).toBe(
            400
        );
    });
});

describe('the allow-list', () => {
    it('refuses unknown fields, wrong operators and values, and abuse, with a 400 or 422', async () => {
        const bad: object[] = [
            cond('nope', 'eq', 1),
            cond('secret', 'eq', 'x'),
            cond('line_qty', 'gt', 1),
            cond('title', 'gt', 'a'),
            cond('amount', 'contains', '1'),
            cond('tags', 'eq', 'a'),
            cond('amount', 'gt', 'abc'),
            cond('when', 'eq', 'not-a-date'),
            cond('when', 'eq', '2026-02-30'),
            cond('urgent', 'eq', 'yes'),
            cond('dept', 'in', []),
            cond('amount', 'between', [1]),
            cond('title', 'eq', { $ne: 1 }),
            cond(
                'dept',
                'in',
                Array.from({ length: 300 }, (_, i) => String(i))
            ),
            cond('submittedBy', 'eq', 'not-an-id'),
            { filter: { op: 'and', items: [{ field: 'title"; drop table x;--', op: 'eq', value: 1 }] } },
            { filter: { op: 'and', items: [{ field: 'title', op: 'regex', value: '.*' }] } },
            { aggregates: [{ fn: 'sum', field: 'title' }] },
            { aggregates: [{ fn: 'sum' }] },
            { aggregates: [{ fn: 'count', alias: 'a b' }] },
            { groupBy: { field: 'tags' } },
            { groupBy: { field: 'amount' } },
            { groupBy: { field: 'when', bucket: 'week' } },
            { facets: ['tags'] },
            { search: 'x'.repeat(101) },
            { pageSize: 1000 },
            { sort: [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }] },
            { unknown: true }
        ];
        for (const body of bad) {
            const res = await query(forms.indexed, body);
            expect([400, 422], JSON.stringify(body)).toContain(res.statusCode);
        }
        let nested: object = { op: 'and', items: [] };
        for (let i = 0; i < 8; i++) nested = { op: 'and', items: [nested] };
        expect((await query(forms.indexed, { filter: nested })).statusCode).toBe(400);
        const fifty = Array.from({ length: 50 }, (_, i) => ({ field: 'title', op: 'eq', value: String(i) }));
        expect((await query(forms.indexed, { filter: { op: 'and', items: fifty } })).statusCode).toBe(200);
        const fiftyOne = {
            op: 'and',
            items: [
                { op: 'and', items: fifty },
                { field: 'title', op: 'eq', value: 'x' }
            ]
        };
        expect((await query(forms.indexed, { filter: fiftyOne })).statusCode).toBe(400);
    });
});

describe('isolation', () => {
    it("shows each office its subtree's rows, and another region nothing", async () => {
        expect((await query(forms.indexed, {}, as.boditi())).json<Result>().items.map((i) => i.answers.title)).toEqual([
            'Boditi only'
        ]);
        expect((await query(forms.indexed, {}, as.zoneHead())).json<Result>().total).toBe(5);
        expect((await query(forms.indexed, cond('dept', 'eq', 'sales'), as.zoneHead())).json<Result>().total).toBe(3);
        expect((await query(forms.indexed, {}, as.trx())).statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/forms/${forms.indexed}/view`, as.trx())).statusCode).toBe(404);
        // the value rows themselves follow the submission's scope
        const values = await api.owner.query<{ code: string }>(
            `select distinct u.code from forms.submission_values v join kernel.org_units u on u.path = v.org_path
              where v.form_id = $1 order by 1`,
            [forms.indexed]
        );
        expect(values.rows.map((r) => r.code)).toEqual(['WOL-BODITI', 'WOL-DAMOT-GALE']);
    });

    it('never lets a field restricted to other roles be filtered, grouped or described', async () => {
        const form = await createAndPublish('restricted', [
            field('plate', 'InputText'),
            field('internal', 'InputText', { visibleToRoles: ['unit_head'], filterable: true })
        ]);
        await submit(as.damot(), form.id, form.versionId, { plate: 'ETH ABC 1234' });
        const view = (await api.call('GET', `/api/v1/forms/${form.id}/view`, as.damot())).json<{
            fields: { key: string }[];
        }>();
        expect(view.fields.map((f) => f.key)).not.toContain('internal');
        for (const body of [cond('internal', 'notempty'), { groupBy: { field: 'internal' } }, { facets: ['internal'] }])
            expect((await query(form.id, body)).statusCode).toBe(400);
    });
});

describe('a field made filterable by a new version', () => {
    it('is filtered on the answers until the worker filled its values, then on the value table', async () => {
        const current = (await api.call('GET', `/api/v1/forms/${forms.indexed}`, as.bureau())).json<{
            version: number;
        }>();
        const next = fieldsOf(true).map((f) => (f.id === 'title' ? { ...f, filterable: true } : f));
        const edited = await api.call(
            'PATCH',
            `/api/v1/forms/${forms.indexed}`,
            as.bureau(),
            { document: { fields: next } },
            {
                'if-match': `"${current.version}"`
            }
        );
        expect(edited.statusCode, edited.body).toBe(200);
        const asked = (await api.call('POST', `/api/v1/forms/${forms.indexed}/publications`, as.bureau(), {})).json<{
            id: string;
            version: number;
        }>();
        expect(
            (
                await api.call(
                    'POST',
                    `/api/v1/form-publications/${asked.id}/approval`,
                    as.bureau2(),
                    {},
                    { 'if-match': `"${asked.version}"` }
                )
            ).statusCode
        ).toBe(200);
        const indexed = async () =>
            (await api.call('GET', `/api/v1/forms/${forms.indexed}/view`, as.damot()))
                .json<{ fields: { key: string; indexed: boolean }[] }>()
                .fields.find((f) => f.key === 'title')?.indexed;
        expect(await indexed()).toBe(false);
        expect(titles(await query(forms.indexed, cond('title', 'eq', 'Gamma')))).toEqual(['Gamma']);
        expect(await fillValues(system, forms.indexed)).toEqual(['title']);
        expect(await indexed()).toBe(true);
        expect(titles(await query(forms.indexed, cond('title', 'eq', 'Gamma')))).toEqual(['Gamma']);
        // again: nothing left to fill
        expect(await fillValues(system, forms.indexed)).toEqual([]);
    });
});

describe('every query', () => {
    it('runs under a statement timeout', async () => {
        const service = api.http.get(SubmissionQueryService);
        const timeout = await api.installer.scoped(contextFor(units.damot), async (tx) => {
            await service.query(tx, ['records_officer'], submissionQuerySchema.parse({ formId: forms.indexed }));
            return (await tx.execute<{ t: string }>(sql`select current_setting('statement_timeout') as t`)).rows[0]?.t;
        });
        expect(timeout).toBe('10s');
    });
});
