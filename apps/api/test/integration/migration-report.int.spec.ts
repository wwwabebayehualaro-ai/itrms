/**
 * The reconciliation report of the paper-record migration (ADR-0054 §4, task 1.13h) through the API and the worker's handlers, on a
 * real PostgreSQL 16 with the Wolaita seeds. Paper files migrated at Boditi by two sheets (plate codes 3 and 1) are counted by the
 * report exactly as an independent SQL count of the register counts them, per office and code. The zone above sets the paper counts
 * (on record, with If-Match for a change); an office never sets its own; a checked sheet and an open capture are shown as awaiting;
 * a sibling office sees no count. Plates, chassis numbers, references, names and phones are generated.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { VehicleImportService } from '@itrms/competency/api';
import { vehicleImportHandlers } from '@itrms/competency/api/worker';
import type { MigrationReport, ReconciliationOffice, VehicleImport } from '@itrms/competency/contracts';
import competencyAm from '@itrms/competency/messages/am';
import competencyEn from '@itrms/competency/messages/en';
import { importBackCaptureService } from '@itrms/competency/seed';
import { loadSlices } from '@itrms/kernel/api';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { NO_OBJECT_STORE } from '@itrms/kernel/files';
import { permissionsOf, rolePermissions } from '@itrms/kernel/iam';
import type { OrgUnit } from '@itrms/kernel/org';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SLICES } from '../../src/slices';
import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    clerk: '0199f0a0-d000-7000-8000-00000000d401',
    verifier: '0199f0a0-d000-7000-8000-00000000d402',
    zone: '0199f0a0-d000-7000-8000-00000000d403'
};
type Who = keyof typeof SUB;

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let system: SystemDatabase;
let boditi: OrgUnit;
let zone: OrgUnit;
/** a sibling office of Boditi (a woreda: it holds no competency roles, so it is read as an office, under RLS) */
let damot: OrgUnit;
const as = {} as Record<Who, As>;
const id = {} as Record<Who, string>;
const catalogue = rolePermissions(loadSlices(SLICES).manifests);
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const detailOf = (key: keyof typeof competencyEn) => [competencyAm[key], competencyEn[key]];

const handlers = () =>
    vehicleImportHandlers(system, {
        database: app,
        importer: api.http.get(VehicleImportService),
        permissionsOf: (roles) => permissionsOf(catalogue, roles)
    });
const runCheck = (importId: string) =>
    handlers()['vehicle-import.check-requested.v1']?.({
        eventId: randomUUID(),
        type: 'vehicle-import.check-requested.v1',
        payload: { importId }
    });
const runCommit = (importId: string) =>
    handlers()['vehicle-import.commit-requested.v1']?.({
        eventId: randomUUID(),
        type: 'vehicle-import.commit-requested.v1',
        payload: { importId }
    });

const RUN = String(randomInt(100000, 999999));
const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const nameOf = (n: number) =>
    [Math.floor(n / 900) % 30, Math.floor(n / 30) % 30, n % 30].map((i) => ETHIOPIC[i] ?? 'ለ').join('');
