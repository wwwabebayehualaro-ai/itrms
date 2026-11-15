/**
 * Sampling QA of migrated vehicles (ADR-0054 §3, task 1.13g) through the API and the worker's handlers, on a real PostgreSQL 16 with
 * the Wolaita seeds. A clerk at Boditi sends a sheet of 40 generated paper files; when a second person commits it, exactly the
 * office's share of the clerk's records (5%: 2 of 40) is drawn, and a delivery of the job again draws nothing more. A back-capture
 * verified at a share of 100% is drawn with its case and its scan. A drawn record is re-checked by a third person, never its clerk
 * nor its verifier, once; its errors are counted per clerk. Concurrent commits for one clerk keep the share. A commit whose job died
 * is given back to checked, never while its job is alive. The import's batch is shown in the search, the record and the lookup. A
 * sibling office sees none of it; the zone above sees it. Plates, chassis numbers, references, names and phones are generated.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { MigrationSamplingService, VehicleImportService } from '@itrms/competency/api';
import { vehicleImportHandlers } from '@itrms/competency/api/worker';
import type { ClerkCounts, MigrationSample, VehicleImport, VehicleImportRow } from '@itrms/competency/contracts';
import competencyAm from '@itrms/competency/messages/am';
import competencyEn from '@itrms/competency/messages/en';
import { importBackCaptureService } from '@itrms/competency/seed';
import { loadSlices } from '@itrms/kernel/api';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { NO_OBJECT_STORE } from '@itrms/kernel/files';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { permissionsOf, rolePermissions } from '@itrms/kernel/iam';
import type { OrgUnit } from '@itrms/kernel/org';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import { vinCheckDigit, type Vehicle, type VehicleSummary } from '@itrms/vehicles/contracts';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SLICES } from '../../src/slices';
import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    clerk: '0199f0a0-d000-7000-8000-00000000d301',
    capturer: '0199f0a0-d000-7000-8000-00000000d302',
    verifier: '0199f0a0-d000-7000-8000-00000000d303',
    checker: '0199f0a0-d000-7000-8000-00000000d304',
    zone: '0199f0a0-d000-7000-8000-00000000d305'
};
type Who = keyof typeof SUB;

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let system: SystemDatabase;
let boditi: OrgUnit;
/** a sibling office of Boditi (a woreda: it holds no competency roles, so it is read as an office, under RLS) */
let damot: OrgUnit;
const as = {} as Record<Who, As>;
const id = {} as Record<Who, string>;
const catalogue = rolePermissions(loadSlices(SLICES).manifests);
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
/** A refusal's detail, in whichever language the request was answered in. */
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
const reference = (n: number) => `BOD/QA/${RUN}/${String(n).padStart(4, '0')}`;
const plate = (n: number) => `AA 3-${RUN.slice(0, 1)}${String(n).padStart(4, '0')}`;

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

