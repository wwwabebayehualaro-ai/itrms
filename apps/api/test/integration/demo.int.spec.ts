/**
 * What the demo is seeded with (task 0.25a, docs/demo-plan.md §4): generated people, licences in the states the journey needs, and the
 * neutral branding. `pnpm demo:reset` itself, and its time limit, run in the e2e job of CI, whose journeys then run on what it made.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importDemoData, importLicenceGrades, setUpLicenceCounters, type DemoCounts } from '@itrms/competency/seed';
import { importRegionSettings, importUsers, regionSettingsSchema, userImportSchema } from '@itrms/kernel/seed';
import { loadSlices } from '@itrms/kernel/api';
import { DocumentsService } from '@itrms/documents/api';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importOrg, parseOrgYaml } from '@itrms/kernel/org';
import { parse as parseYaml } from 'yaml';
import { addisDay, addMonths, addYears } from '@itrms/competency/contracts';
import { ethiopianHolidays } from '@itrms/ethiopian-calendar';
import { OrganisationsService, PersonsService } from '@itrms/parties/api';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SLICES } from '../../src/slices';
import { startApi, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');
const TODAY = addisDay();

let pg: TestPostgres;
let api: TestApi;
let seeded: DemoCounts | null;

const deps = () => ({
    persons: api.http.get(PersonsService),
    organisations: api.http.get(OrganisationsService)
});
/** A region's settings file, as `seed settings` applies it. Returns how many it set. */
const applySettings = async (name: string) => {
    const doc = regionSettingsSchema.parse(
        parseYaml(readFileSync(join(HERE, '..', '..', 'seed', 'settings', name), 'utf8'))
    );
    const root = await api.unit(doc.region, doc.region);
    return api.installer.scoped(
        { requestId: 'seed:settings', regionId: root.regionId, unitId: root.id, scopePath: root.path },
        (tx) => importRegionSettings(tx, root, doc.settings, loadSlices(SLICES).settings)
    );
};
const count = async (sql: string, params: unknown[] = []) =>
    (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg);
    const region = await api.unit('SER', 'SER');
    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importLicenceGrades(tx, root);
        await setUpLicenceCounters(tx, root.regionId);
    });
    seeded = await importDemoData(api.installer, 'SER', deps(), TODAY);
    await applySettings('sample-region.demo.yaml');
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('the demo’s data', () => {
    it('has the people, schools and licences of the plan', () => {
        expect(seeded).toEqual({ persons: 200, organisations: 5, licences: 60, enrolments: 20, examSessions: 8 });
    });

    it('holds nobody’s identity: no Fayda number, no phone, and a birth date only in its encrypted column', async () => {
        expect(
            await count(
                'select count(*)::int as n from parties.person_sensitive where fin_ct is not null or phone_ct is not null'
            )
        ).toBe(0);
        expect(
            await count('select count(*)::int as n from parties.person_sensitive where birth_date_ct is not null')
        ).toBe(200);
    });

    it('has the ages of Art. 12’s bands, including some too young and some over 55', async () => {
        const year = Number(TODAY.slice(0, 4));
        expect(
            await count('select count(*)::int as n from parties.persons where birth_year > $1', [year - 17])
        ).toBeGreaterThan(0);
        expect(
            await count('select count(*)::int as n from parties.persons where birth_year < $1', [year - 56])
        ).toBeGreaterThan(0);
    });

    it('has licences in every state the journey needs, numbered by their offices with no gap', async () => {
        const between = (from: string, to: string) =>
            count(
                `select count(*)::int as n from competency.driver_licences
                  where status = 'active' and valid_until >= $1 and valid_until < $2`,
                [from, to]
            );
        expect(await count(`select count(*)::int as n from competency.driver_licences where kind = 'temporary'`)).toBe(
            16
        );
        // expired under a year ago, and over a year ago
        expect(await between(addMonths(TODAY, -12), TODAY)).toBe(10);
        expect(await between('2000-01-01', addMonths(TODAY, -12))).toBe(8);
        // every licence has its grade
        expect(await count('select count(distinct licence_id)::int as n from competency.licence_grades')).toBe(60);
        const { rows } = await api.owner.query<{ unit: string; numbers: string[] }>(
            `select u.code as unit, array_agg(l.number order by l.number) as numbers
               from competency.driver_licences l join kernel.org_units u on u.id = l.handling_unit_id group by u.code`
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const { unit, numbers } of rows)
            expect(numbers, unit).toEqual(numbers.map((_, i) => `${unit}/DL/${String(i + 1).padStart(6, '0')}`));
    });

    it('gives each licence the term its rules give, and a holder old enough on the day it was issued', async () => {
        const { rows } = await api.owner.query<{ kind: string; issued: string; until: string; over55: boolean }>(
            `select l.kind, l.issued_on::text as issued, l.valid_until::text as until,
                    extract(year from now()) - p.birth_year >= 56 as over55
               from competency.driver_licences l join parties.persons p on p.id = l.person_id`
        );
        for (const { kind, issued, until, over55 } of rows) {
            const years = kind === 'temporary' ? 2 : over55 ? [2, 4] : 4;
            const allowed = (Array.isArray(years) ? years : [years]).map((y) => addYears(issued, y));
            expect(allowed, `${kind} ${issued}`).toContain(until);
        }
        // the year's difference is the most the holder's age can be: below the grade's minimum, they certainly were too young
        expect(
            await count(
                `select count(*)::int as n from competency.driver_licences l
                   join parties.persons p on p.id = l.person_id
                   join competency.licence_grades g on g.licence_id = l.id
                   join competency.licence_grade_types t on t.id = g.grade_type_id
                  where extract(year from l.issued_on) - p.birth_year < t.min_age`
            )
        ).toBe(0);
    });

    it('sets exam days and a zone’s holiday on days an office would otherwise be open', async () => {
        const { rows } = await api.owner.query<{ day: string }>(
            `select held_on::text as day from competency.exam_sessions
             union all select date::text from workflow.holidays where key = 'gifaata'`
        );
        expect(rows).toHaveLength(9);
        for (const { day } of rows) {
            const date = new Date(`${day}T00:00:00Z`);
            expect([0, 6], day).not.toContain(date.getUTCDay());
            expect(
                ethiopianHolidays(date.getUTCFullYear()).map((h) => h.date),
                day
            ).not.toContain(day);
        }
    });

    it('has the zone’s renewals paid at the revenue office, and Boditi keep its till', async () => {
        const { rows } = await api.owner.query<{ code: string; collection: string }>(
            `select u.code, o.values->>'payment.collection' as collection
               from services.service_overrides o
               join services.service_definitions d on d.id = o.service_id and d.code = 'DVC-04'
               join kernel.org_units u on u.id = o.unit_id
              order by u.code`
        );
        expect(rows).toEqual([
            { code: 'WOL', collection: 'elsewhere' },
            { code: 'WOL-BODITI', collection: 'cashier' }
        ]);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log where table_name = 'services.service_overrides'`
            )
        ).toBe(2);
    });

    it('is under the neutral branding, and has a zone’s holiday', async () => {
        const { rows } = await api.owner.query<{ value: { en: string } }>(
            `select value from kernel.settings_values where key = 'ui.brandName'`
        );
        expect(rows[0]?.value.en).toBe('Sample Regional Transport Bureau');
        expect(await count(`select count(*)::int as n from workflow.holidays where key = 'gifaata'`)).toBe(1);
    });

    it('is on record, and seeded once', async () => {
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log where table_name = 'competency.driver_licences'`
            )
        ).toBeGreaterThanOrEqual(60);
        for (const table of [
            'parties.persons',
            'parties.person_sensitive',
            'parties.organisations',
            'competency.licence_grades',
            'competency.training_enrolments',
            'competency.exam_sessions',
            'workflow.holidays',
            'kernel.settings_values'
        ])
            expect(
                await count('select count(*)::int as n from kernel.audit_log where table_name = $1', [table]),
                table
            ).toBeGreaterThan(0);
        expect(await importDemoData(api.installer, 'SER', deps(), TODAY)).toBeNull();
        // nobody came twice
        expect(await count(`select count(*)::int as n from competency.driver_licences`)).toBe(60);
        expect(await count(`select count(*)::int as n from parties.persons`)).toBe(200);
    });
});