function vin(n: number): string {
    const base = `1HGCM82B0${String((n % 90) + 10)}${RUN.slice(0, 2)}${String(n).padStart(4, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}
const reference = (n: number) => `BOD/REC/${RUN}/${String(n).padStart(4, '0')}`;
/** the old regional plate of a use code */
const plate = (n: number, code: number) => `AA ${code}-${RUN.slice(0, 1)}${String(n).padStart(4, '0')}`;

const COLUMNS = [
    'paper_reference',
    'first_registered_on',
    'owners_since',
    'plate',
    'chassis_number',
    'make',
    'model',
    'model_year',
    'category',
    'use',
    'colour',
    'owner_name_am',
    'owner_sex',
    'owner_phone'
] as const;

/** Paper files n..n+count-1 of one plate code, each with its own owner (a name and a phone). */
function sheet(from: number, count: number, code: number): string {
    const rows: string[][] = [];
    for (let n = from; n < from + count; n++)
        rows.push([
            reference(n),
            '04/09/2001',
            '2015-03-01',
            plate(n, code),
            vin(n),
            'Toyota',
            'Corolla',
            '2008',
            'automobile',
            'private',
            'Blue',
            `ባለቤት ${nameOf(n)} ታደሰ`,
            n % 2 ? 'male' : 'female',
            `09${RUN.slice(0, 2)}${String(n).padStart(6, '0')}`
        ]);
    return [COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/** Scans the clerk uploaded, stored at Boditi, one per paper reference. */
async function scans(references: string[]): Promise<string[]> {
    const { rows } = await api.owner.query<{ id: string }>(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key, confirmed_at,
                                   origin, created_by, expires_at)
         select g.id, $1::uuid, $2::uuid, 'stored', g.name || '.pdf', 'application/pdf', 10, repeat('a', 64),
                'files/' || $1::text || '/' || g.id::text, now(), 'upload', $3::uuid, now() + interval '7 days'
           from (select gen_random_uuid() as id, unnest($4::text[]) as name) g
         returning id`,
        [boditi.regionId, boditi.id, id.clerk, references.map((r) => r.replaceAll('/', '-'))]
    );
    return rows.map((r) => r.id);
}

const batchOf = async (importId: string, who: As = as.clerk) =>
    (await api.call('GET', `/api/v1/vehicle-imports/${importId}`, who)).json<VehicleImport>();

/** A sheet sent by the clerk with its scans and checked by the worker: it waits for its committer. */
async function checkedSheet(from: number, count: number, code: number, filename: string): Promise<VehicleImport> {
    const refs = Array.from({ length: count }, (_, i) => reference(from + i));
    const sent = await api.call('POST', '/api/v1/vehicle-imports', as.clerk, {
        filename,
        format: 'csv',
        content: sheet(from, count, code),
        scanFileIds: await scans(refs)
    });
    expect(sent.statusCode, sent.body).toBe(202);
    await runCheck(sent.json<VehicleImport>().id);
    const checked = await batchOf(sent.json<VehicleImport>().id, as.verifier);
    expect(checked).toMatchObject({ state: 'checked', counts: { valid: count } });
    return checked;
}

/** The same sheet committed by the verifier, and the commit job run. */
async function committedSheet(from: number, count: number, code: number, filename: string): Promise<void> {
    const checked = await checkedSheet(from, count, code, filename);
    const commit = await api.call(
        'POST',
        `/api/v1/vehicle-imports/${checked.id}/commit`,
        as.verifier,
        {},
        ifMatch(checked.version)
    );
    expect(commit.statusCode, commit.body).toBe(202);
    await runCommit(checked.id);
    expect(await batchOf(checked.id)).toMatchObject({ state: 'committed', counts: { imported: count } });
}