/** Paper files n..n+count-1, each with its own owner (a name and a phone). */
function sheet(from: number, count: number): string {
    const rows: string[][] = [];
    for (let n = from; n < from + count; n++)
        rows.push([
            reference(n),
            '04/09/2001',
            '2015-03-01',
            plate(n),
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

/** Scans the clerk uploaded, stored at Boditi, one per paper reference (named as a clerk names them). */
async function scans(references: string[], sub = SUB.clerk): Promise<string[]> {
    const { rows } = await api.owner.query<{ id: string }>(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key, confirmed_at,
                                   origin, created_by, expires_at)
         select g.id, $1::uuid, $2::uuid, 'stored', g.name || '.pdf', 'application/pdf', 10, repeat('a', 64),
                'files/' || $1::text || '/' || g.id::text, now(), 'upload', $3::uuid, now() + interval '7 days'
           from (select gen_random_uuid() as id, unnest($4::text[]) as name) g
         returning id`,
        [boditi.regionId, boditi.id, await api.userId(sub), references.map((r) => r.replaceAll('/', '-'))]
    );
    return rows.map((r) => r.id);
}

/** A sheet of files n..n+count-1, sent by the clerk with its scans, checked, and committed by the verifier. */
async function committedSheet(from: number, count: number, filename: string): Promise<VehicleImport> {
    const refs = Array.from({ length: count }, (_, i) => reference(from + i));
    const sent = await api.call('POST', '/api/v1/vehicle-imports', as.clerk, {
        filename,
        format: 'csv',
        content: sheet(from, count),
        scanFileIds: await scans(refs)
    });
    expect(sent.statusCode, sent.body).toBe(202);
    const batch = sent.json<VehicleImport>();
    await runCheck(batch.id);
    const checked = await batchOf(batch.id, as.verifier);
    expect(checked).toMatchObject({ state: 'checked', counts: { valid: count } });
    const commit = await api.call(
        'POST',
        `/api/v1/vehicle-imports/${batch.id}/commit`,
        as.verifier,
        {},
        ifMatch(checked.version)
    );
    expect(commit.statusCode, commit.body).toBe(202);
    return commit.json<VehicleImport>();
}

const batchOf = async (importId: string, who: As = as.clerk) =>
    (await api.call('GET', `/api/v1/vehicle-imports/${importId}`, who)).json<VehicleImport>();
const samplesOf = async (who: As, query = '') => {
    const res = await api.call('GET', `/api/v1/migration-samples?limit=100${query}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ items: MigrationSample[]; total: number }>();
};
const sampleOf = async (sampleId: string, who: As = as.checker) =>
    (await api.call('GET', `/api/v1/migration-samples/${sampleId}`, who)).json<MigrationSample>();
const recheck = (sample: MigrationSample, who: As, body: object) =>
    api.call('POST', `/api/v1/migration-samples/${sample.id}/recheck`, who, body, ifMatch(sample.version));
const counterOf = async (clerkId: string) =>
    (
        await api.owner.query<{ records: number; drawn: number }>(
            'select records, drawn from competency.migration_sample_counters where handling_unit_id = $1 and clerk_id = $2',
            [boditi.id, clerkId]
        )
    ).rows[0];
const samplesOfClerk = async (clerkId: string) =>
    (
        await api.owner.query<{ id: string; source: string; verifier_id: string; scan_file_id: string | null }>(
            'select id, source, verifier_id, scan_file_id from competency.migration_samples where clerk_id = $1',
            [clerkId]
        )
    ).rows;
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
                username: 'test.qa.clerk',
                sub: SUB.clerk,
                region: 'SER',
                home: 'WOL-BODITI',
                // a clerk who could re-check another's records: their own are refused by the rule, not the role
                roles: [
                    ['WOL-BODITI', 'records_officer'],
                    ['WOL-BODITI', 'competency.officer']
                ]
            },
            {
                username: 'test.qa.capturer',
                sub: SUB.capturer,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [
                    ['WOL-BODITI', 'records_officer'],
                    ['WOL-BODITI', 'competency.officer']
                ]
            },
            {
                username: 'test.qa.verifier',
                sub: SUB.verifier,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [['WOL-BODITI', 'competency.officer']]
            },
            {
                username: 'test.qa.checker',
                sub: SUB.checker,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [['WOL-BODITI', 'competency.lead']]
            },
            {
                username: 'test.qa.zone',
                sub: SUB.zone,
                region: 'SER',
                home: 'WOL',
                roles: [['WOL', 'competency.officer']]
            }
        ],
        // a scan's link is signed, never fetched: no object behind it is needed
        { objectStore: { ...NO_OBJECT_STORE, presignGet: ({ key }) => Promise.resolve(`https://store.test/${key}`) } }
    );
    app = createDatabase(pg.url('app'), { contextKey: TEST_CONTEXT_KEY });
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    for (const who of ['clerk', 'capturer', 'verifier', 'checker'] as const) as[who] = { sub: SUB[who], unit: boditi };
    as.zone = { sub: SUB.zone, unit: await api.unit('SER', 'WOL') };
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
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

