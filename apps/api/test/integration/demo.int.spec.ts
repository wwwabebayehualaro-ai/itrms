/**
 * What the demo is seeded with (task 0.25a, docs/demo-plan.md §4): generated people, licences in the states the journey needs, and the
 * neutral branding. `pnpm demo:reset` itself, and its time limit, run in the e2e job of CI, whose journeys then run on what it made.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importDemoData, importLicenceGrades, setUpLicenceCounters, type DemoCounts } from '@itrms/competency/seed';
import { addisDay, addMonths, addYears } from '@itrms/competency/contracts';
import { ethiopianHolidays } from '@itrms/ethiopian-calendar';
import { OrganisationsService, PersonsService } from '@itrms/parties/api';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

    it('is under the neutral branding, and has a zone’s holiday', async () => {
        const { rows } = await api.owner.query<{ value: { title: { en: string } } }>(
            `select value from kernel.settings_values where key = 'documents.header'`
        );
        expect(rows[0]?.value.title.en).toBe('Sample Regional Transport Bureau');
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