const reportAs = async (who: As) => {
    const res = await api.call('GET', '/api/v1/migration-report', who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<MigrationReport>();
};
const officeOf = (report: MigrationReport, code: string): ReconciliationOffice => {
    const office = report.offices.find((o) => o.unit.code === code);
    if (!office) throw new Error(`no office ${code} in the report`);
    return office;
};
const codeOf = (office: ReconciliationOffice, plateCode: string) => {
    const found = office.codes.find((c) => c.plateCode === plateCode);
    if (!found) throw new Error(`no code ${plateCode}`);
    return found;
};
const putCount = (who: As, body: object, headers?: Record<string, string>) =>
    api.call('PUT', '/api/v1/migration-report/paper-counts', who, body, headers);
const requestIdOf = (res: { headers: Record<string, unknown> }): string => {
    const header = res.headers['x-request-id'];
    return typeof header === 'string' ? header : '';
};
async function auditOf(requestId: string): Promise<Record<string, number>> {
    const { rows } = await api.owner.query<{ line: string; n: number }>(
        `select table_name || ':' || action as line, count(*)::int as n from kernel.audit_log where request_id = $1 group by 1`,
        [requestId]
    );
    return Object.fromEntries(rows.map((r) => [r.line, r.n]));
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.rec.clerk',
                sub: SUB.clerk,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [
                    ['WOL-BODITI', 'records_officer'],
                    ['WOL-BODITI', 'competency.officer']
                ]
            },
            {
                username: 'test.rec.verifier',
                sub: SUB.verifier,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [['WOL-BODITI', 'competency.officer']]
            },
            {
                username: 'test.rec.zone',
                sub: SUB.zone,
                region: 'SER',
                home: 'WOL',
                roles: [['WOL', 'competency.lead']]
            }
        ],
        { objectStore: { ...NO_OBJECT_STORE, presignGet: ({ key }) => Promise.resolve(`https://store.test/${key}`) } }
    );
    app = createDatabase(pg.url('app'), { contextKey: TEST_CONTEXT_KEY });
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    zone = await api.unit('SER', 'WOL');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.clerk = { sub: SUB.clerk, unit: boditi };
    as.verifier = { sub: SUB.verifier, unit: boditi };
    as.zone = { sub: SUB.zone, unit: zone };
    for (const who of Object.keys(SUB) as Who[]) id[who] = await api.userId(SUB[who]);
    await api.installer.scoped({}, async (tx) => {
        const root = { id: region.id, regionId: region.regionId };
        await importVehicleCategories(tx, root);
        await importBackCaptureService(tx, root);
    });
}, 240_000);