describe("the draw of a clerk's imported records", () => {
    let batch: VehicleImport;

    it("draws exactly the office's share (5%: 2 of 40), and nothing more when the job is delivered again", async () => {
        batch = await committedSheet(0, 40, 'boditi-qa.csv');
        await runCommit(batch.id);
        expect(await batchOf(batch.id)).toMatchObject({ state: 'committed', counts: { imported: 40 } });
        expect(await counterOf(id.clerk)).toEqual({ records: 40, drawn: 2 });
        // the draw is on record, in the commit job's transactions
        expect(await auditOf(`vehicle-import:${batch.id}`)).toMatchObject({
            'competency.migration_sample_counters:insert': 1,
            'competency.migration_sample_counters:update': 39,
            'competency.migration_samples:insert': 2
        });
        const drawn = await samplesOfClerk(id.clerk);
        expect(drawn).toHaveLength(2);
        // the clerk is the sheet's sender, the verifier its committer; each with its row's scan
        for (const s of drawn) {
            expect(s).toMatchObject({ source: 'import', verifier_id: id.verifier });
            expect(s.scan_file_id).not.toBeNull();
        }

        await runCommit(batch.id);
        expect(await counterOf(id.clerk)).toEqual({ records: 40, drawn: 2 });
        expect(await samplesOfClerk(id.clerk)).toHaveLength(2);
    }, 300_000);

    it('shows the batch in the search, the record and the lookup', async () => {
        const [found] = (await api.call('GET', `/api/v1/vehicles?q=${encodeURIComponent(plate(0))}`, as.clerk)).json<{
            items: VehicleSummary[];
        }>().items;
        expect(found?.migration).toMatchObject({ source: 'import', batch: { id: batch.id, name: 'boditi-qa.csv' } });
        const record = (await api.call('GET', `/api/v1/vehicles/${found?.id ?? ''}`, as.clerk)).json<Vehicle>();
        expect(record.migration?.batch).toEqual({ id: batch.id, name: 'boditi-qa.csv' });
        const lookup = await api.call(
            'GET',
            `/api/v1/registry-lookups/vehicle?q=${encodeURIComponent(plate(0))}`,
            as.clerk
        );
        const facts = lookup.json<{ items: { facts: { key: string; value: string | null }[] }[] }>().items[0]?.facts;
        expect(facts?.find((f) => f.key === 'migrated')?.value).toContain('boditi-qa.csv');
    });

    it('holds the share for one clerk under concurrent draws', async () => {
        // twenty records of another clerk counted at once, each in its own transaction: one block of 20, exactly one drawn
        const sampling = api.http.get(MigrationSamplingService);
        const rows = (
            await api.owner.query<{ id: string; vehicle_id: string }>(
                `select r.id, r.vehicle_id from competency.vehicle_import_rows r
                  where r.import_id = $1 and r.state = 'imported'
                    and not exists (select 1 from competency.migration_samples s where s.vehicle_id = r.vehicle_id)
                  order by r.line limit 20`,
                [batch.id]
            )
        ).rows;
        expect(rows).toHaveLength(20);
        const clerk = randomUUID();
        const ctx = contextFor(boditi, id.verifier);
        const drawn = await Promise.all(
            rows.map((r) =>
                app.scoped(ctx, (tx) =>
                    sampling.count(tx, {
                        regionId: boditi.regionId,
                        handlingUnitId: boditi.id,
                        vehicleId: r.vehicle_id,
                        origin: { source: 'import', importRowId: r.id },
                        clerkId: clerk,
                        verifierId: id.verifier,
                        scanFileIds: []
                    })
                )
            )
        );
        expect(drawn.filter(Boolean)).toHaveLength(1);
        expect(await counterOf(clerk)).toEqual({ records: 20, drawn: 1 });
        await api.owner.query('delete from competency.migration_samples where clerk_id = $1', [clerk]);
    }, 120_000);
});

