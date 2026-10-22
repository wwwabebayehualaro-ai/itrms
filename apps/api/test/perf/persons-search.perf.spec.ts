/**
 * Name search over 10^6 generated persons (task 0.14 "Done when"): a search answers in under 300 ms, and its plan uses the
 * trigram index, with the records then read under RLS by primary key. The names are generated from name parts (never a
 * real person's record): 30 single names and 100 compounds (ገብረ + ማርያም …), in both scripts.
 *   pnpm --filter @itrms/api test:perf
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FieldCrypto } from '@itrms/kernel/crypto';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { findUnitByCode, importOrg, orgUnits, parseOrgYaml, type OrgUnit } from '@itrms/kernel/org';
import { asUnit } from '@itrms/kernel/testing';
import { PersonsService } from '@itrms/parties/api';
import { foldForSearch } from '@itrms/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgres, type TestPostgres } from '../integration/support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const PERSONS = 1_000_000;
const BUDGET_MS = 300;

const SINGLE: [string, string][] = [
    ['አበበ', 'Abebe'],
    ['ከበደ', 'Kebede'],
    ['ተስፋዬ', 'Tesfaye'],
    ['ሙሉጌታ', 'Mulugeta'],
    ['ዳዊት', 'Dawit'],
    ['ሰላም', 'Selam'],
    ['ብርሃኑ', 'Birhanu'],
    ['ሄኖክ', 'Henok'],
    ['ማርታ', 'Marta'],
    ['ትዕግስት', 'Tigist'],
    ['ዮሐንስ', 'Yohannes'],
    ['ፀሐይ', 'Tsehay'],
    ['ወርቁ', 'Worku'],
    ['ታደሰ', 'Tadesse'],
    ['ደስታ', 'Desta'],
    ['ሀይሉ', 'Hailu'],
    ['ጌታቸው', 'Getachew'],
    ['አለሙ', 'Alemu'],
    ['በቀለ', 'Bekele'],
    ['መሰረት', 'Meseret'],
    ['ፍቅሬ', 'Fikre'],
    ['ሳሙኤል', 'Samuel'],
    ['ኤልሳ', 'Elsa'],
    ['ዘውዱ', 'Zewdu'],
    ['ሽፈራው', 'Shiferaw'],
    ['ጫላ', 'Chala'],
    ['ዳንኤል', 'Daniel'],
    ['ሮማን', 'Roman'],
    ['ቢኒያም', 'Biniyam'],
    ['ዳና', 'Dana']
];
const PREFIX: [string, string][] = [
    ['ገብረ', 'Gebre'],
    ['ወልደ', 'Wolde'],
    ['ኃይለ', 'Haile'],
    ['ተክለ', 'Tekle'],
    ['ሀብተ', 'Habte'],
    ['ዘርአ', 'Zera'],
    ['ኪዳነ', 'Kidane'],
    ['ገብረ እግዚ', 'Gebre Egzi'],
    ['ፍሬ', 'Fre'],
    ['አጸደ', 'Atsede']
];
const SUFFIX: [string, string][] = [
    ['ማርያም', 'mariam'],
    ['ሥላሴ', 'selassie'],
    ['ጊዮርጊስ', 'giorgis'],
    ['ሚካኤል', 'mikael'],
    ['መድህን', 'medhin'],
    ['ኢየሱስ', 'iyesus'],
    ['ሕይወት', 'hiwot'],
    ['ጻድቅ', 'tsadik'],
    ['ገሪማ', 'gerima'],
    ['ብርሃን', 'birhan']
];
const NAMES: [string, string][] = [
    ...SINGLE,
    ...PREFIX.flatMap(([pa, pe]) => SUFFIX.map(([sa, se]): [string, string] => [`${pa}${sa}`, `${pe}${se}`]))
];

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let app: Database;
let boditi: OrgUnit;
let regionId: string;
const service = () => new PersonsService(app, new FieldCrypto());

beforeAll(async () => {
    pg = await startPostgres();
    installer = createDatabase(pg.url('owner'));
    app = createDatabase(pg.url('app'));
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    const seed = join(HERE, '..', '..', 'seed', 'org', 'south-ethiopia.wolaita.yaml');
    await installer.scoped({}, (tx) => importOrg(tx, parseOrgYaml(readFileSync(seed, 'utf8'))));
    boditi = await installer.scoped({}, async (tx) => {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, 'SER')));
        const unit = root && (await findUnitByCode(tx, root.id, 'WOL-BODITI'));
        if (!unit) throw new Error('no Boditi');
        return unit;
    });
    regionId = boditi.regionId;

    // a bulk load, as an installer's import would: the scope column from the unit, the trigram index built after
    const am = NAMES.map(([a]) => a);
    const en = NAMES.map(([, e]) => e);
    const foldedAm = am.map(foldForSearch);
    const foldedEn = en.map(foldForSearch);
    await owner.query('ALTER TABLE parties.persons DISABLE TRIGGER set_org_path');
    await owner.query('DROP INDEX parties.persons_search_trgm');
    await owner.query(
        `WITH units AS (SELECT array_agg(id ORDER BY code) AS ids, array_agg(path ORDER BY code) AS paths,
                                count(*)::int AS total
                           FROM kernel.org_units WHERE region_id = $7)
         INSERT INTO parties.persons (id, region_id, handling_unit_id, handling_org_path, given_name_am, father_name_am,
             grandfather_name_am, given_name_en, father_name_en, grandfather_name_en, sex, birth_year, search_text,
             name_key_am, name_key_en)
         SELECT gen_random_uuid(), $7, units.ids[1 + n % units.total], units.paths[1 + n % units.total],
                ($1::text[])[g], ($1::text[])[f], ($1::text[])[gf], ($2::text[])[g], ($2::text[])[f], ($2::text[])[gf],
                CASE WHEN n % 2 = 0 THEN 'female' ELSE 'male' END, 1950 + n % 55,
                concat_ws(' ', ($3::text[])[g], ($3::text[])[f], ($3::text[])[gf],
                               ($4::text[])[g], ($4::text[])[f], ($4::text[])[gf]),
                ($3::text[])[g] || ' ' || ($3::text[])[f], ($4::text[])[g] || ' ' || ($4::text[])[f]
           FROM units, generate_series(1, $5::int) n,
                -- each name picked on its own: given, father and grandfather vary independently
                LATERAL (SELECT 1 + n % $6 AS g, 1 + (n / $6) % $6 AS f, 1 + (n / ($6 * $6) + n) % $6 AS gf) pick`,
        [am, en, foldedAm, foldedEn, PERSONS, NAMES.length, regionId]
    );
    await owner.query('ALTER TABLE parties.persons ENABLE TRIGGER set_org_path');
    await owner.query('CREATE INDEX persons_search_trgm ON parties.persons USING gin (search_text gin_trgm_ops)');
    await owner.query('ANALYZE parties.persons');
}, 1_200_000);

afterAll(async () => {
    await app?.close();
    await installer?.close();
    await owner?.end();
    await pg?.stop();
});

/** The median of five timed runs after a warm-up, as a person of Boditi. */
async function timed(q: string): Promise<{ ms: number; found: number }> {
    const run = () => asUnit(app, boditi, (tx) => service().search(tx, q, 20));
    await run();
    const times: number[] = [];
    let found = 0;
    for (let i = 0; i < 5; i++) {
        const started = performance.now();
        found = (await run()).length;
        times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    return { ms: times[2] ?? Infinity, found };
}

function indexesOf(plan: unknown): string[] {
    if (!plan || typeof plan !== 'object') return [];
    const node = plan as Record<string, unknown>;
    return [
        ...(typeof node['Index Name'] === 'string' ? [node['Index Name']] : []),
        ...Object.values(node).flatMap((v) => (Array.isArray(v) ? v.flatMap(indexesOf) : indexesOf(v)))
    ];
}

describe(`name search over ${PERSONS.toLocaleString('en')} persons`, () => {
    it('holds them all', async () => {
        const { rows } = await owner.query('select count(*)::int as n from parties.persons');
        expect(rows[0]).toEqual({ n: PERSONS });
    });

    const queries = [
        ['a full name in Ethiopic', 'አበበ ከበደ'],
        ['a full name in Latin script', 'abebe kebede'],
        ['a compound name and a father name', 'ገብረማርያም ተስፋዬ'],
        ['three names', 'tsehay hailu gebremariam'],
        ['a homophone spelling', 'ጸሀይ ሃይሉ'],
        ['one common name', 'ዳዊት'],
        ['a part of a name', 'gebre']
    ] as const;
    for (const [what, q] of queries)
        it(`answers ${what} (${q}) within ${BUDGET_MS} ms`, async () => {
            const { ms, found } = await timed(q);
            // the timings are the task's evidence (progress.md)
            console.warn(`search "${q}": ${ms.toFixed(1)} ms, ${found} shown`);
            expect(found).toBeGreaterThan(0);
            expect(ms).toBeLessThan(BUDGET_MS);
        });

    it('plans the search on the trigram index, and reads the records under RLS by primary key', async () => {
        const { rows } = await owner.query<{ q: string }>('select parties.person_search_sql($1, $2, 20) as q', [
            regionId,
            foldForSearch('abebe kebede')
        ]);
        const search = await owner.query(`EXPLAIN (FORMAT JSON) ${rows[0]?.q ?? ''}`);
        expect(indexesOf(search.rows[0])).toContain('persons_search_trgm');

        const ids = (await asUnit(app, boditi, (tx) => service().search(tx, 'abebe kebede', 20))).map((p) => p.id);
        const read = await asUnit(app, boditi, (tx) =>
            tx.execute(
                sql`EXPLAIN (FORMAT JSON) select * from parties.persons where id in (${sql.join(
                    ids.map((id) => sql`${id}::uuid`),
                    sql`, `
                )})`
            )
        );
        const plan = JSON.stringify(read.rows[0]);
        expect(indexesOf(read.rows[0])).toContain('persons_pkey');
        // the region policy (RLS) filters what the key finds; its setting is read once, in an init plan
        expect(plan).toContain('"Filter":"(region_id = $0)"');
        expect(plan).toContain('"Subplan Name":"InitPlan 1 (returns $0)"');
    });
});