afterAll(async () => {
    await system?.close();
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('the migrated vehicles', () => {
    it('are counted per office and plate code as an independent count of the register counts them', async () => {
        await committedSheet(0, 6, 3, 'boditi-code3.csv');
        await committedSheet(20, 4, 1, 'boditi-code1.csv');

        // the register counted another way: the earliest plate of each migrated vehicle, by distinct-on
        const expected = await api.owner.query<{ code: string; unit: string; n: number }>(
            `select x.code, u.code as unit, count(*)::int as n
               from (select distinct on (v.id) v.handling_unit_id as unit_id,
                            coalesce(pa.legacy_use_code::text, 'other') as code
                       from vehicles.vehicles v
                       left join vehicles.plate_assignments pa on pa.vehicle_id = v.id
                      where v.migration_source is not null
                      order by v.id, pa.since, pa.created_at) x
               join kernel.org_units u on u.id = x.unit_id
              group by 1, 2`
        );
        expect(expected.rows.length).toBeGreaterThan(0);
        const report = await reportAs(as.zone);
        expect(report).toMatchObject({ mayCount: true, ownUnitId: zone.id });
        for (const office of report.offices) {
            for (const c of office.codes) {
                const counted =
                    expected.rows.find((e) => e.unit === office.unit.code && e.code === c.plateCode)?.n ?? 0;
                expect(c.verified, `${office.unit.code} ${c.plateCode}`).toBe(counted);
            }
        }
        const total = expected.rows.reduce((n, e) => n + e.n, 0);
        expect(report.total.verified).toBe(total);
        expect(report.offices.reduce((n, o) => n + o.verified, 0)).toBe(total);
        const bod = officeOf(report, 'WOL-BODITI');
        expect(codeOf(bod, '3').verified).toBe(6);
        expect(codeOf(bod, '1').verified).toBe(4);
        expect(codeOf(bod, 'other').verified).toBe(0);
        // no paper count yet: nothing is missing, there is no share
        expect(bod).toMatchObject({ verified: 10, paper: null, missing: null, share: null });
        expect(codeOf(bod, '3')).toMatchObject({ paper: null, missing: null });
        // offices come ordered by unit code
        const codes = report.offices.map((o) => o.unit.code);
        expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    }, 600_000);
});

describe('the paper counts', () => {
    it('are set by the zone above, on record, and make what is missing and the migrated share', async () => {
        const created = await putCount(as.zone, {
            unitId: boditi.id,
            plateCode: '3',
            count: 10,
            countedOn: '2026-11-01'
        });
        expect(created.statusCode, created.body).toBe(200);
        expect(codeOf(created.json<ReconciliationOffice>(), '3')).toMatchObject({
            paper: { count: 10, countedOn: '2026-11-01', version: 1 },
            verified: 6,
            missing: 4
        });
        expect(await auditOf(requestIdOf(created))).toMatchObject({ 'competency.migration_paper_counts:insert': 1 });
        const row = await api.owner.query<{ counted_by_unit_id: string; handling_unit_id: string }>(
            "select counted_by_unit_id, handling_unit_id from competency.migration_paper_counts where plate_code = '3'"
        );
        expect(row.rows[0]).toEqual({ counted_by_unit_id: zone.id, handling_unit_id: boditi.id });

        let bod = officeOf(await reportAs(as.zone), 'WOL-BODITI');
        // the share is over the codes that have a paper count: 6 of 10
        expect(bod).toMatchObject({ paper: 10, verified: 10, missing: 4, share: 0.6 });
        expect(codeOf(bod, '1')).toMatchObject({ paper: null, missing: null });

        // a count already there is replaced only on its version; without one or with a stale one it is a conflict
        const without = await putCount(as.zone, {
            unitId: boditi.id,
            plateCode: '3',
            count: 11,
            countedOn: '2026-11-02'
        });
        expect(without.statusCode).toBe(409);
        const stale = await putCount(
            as.zone,
            { unitId: boditi.id, plateCode: '3', count: 11, countedOn: '2026-11-02' },
            ifMatch(99)
        );
        expect(stale.statusCode).toBe(409);
        // a new count never carries a version
        const newWithVersion = await putCount(
            as.zone,
            { unitId: boditi.id, plateCode: '1', count: 4, countedOn: '2026-11-02' },
            ifMatch(1)
        );
        expect(newWithVersion.statusCode).toBe(409);

        const updated = await putCount(
            as.zone,
            { unitId: boditi.id, plateCode: '3', count: 6, countedOn: '2026-11-02' },
            ifMatch(1)
        );
        expect(updated.statusCode, updated.body).toBe(200);
        expect(codeOf(updated.json<ReconciliationOffice>(), '3')).toMatchObject({
            paper: { count: 6, version: 2 },
            missing: 0
        });
        expect(await auditOf(requestIdOf(updated))).toMatchObject({ 'competency.migration_paper_counts:update': 1 });

        const second = await putCount(as.zone, {
            unitId: boditi.id,
            plateCode: '1',
            count: 8,
            countedOn: '2026-11-02'
        });
        expect(second.statusCode, second.body).toBe(200);
        bod = officeOf(await reportAs(as.zone), 'WOL-BODITI');
        // 10 verified of 14 on paper; more verified than counted is not a negative debt
        expect(bod).toMatchObject({ paper: 14, verified: 10, missing: 4, share: 10 / 14 });
        const report = await reportAs(as.zone);
        expect(report.total).toMatchObject({ paper: 14, verified: 10, missing: 4, share: 10 / 14 });
    });

    it('are never set by an office for itself, nor for an office the caller does not hold', async () => {
        for (const who of [as.verifier, as.clerk]) {
            const own = await putCount(who, { unitId: boditi.id, plateCode: '5', count: 1, countedOn: '2026-11-01' });
            expect(own.statusCode, own.body).toBe(403);
            expect(detailOf('competency.errors.paper_count_own_office')).toContain(
                own.json<{ detail?: string }>().detail
            );
        }
        const sibling = await putCount(as.verifier, {
            unitId: damot.id,
            plateCode: '5',
            count: 1,
            countedOn: '2026-11-01'
        });
        expect([403, 404]).toContain(sibling.statusCode);
        const above = await putCount(as.verifier, {
            unitId: zone.id,
            plateCode: '5',
            count: 1,
            countedOn: '2026-11-01'
        });
        expect([403, 404]).toContain(above.statusCode);
        // the zone is no exception for its own unit
        const zoneOwn = await putCount(as.zone, { unitId: zone.id, plateCode: '5', count: 1, countedOn: '2026-11-01' });
        expect(zoneOwn.statusCode).toBe(403);
        const none = await api.owner.query<{ n: number }>(
            "select count(*)::int as n from competency.migration_paper_counts where plate_code = '5'"
        );
        expect(none.rows[0]?.n).toBe(0);
        // an office reads its own report, and is not offered a count of its own
        expect(await reportAs(as.verifier)).toMatchObject({ mayCount: true, ownUnitId: boditi.id });
    });

    it('refuse a body that is not one with 422', async () => {
        const good = { unitId: boditi.id, plateCode: '2', count: 1, countedOn: '2026-11-01' };
        for (const bad of [
            { ...good, count: -1 },
            { ...good, count: 10_000_001 },
            { ...good, count: 1.5 },
            { ...good, plateCode: '6' },
            { ...good, unitId: 'not-an-id' },
            { ...good, countedOn: '01/11/2026' },
            { ...good, extra: true },
            { unitId: boditi.id }
        ]) {
            const res = await putCount(as.zone, bad);
            expect(res.statusCode, JSON.stringify(bad)).toBe(422);
        }
    });

    it('are seen by the zone and the office, never by a sibling office', async () => {
        const count = (unit: OrgUnit, userId: string) =>
            app.scoped(contextFor(unit, userId), async (tx) =>
                Number(
                    (await tx.execute(sql`select count(*)::int as n from competency.migration_paper_counts`)).rows[0]?.n
                )
            );
        expect(await count(damot, id.verifier)).toBe(0);
        expect(await count(boditi, id.verifier)).toBe(2);
        expect(await count(zone, id.zone)).toBe(2);
        expect((await reportAs(as.zone)).offices.map((o) => o.unit.code)).toContain('WOL-BODITI');
    });
});

describe('the work awaiting its second person', () => {
    it('shows a checked sheet and an open capture of the office, never their vehicles', async () => {
        const before = officeOf(await reportAs(as.zone), 'WOL-BODITI');
        expect(before.awaiting).toEqual({ captures: 0, importRows: 0 });

        await checkedSheet(40, 3, 3, 'boditi-waiting.csv');
        const person = await api.call('POST', '/api/v1/persons', as.clerk, {
            nameAm: { given: 'ባለቤት', father: `ቆጠራ${nameOf(901)}`, grandfather: 'ታደሰ' },
            nameEn: {
                given: 'Count',
                father: `Shelf${[...RUN].map((d) => 'abcdefghij'.charAt(Number(d))).join('')}`,
                grandfather: 'Person'
            },
            sex: 'female',
            birthYear: 1979,
            acknowledgedDuplicates: []
        });
        expect(person.statusCode, person.body).toBe(201);
        const [scan] = await scans([reference(901)]);
        const filed = await api.call('POST', '/api/v1/service-requests', as.clerk, {
            serviceCode: 'MIG-01',
            answers: {
                paperReference: reference(901),
                paperFileScan: [{ file_id: scan }],
                owners: [{ ownerPerson: person.json<{ id: string }>().id }],
                firstRegisteredOn: '2009-05-12',
                ownersSince: '2015-03-01',
                plate: plate(901, 4),
                plateSince: '2009-05-12',
                chassisNumber: vin(901),
                make: 'Toyota',
                model: 'Corolla',
                modelYear: 2008,
                categoryKey: 'automobile',
                use: 'private',
                colour: 'Blue'
            }
        });
        expect(filed.statusCode, filed.body).toBe(201);

        const after = await reportAs(as.zone);
        const bod = officeOf(after, 'WOL-BODITI');
        expect(bod.awaiting).toEqual({ captures: 1, importRows: 3 });
        expect(after.total.awaiting).toMatchObject({ captures: 1, importRows: 3 });
        // none of it is on the register: the verified figures are as they were
        expect(bod.verified).toBe(10);
        expect(codeOf(bod, '4').verified).toBe(0);
    }, 300_000);
});