describe('a back-capture verified at a share of 100%', () => {
    it('is drawn with its case and every page of its scan, counted to the clerk who captured it', async () => {
        // the bureau's share (an office may not set its own: it could switch its checks off)
        const region = await api.unit('SER', 'SER');
        await api.owner.query(
            `insert into kernel.settings_values (id, region_id, unit_id, key, value)
             values (gen_random_uuid(), $1, $2, 'competency.migration_sample_percent', '100'::jsonb)`,
            [region.regionId, region.id]
        );
        try {
            const person = await api.call('POST', '/api/v1/persons', as.capturer, {
                nameAm: { given: 'ባለቤት', father: `ናሙና${nameOf(900)}`, grandfather: 'ታደሰ' },
                nameEn: {
                    given: 'Sample',
                    father: `Check${[...RUN].map((d) => 'abcdefghij'.charAt(Number(d))).join('')}`,
                    grandfather: 'Person'
                },
                sex: 'female',
                birthYear: 1979,
                acknowledgedDuplicates: []
            });
            expect(person.statusCode, person.body).toBe(201);
            // a scan of two pages: both are kept on the sample, in order
            const [scan, scan2] = await scans([reference(900), reference(901)], SUB.capturer);
            const filed = await api.call('POST', '/api/v1/service-requests', as.capturer, {
                serviceCode: 'MIG-01',
                answers: {
                    paperReference: reference(900),
                    paperFileScan: [{ file_id: scan }, { file_id: scan2 }],
                    owners: [{ ownerPerson: person.json<{ id: string }>().id }],
                    firstRegisteredOn: '2009-05-12',
                    ownersSince: '2015-03-01',
                    plate: plate(900),
                    plateSince: '2009-05-12',
                    chassisNumber: vin(900),
                    make: 'Toyota',
                    model: 'Corolla',
                    modelYear: 2008,
                    categoryKey: 'automobile',
                    use: 'private',
                    colour: 'Blue'
                }
            });
            expect(filed.statusCode, filed.body).toBe(201);
            let c = filed.json<CaseOut>();
            let verifying = '';
            for (const [who, action] of [
                ['capturer', 'submit'],
                ['verifier', 'verify']
            ] as const) {
                const res = await api.call(
                    'POST',
                    `/api/v1/cases/${c.id}/transitions`,
                    as[who],
                    { action },
                    ifMatch(c.version)
                );
                expect(res.statusCode, res.body).toBe(200);
                c = res.json<CaseOut>();
                verifying = requestIdOf(res);
            }
            expect(await counterOf(id.capturer)).toEqual({ records: 1, drawn: 1 });
            // the draw is on record, in the verification's transaction
            expect(await auditOf(verifying)).toMatchObject({
                'vehicles.vehicles:insert': 1,
                'competency.migration_sample_counters:insert': 1,
                'competency.migration_samples:insert': 1
            });
            const [drawn] = (await samplesOf(as.checker, '&state=drawn')).items.filter(
                (s) => s.clerk.id === id.capturer
            );
            expect(drawn).toMatchObject({
                source: 'back_capture',
                caseId: c.id,
                importRowId: null,
                clerk: { id: id.capturer },
                verifier: { id: id.verifier },
                hasScan: true,
                scans: [
                    { id: scan, filename: `${reference(900).replaceAll('/', '-')}.pdf` },
                    { id: scan2, filename: `${reference(901).replaceAll('/', '-')}.pdf` }
                ],
                share: 100,
                state: 'drawn',
                mayRecheck: true,
                vehicle: { paperReference: reference(900) }
            });

            // each page opens for the re-check, from the zone above too, and every download is on record
            for (const page of [scan, scan2]) {
                const link = await api.call(
                    'POST',
                    `/api/v1/migration-samples/${drawn?.id ?? ''}/scans/${page ?? ''}`,
                    as.zone
                );
                expect(link.statusCode, link.body).toBe(200);
                const downloads = await api.owner.query<{ n: number }>(
                    `select count(*)::int as n from kernel.audit_log
                      where action = 'event' and event_type = 'file.downloaded' and row_id = $1`,
                    [page]
                );
                expect(downloads.rows[0]?.n).toBe(1);
            }
            // a file that is not a page of the sample's scan is not found, whoever it belongs to
            const [other] = await scans([reference(902)], SUB.capturer);
            for (const stranger of [other, randomUUID()]) {
                const refused = await api.call(
                    'POST',
                    `/api/v1/migration-samples/${drawn?.id ?? ''}/scans/${stranger ?? ''}`,
                    as.zone
                );
                expect(refused.statusCode).toBe(404);
            }
            const kept = await api.owner.query<{ scan_file_id: string; scan_file_ids: string[] }>(
                'select scan_file_id, scan_file_ids from competency.migration_samples where id = $1',
                [drawn?.id]
            );
            expect(kept.rows[0]).toEqual({ scan_file_id: scan, scan_file_ids: [scan, scan2] });

            // the database itself refuses a re-check by the clerk
            await expect(
                api.owner.query(
                    `update competency.migration_samples
                        set state = 'rechecked', outcome = 'correct', rechecked_by = clerk_id, rechecked_at = now()
                      where id = $1`,
                    [drawn?.id]
                )
            ).rejects.toThrow(/migration_samples_check/);
        } finally {
            await api.owner.query(
                "delete from kernel.settings_values where unit_id = $1 and key = 'competency.migration_sample_percent'",
                [region.id]
            );
        }
    }, 240_000);
});