describe('the second demo region', () => {
    const CITY_ADMIN = '0199f0a0-d000-7000-8000-000000000501';
    const seeds = join(HERE, '..', '..', 'seed');

    beforeAll(async () => {
        const org = parseOrgYaml(readFileSync(join(seeds, 'org', 'sample-city.yaml'), 'utf8'));
        const users = userImportSchema.parse(
            parseYaml(readFileSync(join(seeds, 'users', 'sample-city.demo.yaml'), 'utf8'))
        );
        await api.installer.scoped({}, async (tx) => {
            await importOrg(tx, org);
            await importUsers(tx, users);
        });
        expect(await applySettings('sample-city.demo.yaml')).toBe(2);
    });

    it('has its own levels, its sub-cities, and a language of its own', async () => {
        const { rows: levels } = await api.owner.query<{ key: string; name: { en: string } }>(
            `select l.key, l.name from kernel.org_level_definitions l
               join kernel.org_units u on u.region_id = l.region_id and u.code = 'SCA' and u.parent_id is null
              order by l.rank`
        );
        expect(levels.map((l) => l.key)).toEqual(['region', 'sub_city', 'district']);
        expect(levels[0]?.name.en).toBe('City administration');
        const { rows } = await api.owner.query<{ value: unknown }>(
            `select v.value from kernel.settings_values v join kernel.org_units u on u.id = v.unit_id
              where u.code = 'SCA' and v.key = 'i18n.languages'`
        );
        expect(rows[0]?.value).toEqual(['am', 'en']);
    });

    it('has its own branding, and the first region keeps its own', async () => {
        const { rows } = await api.owner.query<{ code: string; title: string }>(
            `select u.code, v.value->>'en' as title from kernel.settings_values v
               join kernel.org_units u on u.id = v.unit_id where v.key = 'ui.brandName' order by u.code`
        );
        expect(rows).toEqual([
            { code: 'SCA', title: 'Sample City Transport Authority' },
            { code: 'SER', title: 'Sample Regional Transport Bureau' }
        ]);
    });

    it('keeps the two registers apart, each way', async () => {
        const firstName = async (region: string) => {
            const { rows } = await api.owner.query<{ name: string }>(
                `select p.given_name_en as name from parties.persons p
                   join kernel.org_units u on u.region_id = p.region_id and u.code = $1 and u.parent_id is null
                  where p.given_name_en is not null limit 1`,
                [region]
            );
            return rows[0]?.name ?? '';
        };
        const search = async (as: { sub: string; unit: Awaited<ReturnType<TestApi['unit']>> }, name: string) => {
            const res = await api.call('GET', `/api/v1/persons?q=${encodeURIComponent(name)}`, as);
            expect(res.statusCode, res.body).toBe(200);
            return res.json<{ items: unknown[] }>().items;
        };
        const north = await api.unit('SCA', 'SCA-NORTH');
        const asCity = { sub: '0199f0a0-d000-7000-8000-000000000502', unit: north };
        const asFirst = { sub: '0199f0a0-d000-7000-8000-000000000202', unit: await api.unit('SER', 'WOL-DAMOT-GALE') };

        // a name the first region's own officer finds, and the city's does not
        const theirs = await firstName('SER');
        expect(theirs, 'the first region has people').not.toBe('');
        expect((await search(asFirst, theirs)).length).toBeGreaterThan(0);
        expect(await search(asCity, theirs)).toEqual([]);

        // and the other way: a person registered in the city, under a name the first region has no one of
        const created = await api.call('POST', '/api/v1/persons', asCity, {
            nameAm: { given: 'ቀነኒ', father: 'ከተማ', grandfather: 'ናሙና' },
            nameEn: { given: 'Qananii', father: 'Katama', grandfather: 'Namuna' },
            sex: 'female',
            address: { unitId: north.id, kebele: '01' },
            sensitive: { birthDate: '1990-03-14', phone: '0911 500501', fin: '400000000501' }
        });
        expect(created.statusCode, created.body).toBe(201);
        expect((await search(asCity, 'Qananii')).length).toBe(1);
        expect(await search(asFirst, 'Qananii')).toEqual([]);
    });

    it('has its own units and level names, and none of the first region', async () => {
        const city = await api.unit('SCA', 'SCA');
        const res = await api.call('GET', `/api/v1/org-units/${city.id}/subtree`, { sub: CITY_ADMIN, unit: city });
        expect(res.statusCode, res.body).toBe(200);
        const units = res.json<{ code: string; level: { name: { en: string } } }[]>();
        expect(units.map((u) => u.code).sort()).toEqual(['SCA', 'SCA-NORTH', 'SCA-NORTH-D1', 'SCA-SOUTH']);
        expect(units.find((u) => u.code === 'SCA-SOUTH')?.level.name.en).toBe('Sub-city');
    });

    it('offers its people its languages', async () => {
        const city = await api.unit('SCA', 'SCA');
        const res = await api.call('GET', '/api/v1/me/workspace', { sub: CITY_ADMIN, unit: city });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json<{ settings: Record<string, unknown> }>().settings['i18n.languages']).toEqual(['am', 'en']);
        // and the first region's own, with Wolaytta
        const first = await api.unit('SER', 'WOL-DAMOT-GALE');
        const theirs = await api.call('GET', '/api/v1/me/workspace', {
            sub: '0199f0a0-d000-7000-8000-000000000202',
            unit: first
        });
        expect(theirs.statusCode, theirs.body).toBe(200);
        expect(theirs.json<{ settings: Record<string, unknown> }>().settings['i18n.languages']).toEqual([
            'am',
            'en',
            'wal-Latn'
        ]);
    });

    it('prints its own name on a document of a sub-city, which inherits it', async () => {
        const city = await api.unit('SCA', 'SCA');
        const north = await api.unit('SCA', 'SCA-NORTH');
        await api.installer.scoped({}, (tx) => importDocumentTemplates(tx, { id: city.id, regionId: city.regionId }));
        const issued = await api.installer.scoped({ requestId: 'system:test' }, (tx) =>
            api.http.get(DocumentsService).issue(tx, {
                regionId: north.regionId,
                handlingUnitId: north.id,
                templateKey: 'licence-card',
                language: 'am',
                number: 'SCA-1',
                data: {
                    number: 'SCA-1',
                    holderName: 'Generated Holder',
                    birthDate: null,
                    grades: [{ grade: 'B', name: { am: 'አውቶሞቢል', en: 'Automobile' } }],
                    issuedOn: '2020-01-01',
                    validUntil: '2024-01-01',
                    photo: null
                }
            })
        );
        const { rows } = await api.owner.query<{ header: { title?: { en?: string } } }>(
            'select header from documents.issued_documents where id = $1',
            [issued.id]
        );
        expect(rows[0]?.header.title?.en).toBe('Sample City Transport Authority');
    });

    it('has a team that can take a case from counter to document', async () => {
        const { rows } = await api.owner.query<{ role_key: string }>(
            `select distinct a.role_key from kernel.role_assignments a
               join kernel.org_units u on u.id = a.unit_id where u.code = 'SCA-NORTH' order by a.role_key`
        );
        expect(rows.map((r) => r.role_key)).toEqual([
            'cashier',
            'competency.examiner',
            'competency.lead',
            'competency.officer',
            'records_officer'
        ]);
    });

    it('sets its settings once, each on the record, and leaves one a bureau has changed', async () => {
        const written = () =>
            count(`select count(*)::int as n from kernel.audit_log where table_name = 'kernel.settings_values'`);
        const before = await written();
        expect(before, 'every setting written has its audit row').toBe(
            await count('select count(*)::int as n from kernel.settings_values')
        );
        // a bureau's own change, by its screen's path (here straight in the table, put back whatever happens)
        const languages = `update kernel.settings_values set value = $1::jsonb where key = 'i18n.languages'
            and unit_id = (select id from kernel.org_units where code = 'SCA' and parent_id is null)`;
        await api.owner.query(languages, ['["am","en","wal-Latn"]']);
        try {
            expect(await applySettings('sample-city.demo.yaml')).toBe(0);
            expect(await written()).toBe(before);
            const { rows } = await api.owner.query<{ value: unknown }>(
                `select v.value from kernel.settings_values v join kernel.org_units u on u.id = v.unit_id
                  where u.code = 'SCA' and v.key = 'i18n.languages'`
            );
            expect(rows[0]?.value).toEqual(['am', 'en', 'wal-Latn']);
        } finally {
            await api.owner.query(languages, ['["am","en"]']);
        }
        // and on the record as set in the region
        const { rows: audited } = await api.owner.query<{ code: string }>(
            `select distinct u.code from kernel.audit_log a join kernel.org_units u on u.id = a.unit_id
              where a.table_name = 'kernel.settings_values' order by u.code`
        );
        expect(audited.map((r) => r.code)).toEqual(['SCA', 'SER']);
    });
});
