/**
 * Queries over 10^6 generated submissions of one form (task 0.16b "Done when"): a filter on an indexed filterable field
 * answers in under 300 ms as a zone's officer under RLS, and its plan reads the value table's indexes (ADR-0035). The
 * answers are generated (plate numbers, offices, amounts), never a real record; the plans are printed as the evidence.
 *   pnpm --filter @itrms/api test:perf
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabase, type Database } from '@itrms/kernel/db';
import { findUnitByCode, importOrg, orgUnits, parseOrgYaml, type OrgUnit } from '@itrms/kernel/org';
import { asUnit } from '@itrms/kernel/testing';
import { FormsService, SubmissionQueryService, SubmissionsService } from '@itrms/forms/api';
import { submissionQuerySchema } from '@itrms/forms/contracts';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgres, type TestPostgres } from '../integration/support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
// PERF_SUBMISSIONS: a smaller load while working on a plan (the task's evidence is the full one)
const SUBMISSIONS = Number(process.env.PERF_SUBMISSIONS ?? 1_000_000);
const BUDGET_MS = 300;
const FORM = '0199f0a0-f000-7000-8000-000000000001';
const VERSION = '0199f0a0-f000-7000-8000-000000000002';

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    ...extra
});
const DOCUMENT = {
    fields: [
        field('plate', 'InputText', { filterable: true }),
        field('office', 'Dropdown', { filterable: true }),
        field('amount', 'InputNumber', { filterable: true }),
        field('remark', 'InputText')
    ]
};

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let app: Database;
let zone: OrgUnit;
let woreda: OrgUnit;
const service = () => new SubmissionQueryService(new FormsService(), new SubmissionsService());

async function unitAt(code: string): Promise<OrgUnit> {
    return installer.scoped({}, async (tx) => {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, 'SER')));
        const unit = root && (await findUnitByCode(tx, root.id, code));
        if (!unit) throw new Error(`no ${code}`);
        return unit;
    });
}

beforeAll(async () => {
    pg = await startPostgres();
    installer = createDatabase(pg.url('owner'));
    app = createDatabase(pg.url('app'));
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    const seed = join(HERE, '..', '..', 'seed', 'org', 'south-ethiopia.wolaita.yaml');
    await installer.scoped({}, (tx) => importOrg(tx, parseOrgYaml(readFileSync(seed, 'utf8'))));
    zone = await unitAt('WOL');
    woreda = await unitAt('WOL-BODITI');
    const region = zone.regionId;

    // the bureau's form, published, its three filterable fields indexed (as after the worker's fill)
    const root = await unitAt('SER');
    await owner.query(
        `insert into forms.form_definitions (id, region_id, owner_unit_id, key, name, document, document_hash, indexed_keys)
         values ($1, $2, $3, 'vehicle-inspection', '{"am":"ምርመራ","en":"Inspection"}', $4, repeat('0', 64),
                 '{plate,office,amount}')`,
        [FORM, region, root.id, JSON.stringify(DOCUMENT)]
    );
    await owner.query(
        `insert into forms.form_versions (id, region_id, owner_unit_id, form_id, number, content_hash, document)
         values ($1, $2, $3, $4, 1, repeat('0', 64), $5)`,
        [VERSION, region, root.id, FORM, JSON.stringify(DOCUMENT)]
    );
    await owner.query(
        'update forms.form_definitions set published_version_id = $1, published_at = now() where id = $2',
        [VERSION, FORM]
    );

    // a bulk load, as an import would: the scope column from the unit, the indexes built after
    await owner.query('ALTER TABLE forms.submissions DISABLE TRIGGER set_org_path');
    await owner.query('ALTER TABLE forms.submission_values DISABLE TRIGGER set_org_path');
    for (const index of [
        'submission_values_text_idx',
        'submission_values_num_idx',
        'submissions_form_idx',
        'submissions_form_creator_idx'
    ])
        await owner.query(`DROP INDEX forms.${index}`);
    await owner.query(
        `WITH units AS (SELECT array_agg(id ORDER BY code) AS ids, array_agg(path ORDER BY code) AS paths, count(*)::int AS total
                          FROM kernel.org_units WHERE region_id = $1 AND path <@ $5::ltree AND path <> $5::ltree)
         INSERT INTO forms.submissions (id, region_id, handling_unit_id, org_path, form_id, form_version_id, answers, created_at)
         SELECT gen_random_uuid(), $1, units.ids[1 + n % units.total], units.paths[1 + n % units.total], $2, $3,
                jsonb_build_object('plate', 'ETH ' || chr(65 + n % 26) || chr(65 + (n / 26) % 26) || ' ' || lpad((n % 100000)::text, 5, '0'),
                                   'office', 'office-' || (n % 997), 'amount', (n::bigint * 7919) % 100000, 'remark', 'generated'),
                now() - make_interval(secs => n)
           FROM units, generate_series(1, $4::int) n`,
        [region, FORM, VERSION, SUBMISSIONS, zone.path]
    );
    await owner.query(
        `INSERT INTO forms.submission_values (submission_id, ordinal, form_id, field_key, region_id, handling_unit_id, org_path,
                                              value_text, value_num)
         SELECT s.id, 0, s.form_id, k.key, s.region_id, s.handling_unit_id, s.org_path,
                CASE WHEN k.key <> 'amount' THEN s.answers ->> k.key END,
                CASE WHEN k.key = 'amount' THEN (s.answers ->> 'amount')::float8 END
           FROM forms.submissions s, (VALUES ('plate'), ('office'), ('amount')) k(key)`
    );
    await owner.query('ALTER TABLE forms.submissions ENABLE TRIGGER set_org_path');
    await owner.query('ALTER TABLE forms.submission_values ENABLE TRIGGER set_org_path');
    await owner.query(`CREATE INDEX submission_values_text_idx ON forms.submission_values
        (form_id, field_key, value_text, submission_id) WHERE value_text IS NOT NULL`);
    await owner.query(`CREATE INDEX submission_values_num_idx ON forms.submission_values
        (form_id, field_key, value_num, submission_id) WHERE value_num IS NOT NULL`);
    await owner.query('CREATE INDEX submissions_form_idx ON forms.submissions (form_id, id DESC)');
    await owner.query('CREATE INDEX submissions_form_creator_idx ON forms.submissions (form_id, created_by, id DESC)');
    await owner.query('ANALYZE forms.submissions');
    await owner.query('ANALYZE forms.submission_values');
}, 1_800_000);

afterAll(async () => {
    await app?.close();
    await installer?.close();
    await owner?.end();
    await pg?.stop();
});

const parse = (body: object) => submissionQuerySchema.parse({ formId: FORM, ...body });
const cond = (field: string, op: string, value: unknown) => ({ filter: { op: 'and', items: [{ field, op, value }] } });

/** The median of five timed queries after a warm-up. */
async function timed(unit: OrgUnit, body: object) {
    const run = () => asUnit(app, unit, (tx) => service().query(tx, ['unit_head'], parse(body)));
    await run();
    const times: number[] = [];
    let total = 0;
    for (let i = 0; i < 5; i++) {
        const started = performance.now();
        total = (await run()).total;
        times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    return { ms: times[2] ?? Infinity, total };
}

function indexesOf(plan: unknown): string[] {
    if (!plan || typeof plan !== 'object') return [];
    const node = plan as Record<string, unknown>;
    return [
        ...(typeof node['Index Name'] === 'string' ? [node['Index Name']] : []),
        ...Object.values(node).flatMap((v) => (Array.isArray(v) ? v.flatMap(indexesOf) : indexesOf(v)))
    ];
}

// the plate of n = 424242 (see the load): about one in the zone
const PLATE = 'ETH AP 24242';
const QUERIES: [string, object, 'zone' | 'both'][] = [
    ['one plate (text, eq)', cond('plate', 'eq', PLATE), 'zone'],
    ['two offices (choice, in)', cond('office', 'in', ['office-7', 'office-8']), 'both'],
    ['an amount range (number, between)', cond('amount', 'between', [500, 520]), 'both']
];

describe(`queries over ${SUBMISSIONS.toLocaleString('en')} submissions`, () => {
    it('holds them all, with their values', async () => {
        const { rows } = await owner.query<{ s: number; v: number }>(
            'select (select count(*) from forms.submissions)::int as s, (select count(*) from forms.submission_values)::int as v'
        );
        expect(rows[0]).toEqual({ s: SUBMISSIONS, v: 3 * SUBMISSIONS });
    });

    for (const [what, body, where] of QUERIES)
        it(`answers ${what} within ${BUDGET_MS} ms (${where === 'both' ? 'the zone and a woreda' : 'the zone'})`, async () => {
            for (const unit of where === 'both' ? [zone, woreda] : [zone]) {
                const { ms, total } = await timed(unit, body);
                // the timings are the task's evidence (progress.md)
                console.warn(`${what} as ${unit.code}: ${ms.toFixed(1)} ms, ${total} found`);
                expect(total).toBeGreaterThan(0);
                expect(ms).toBeLessThan(BUDGET_MS);
            }
        });

    it('plans each filter on the value table, with RLS applied (the plans are the evidence)', async () => {
        // the statement the service runs for the rows, explained as the woreda's officer (itrms_app, RLS on)
        const explain = (where: SQL) =>
            asUnit(app, woreda, (tx) =>
                tx.execute(
                    sql`explain (analyze, format json) select * from forms.submissions
                         where forms.submissions.form_id = ${FORM}::uuid and ${where}
                         order by forms.submissions.created_at desc nulls last, forms.submissions.id desc limit 20`
                )
            );
        const value = (key: string, where: SQL) =>
            sql`forms.submissions.id in (select submission_id from forms.submission_values
                 where form_id = ${FORM}::uuid and field_key = ${key} and ${where})`;
        for (const [key, where, index] of [
            ['plate', sql`value_text = ${PLATE}`, 'submission_values_text_idx'],
            ['amount', sql`value_num >= 500 and value_num <= 520`, 'submission_values_num_idx']
        ] as const) {
            const plan = (await explain(value(key, where))).rows[0];
            const text = JSON.stringify(plan);
            console.warn(`EXPLAIN (woreda, ${key}): ${text}`);
            expect(indexesOf(plan)).toContain(index);
            // RLS: the region and the woreda's scope filter the rows, its settings read once (init plans)
            expect(text).toMatch(/region_id = \$\d/);
            expect(text).toMatch(/org_path <@ \$\d/);
        }
    });
});