describe('the re-check', () => {
    let drawn: MigrationSample[];

    it('is refused to the clerk and the verifier, and a sibling office does not see the record', async () => {
        drawn = (await samplesOf(as.checker, '&state=drawn')).items.filter((s) => s.clerk.id === id.clerk);
        expect(drawn).toHaveLength(2);
        const [first] = drawn;
        if (!first) throw new Error('no sample');
        // the clerk does not see which of their records were drawn while they wait (the next draw would be foreseen)
        expect((await api.call('GET', `/api/v1/migration-samples/${first.id}`, as.clerk)).statusCode).toBe(404);
        expect((await samplesOf(as.clerk)).items.some((s) => s.clerk.id === id.clerk)).toBe(false);
        expect((await sampleOf(first.id, as.verifier)).mayRecheck).toBe(false);
        for (const who of ['clerk', 'verifier'] as const) {
            const res = await recheck(first, as[who], { outcome: 'correct' });
            expect(res.statusCode, `${who}: ${res.body}`).toBe(403);
            expect(detailOf('competency.errors.recheck_own_record')).toContain(res.json<{ detail?: string }>().detail);
        }
        const sibling = await app.scoped(contextFor(damot, id.verifier), async (tx) => ({
            samples: (await tx.execute(sql`select id from competency.migration_samples`)).rows.length,
            counters: (await tx.execute(sql`select id from competency.migration_sample_counters`)).rows.length
        }));
        expect(sibling).toEqual({ samples: 0, counters: 0 });
        // the zone above sees it
        expect((await api.call('GET', `/api/v1/migration-samples/${first.id}`, as.zone)).statusCode).toBe(200);
    });

    it('is recorded once by a third person, on record, and a stale or empty one is refused', async () => {
        const [first, second] = drawn;
        if (!first || !second) throw new Error('no samples');
        const empty = await recheck(first, as.checker, { outcome: 'errors', fields: [] });
        expect(empty.statusCode).toBe(422);
        const wrongWay = await recheck(first, as.checker, { outcome: 'correct', fields: ['colour'] });
        expect(wrongWay.statusCode).toBe(422);

        const ok = await recheck(first, as.checker, { outcome: 'correct' });
        expect(ok.statusCode, ok.body).toBe(200);
        expect(ok.json<MigrationSample>()).toMatchObject({
            state: 'rechecked',
            outcome: 'correct',
            errorFields: [],
            recheckedBy: { id: id.checker },
            mayRecheck: false
        });
        expect(await auditOf(requestIdOf(ok))).toMatchObject({ 'competency.migration_samples:update': 1 });
        const again = await recheck(ok.json<MigrationSample>(), as.zone, { outcome: 'correct' });
        expect(again.statusCode).toBe(409);
        expect((await recheck(first, as.zone, { outcome: 'correct' })).statusCode).toBe(409);

        const errors = await recheck(second, as.zone, {
            outcome: 'errors',
            fields: ['colour'],
            note: 'The file says white.'
        });
        expect(errors.statusCode, errors.body).toBe(200);
        expect(errors.json<MigrationSample>()).toMatchObject({ outcome: 'errors', errorFields: ['colour'] });
        // a re-check measures: the vehicle's facts stay as they were
        const vehicle = (await api.call('GET', `/api/v1/vehicles/${second.vehicle.id}`, as.clerk)).json<Vehicle>();
        expect(vehicle.colour).toBe('Blue');
    });

    it("counts each clerk's records, draws, re-checks and errors", async () => {
        const counts = (await api.call('GET', '/api/v1/migration-samples/clerks', as.checker)).json<{
            items: ClerkCounts[];
        }>().items;
        expect(counts.find((c) => c.clerk.id === id.clerk)).toMatchObject({
            unit: { id: boditi.id },
            records: 40,
            drawn: 2,
            rechecked: 2,
            withErrors: 1,
            errors: 1
        });
        expect(counts.find((c) => c.clerk.id === id.capturer)).toMatchObject({ records: 1, drawn: 1, rechecked: 0 });
        // nor their own counts
        const own = (await api.call('GET', '/api/v1/migration-samples/clerks', as.clerk)).json<{
            items: ClerkCounts[];
        }>().items;
        expect(own.some((c) => c.clerk.id === id.clerk)).toBe(false);
    });
});

describe('a commit whose job died', () => {
    it('is given back to checked only once its job is dead, and commits again', async () => {
        const committing = await committedSheet(100, 3, 'boditi-stuck.csv');
        expect(committing).toMatchObject({ state: 'committing', commitStopped: false, mayGiveBack: false });
        const early = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${committing.id}/give-back`,
            as.verifier,
            {},
            ifMatch(committing.version)
        );
        expect(early.statusCode).toBe(409);
        expect(detailOf('competency.errors.import_commit_running')).toContain(early.json<{ detail?: string }>().detail);

        // the job failed all its attempts (the worker marks it dead)
        const dead = await api.owner.query<{ id: string }>(
            `update kernel.outbox_events set status = 'dead'
              where id = (select commit_event_id from competency.vehicle_imports where id = $1)
              returning id`,
            [committing.id]
        );
        const deadId = dead.rows[0]?.id ?? '';
        const stopped = await batchOf(committing.id, as.verifier);
        expect(stopped).toMatchObject({ state: 'committing', commitStopped: true, mayGiveBack: true });
        const back = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${committing.id}/give-back`,
            as.verifier,
            {},
            ifMatch(stopped.version)
        );
        expect(back.statusCode, back.body).toBe(200);
        expect(await auditOf(requestIdOf(back))).toMatchObject({ 'competency.vehicle_imports:update': 1 });
        expect(back.json<VehicleImport>()).toMatchObject({ state: 'checked', committedBy: null, mayCommit: true });
        // the dead commit is answered: it leaves the administrators' dead letters, on record in the same request
        const resolved = await api.owner.query<{ status: string; resolutions: number }>(
            `select e.status,
                    (select count(*)::int from kernel.audit_log l
                      where l.action = 'event' and l.event_type = 'job.resolved' and l.row_id = e.id
                        and l.request_id = $2) as resolutions
               from kernel.outbox_events e where e.id = $1`,
            [deadId, requestIdOf(back)]
        );
        expect(resolved.rows[0]).toEqual({ status: 'done', resolutions: 1 });

        // the dead job sent back by an administrator finds the batch no longer committing: nothing is put on the register
        await runCommit(committing.id);
        const rows = (await api.call('GET', `/api/v1/vehicle-imports/${committing.id}/rows`, as.clerk)).json<{
            items: VehicleImportRow[];
        }>().items;
        expect(rows.every((r) => r.state === 'valid')).toBe(true);

        const again = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${committing.id}/commit`,
            as.verifier,
            {},
            ifMatch(back.json<VehicleImport>().version)
        );
        expect(again.statusCode, again.body).toBe(202);
        await runCommit(committing.id);
        expect(await batchOf(committing.id)).toMatchObject({ state: 'committed', counts: { imported: 3 } });
    }, 240_000);
});
