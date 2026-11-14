/**
 * The bulk import of paper vehicle files (ADR-0054, task 1.13b) through the API and the worker's handlers, on a real PostgreSQL 16
 * with the Wolaita seeds. A clerk at Boditi sends a sheet of 1,000 generated paper files with their scans; the dry run reports each
 * row's errors (cells, the sheet's other rows, the register's rules) and puts nothing on the register; the clerk cannot commit their
 * own sheet; a second person does, and the valid rows join the register as migrated by import, marked in the record, the search and
 * the lookup, the rows of one owner made one person. The same sheet sent again finds every file already imported and makes
 * nothing; a delivery of a job twice changes nothing. A sibling office sees none of it. Plates, chassis numbers, references, names
 * and phones are generated.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { VehicleImportService } from '@itrms/competency/api';
import { vehicleImportHandlers } from '@itrms/competency/api/worker';
import { importBackCaptureService } from '@itrms/competency/seed';
import type { VehicleImport, VehicleImportRow } from '@itrms/competency/contracts';
import { loadSlices } from '@itrms/kernel/api';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { permissionsOf, rolePermissions } from '@itrms/kernel/iam';
import type { OrgUnit } from '@itrms/kernel/org';
import { TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import { vinCheckDigit, type Vehicle, type VehicleSummary } from '@itrms/vehicles/contracts';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SLICES } from '../../src/slices';
import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    clerk: '0199f0a0-d000-7000-8000-00000000c301',
    verifier: '0199f0a0-d000-7000-8000-00000000c302',
    damot: '0199f0a0-d000-7000-8000-00000000c303'
};

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let system: SystemDatabase;
let boditi: OrgUnit;
const as = {} as Record<'clerk' | 'verifier' | 'damot', As>;
const catalogue = rolePermissions(loadSlices(SLICES).manifests);
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

/** What the worker does when the outbox relays the event. */
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

const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
/** Three Ethiopic letters naming n: a generated father's name, unique per row. */
const nameOf = (n: number) =>
    [Math.floor(n / 900) % 30, Math.floor(n / 30) % 30, n % 30].map((i) => ETHIOPIC[i] ?? 'ለ').join('');

const RUN = String(randomInt(100000, 999999));
/** A 17-character VIN of a country where the check digit is law, right. */
function vin(n: number): string {
    const base = `1HGCM82B0${String((n % 90) + 10)}${RUN.slice(0, 2)}${String(n).padStart(4, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}

const COLUMNS = [
    'paper_reference',
    'scan_file',
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
    'owner_phone',
    'owner_fin'
] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

/**
 * The ten errors the sample plants, one in every tenth row (row 9, 19, …), in turn: the column the report must name and the code.
 * The cells' own (a date that is not one, a missing make, a use not in the list, a bad phone, a category not in the catalogue), the
 * sheet's other rows (a paper reference or a chassis twice, a scan not sent), and the register's (a date in the future, no plate).
 */
const PLANTED: { column: string; code: string; plant: (row: Row, previous: Row) => void }[] = [
    { column: 'first_registered_on', code: 'invalid_date', plant: (r) => (r.first_registered_on = '31/02/2001') },
    { column: 'make', code: 'required', plant: (r) => (r.make = '') },
    { column: 'use', code: 'not_in_list', plant: (r) => (r.use = 'flying') },
    { column: 'paper_reference', code: 'duplicate_in_file', plant: (r, p) => (r.paper_reference = p.paper_reference) },
    { column: 'chassis_number', code: 'duplicate_in_file', plant: (r, p) => (r.chassis_number = p.chassis_number) },
    { column: 'scan_file', code: 'scan_missing', plant: (r) => (r.scan_file = 'never-sent.pdf') },
    { column: 'owner_phone', code: 'invalid_phone', plant: (r) => (r.owner_phone = '12') },
    { column: 'category', code: 'not_in_list', plant: (r) => (r.category = 'spaceship') },
    { column: 'first_registered_on', code: 'in_future', plant: (r) => (r.first_registered_on = '01/01/2030') },
    { column: 'plate', code: 'invalid_plate', plant: (r) => (r.plate = 'NOT A PLATE') }
];
const SHARED_FIN = `9${RUN}00000`;

/** The 1,000 paper files: the first 50 of one owner (one FIN), the others each their own (a name and a phone). */
function sample(): { rows: Row[]; planted: Map<number, { column: string; code: string }> } {
    const rows: Row[] = [];
    const planted = new Map<number, { column: string; code: string }>();
    for (let i = 0; i < 1000; i++) {
        const shared = i < 50;
        const row: Row = {
            paper_reference: `BOD/VEH/${RUN}/${String(i).padStart(4, '0')}`,
            scan_file: '',
            first_registered_on: '04/09/2001',
            owners_since: '2015-03-01',
            plate: `AA 2-${RUN.slice(0, 1)}${String(i).padStart(4, '0')}`,
            chassis_number: vin(i),
            make: 'Toyota',
            model: 'Corolla',
            model_year: '2008',
            category: 'automobile',
            use: 'private',
            colour: 'Blue',
            owner_name_am: shared ? 'ባለቤት ወረቀት ታደሰ' : `ባለቤት ${nameOf(i)} ታደሰ`,
            owner_sex: i % 2 ? 'male' : 'female',
            owner_phone: shared ? '' : `09${RUN.slice(0, 2)}${String(i).padStart(6, '0')}`,
            owner_fin: shared ? SHARED_FIN : ''
        };
        if (i % 10 === 9) {
            const kind = PLANTED[Math.floor(i / 10) % 10];
            if (kind) {
                kind.plant(row, rows[i - 1] ?? row);
                planted.set(i + 2, { column: kind.column, code: kind.code });
            }
        }
        rows.push(row);
    }
    return { rows, planted };
}

const csvOf = (rows: Row[]) =>
    [
        COLUMNS.join(','),
        ...rows.map((r) => COLUMNS.map((c) => (/[",]/.test(r[c]) ? `"${r[c]}"` : r[c])).join(','))
    ].join('\r\n');

/** The clerk's uploaded scans, stored at Boditi, one per paper reference (as a clerk names them): their ids. */
async function scans(references: string[], sub = SUB.clerk): Promise<string[]> {
    const clerk = await api.userId(sub);
    const { rows } = await api.owner.query<{ id: string }>(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key, confirmed_at,
                                   origin, created_by, expires_at)
         select g.id, $1::uuid, $2::uuid, 'stored', g.name || '.pdf', 'application/pdf', 10, repeat('a', 64),
                'files/' || $1::text || '/' || g.id::text, now(), 'upload', $3::uuid, now() + interval '7 days'
           from (select gen_random_uuid() as id, unnest($4::text[]) as name) g
         returning id`,
        [boditi.regionId, boditi.id, clerk, references]
    );
    return rows.map((r) => r.id);
}

async function send(who: As, body: object): Promise<VehicleImport> {
    const res = await api.call('POST', '/api/v1/vehicle-imports', who, body);
    expect(res.statusCode, res.body).toBe(202);
    return res.json<VehicleImport>();
}
const batchOf = async (id: string, who: As = as.clerk) =>
    (await api.call('GET', `/api/v1/vehicle-imports/${id}`, who)).json<VehicleImport>();
async function rowsOf(id: string, state?: string): Promise<VehicleImportRow[]> {
    const all: VehicleImportRow[] = [];
    for (let offset = 0; ; offset += 200) {
        const res = await api.call(
            'GET',
            `/api/v1/vehicle-imports/${id}/rows?limit=200&offset=${offset}${state ? `&state=${state}` : ''}`,
            as.clerk
        );
        expect(res.statusCode, res.body).toBe(200);
        const page = res.json<{ items: VehicleImportRow[]; total: number }>();
        all.push(...page.items);
        if (all.length >= page.total || page.items.length === 0) return all;
    }
}
const search = async (q: string) =>
    (await api.call('GET', `/api/v1/vehicles?q=${encodeURIComponent(q)}`, as.clerk)).json<{ items: VehicleSummary[] }>()
        .items;
const importedVehicles = async () =>
    Number(
        (
            await api.owner.query<{ n: string }>(
                `select count(*) as n from vehicles.vehicles where migration_source = 'import' and paper_reference like $1`,
                [`BOD/VEH/${RUN}/%`]
            )
        ).rows[0]?.n ?? 0
    );

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.imp.clerk',
            sub: SUB.clerk,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'records_officer']]
        },
        {
            username: 'test.imp.verifier',
            sub: SUB.verifier,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.officer']]
        },
        {
            username: 'test.imp.damot',
            sub: SUB.damot,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'records_officer']]
        }
    ]);
    app = createDatabase(pg.url('app'), { contextKey: TEST_CONTEXT_KEY });
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.clerk = { sub: SUB.clerk, unit: boditi };
    as.verifier = { sub: SUB.verifier, unit: boditi };
    as.damot = { sub: SUB.damot, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };
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

describe('a sheet of 1,000 paper files (ADR-0054)', () => {
    const { rows, planted } = sample();
    let first: VehicleImport;

    it('is checked row by row, every error reported at its row and column, and nothing put on the register', async () => {
        const scanIds = await scans(
            rows
                .filter((r, i) => i % 10 !== 9 || PLANTED[Math.floor(i / 10) % 10]?.code !== 'scan_missing')
                .map((r) => r.paper_reference)
        );
        first = await send(as.clerk, {
            filename: 'boditi-files.csv',
            format: 'csv',
            content: csvOf(rows),
            scanFileIds: scanIds
        });
        expect(first.state).toBe('checking');
        // the sheet is kept encrypted until it is read: never in clear
        const stored = await api.owner.query<{ ct: Buffer | null }>(
            'select content_ct as ct from competency.vehicle_imports where id = $1',
            [first.id]
        );
        expect(stored.rows[0]?.ct?.includes(Buffer.from('BOD/VEH/'))).toBe(false);

        await runCheck(first.id);
        const checked = await batchOf(first.id);
        expect(checked).toMatchObject({
            state: 'checked',
            counts: { total: 1000, valid: 900, invalid: 100, alreadyImported: 0, imported: 0 },
            scans: { given: scanIds.length }
        });
        const invalid = await rowsOf(first.id, 'invalid');
        expect(invalid).toHaveLength(100);
        for (const row of invalid) {
            const expected = planted.get(row.line);
            expect(expected, `line ${row.line} was not planted`).toBeDefined();
            expect(row.errors, `line ${row.line}`).toEqual(
                expect.arrayContaining([expect.objectContaining({ column: expected?.column, code: expected?.code })])
            );
            expect(row.errors.every((e) => e.message.length > 0)).toBe(true);
        }
        // the dry run wrote rows only: no vehicle, no person; the sheet is cleared, the phones are not in the rows' facts
        expect(await search(rows[0]?.plate ?? '')).toEqual([]);
        expect(await importedVehicles()).toBe(0);
        const after = await api.owner.query<{ ct: Buffer | null; facts: string }>(
            `select i.content_ct as ct, (select string_agg(r.values::text, ' ') from competency.vehicle_import_rows r where r.import_id = i.id) as facts
               from competency.vehicle_imports i where i.id = $1`,
            [first.id]
        );
        expect(after.rows[0]?.ct).toBeNull();
        expect(after.rows[0]?.facts).not.toContain(rows[100]?.owner_phone.slice(2));
        expect(after.rows[0]?.facts).not.toContain(SHARED_FIN);
        // one audited insert per row
        const audited = await api.owner.query<{ n: string }>(
            `select count(*) as n from kernel.audit_log a join competency.vehicle_import_rows r on r.id = a.row_id
              where a.table_name = 'competency.vehicle_import_rows' and a.action = 'insert' and r.import_id = $1`,
            [first.id]
        );
        expect(Number(audited.rows[0]?.n)).toBe(1000);
    }, 600_000);

    it('is committed only by a second person, its valid rows on the register as migrated by import', async () => {
        const own = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${first.id}/commit`,
            as.clerk,
            {},
            ifMatch(first.version)
        );
        // the clerk holds no right to commit at all; and whoever sent a sheet cannot commit it (SEC-AC-6)
        expect(own.statusCode).toBe(403);
        const current = await batchOf(first.id, as.verifier);
        expect(current.mayCommit).toBe(true);
        const commit = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${first.id}/commit`,
            as.verifier,
            {},
            ifMatch(current.version)
        );
        expect(commit.statusCode, commit.body).toBe(202);
        await runCommit(first.id);
        const committed = await batchOf(first.id);
        expect(committed).toMatchObject({
            state: 'committed',
            counts: { total: 1000, valid: 0, invalid: 100, imported: 900 },
            committedBy: { id: await api.userId(SUB.verifier) }
        });
        expect(await importedVehicles()).toBe(900);

        // marked in every view: the record, the search, the lookup a service picks it with
        const row0 = rows[0];
        const [found] = await search(row0?.plate ?? '');
        expect(found).toMatchObject({ migration: { source: 'import', paperReference: row0?.paper_reference } });
        const record = (await api.call('GET', `/api/v1/vehicles/${found?.id ?? ''}`, as.clerk)).json<Vehicle>();
        const [imported] = (await rowsOf(first.id, 'imported')).filter((r) => r.line === 2);
        expect(record.migration).toMatchObject({
            source: 'import',
            paperReference: row0?.paper_reference,
            caseId: null,
            importRowId: imported?.id,
            verifiedBy: { id: await api.userId(SUB.verifier) }
        });
        // back-capture mode: the paper's Ethiopian date, its owners since the day it gives
        expect(record).toMatchObject({ firstRegisteredOn: '2009-05-12' });
        expect(record.ownerships).toEqual([
            expect.objectContaining({ since: '2015-03-01', acquiredBy: 'back_capture' })
        ]);
        const lookup = await api.call(
            'GET',
            `/api/v1/registry-lookups/vehicle?q=${encodeURIComponent(row0?.plate ?? '')}`,
            as.clerk
        );
        const facts = lookup.json<{ items: { facts: { key: string; value: string | null }[] }[] }>().items[0]?.facts;
        expect(facts?.find((f) => f.key === 'migrated')?.value).toContain(row0?.paper_reference);
        // the row links to its vehicle and its scan
        expect(imported?.vehicleId).toBe(found?.id);
        expect(imported?.scan?.filename).toBe(`${row0?.paper_reference}.pdf`);

        // the 45 valid rows of the one owner (one FIN) are one person; the others each their own
        const owners = await api.owner.query<{ shared: string; all: string }>(
            `select count(distinct owner_person_id) filter (where line < 52) as shared, count(distinct owner_person_id) as all
               from competency.vehicle_import_rows where import_id = $1 and state = 'imported'`,
            [first.id]
        );
        expect(Number(owners.rows[0]?.shared)).toBe(1);
        expect(Number(owners.rows[0]?.all)).toBe(1 + 900 - 45);
        // every vehicle's insert is on record, in the commit's transactions
        const audited = await api.owner.query<{ n: string }>(
            `select count(*) as n from kernel.audit_log a join vehicles.vehicles v on v.id = a.row_id
              where a.table_name = 'vehicles.vehicles' and a.action = 'insert' and v.paper_reference like $1`,
            [`BOD/VEH/${RUN}/%`]
        );
        expect(Number(audited.rows[0]?.n)).toBe(900);
    }, 600_000);

    it('makes nothing new when its jobs are delivered again or the same sheet is sent again', async () => {
        await runCommit(first.id);
        await runCheck(first.id);
        expect(await importedVehicles()).toBe(900);

        // the same sheet, with its scans uploaded again: every file is already imported, the errors are the same
        const again = await send(as.clerk, {
            filename: 'boditi-files-again.csv',
            format: 'csv',
            content: csvOf(rows),
            scanFileIds: await scans(rows.map((r) => r.paper_reference))
        });
        // two deliveries of the check at once read each row once
        await Promise.all([runCheck(again.id), runCheck(again.id)]);
        const checked = await batchOf(again.id);
        expect(checked).toMatchObject({
            state: 'checked',
            counts: { total: 1000, valid: 0, alreadyImported: 900, invalid: 100 },
            mayCommit: false
        });
        const already = await rowsOf(again.id, 'already_imported');
        expect(already.every((r) => r.vehicleId !== null && r.errors.length === 0)).toBe(true);
        const commit = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${again.id}/commit`,
            as.verifier,
            {},
            ifMatch(checked.version)
        );
        expect(commit.statusCode).toBe(409);
        expect(await importedVehicles()).toBe(900);
    }, 600_000);
});

describe('a sheet that cannot be read, a workbook, and another office', () => {
    it('fails a sheet without the template’s columns, naming them', async () => {
        const batch = await send(as.clerk, { filename: 'wrong.csv', format: 'csv', content: 'reference,owner\r\nA,B' });
        await runCheck(batch.id);
        expect(await batchOf(batch.id)).toMatchObject({
            state: 'failed',
            failure: {
                code: 'missing_columns',
                columns: expect.arrayContaining(['paper_reference', 'plate']) as string[]
            }
        });
        const discarded = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${batch.id}/discard`,
            as.clerk,
            {},
            ifMatch((await batchOf(batch.id)).version)
        );
        expect(discarded.statusCode, discarded.body).toBe(200);
        expect(discarded.json<VehicleImport>().state).toBe('discarded');
    });

    it('reads an Excel workbook as it reads a CSV file', async () => {
        const reference = `BOD/XLS/${RUN}`;
        const book = new ExcelJS.Workbook();
        const sheet = book.addWorksheet('files');
        sheet.addRow([...COLUMNS]);
        sheet.addRow([
            reference,
            '',
            '04/09/2001',
            '',
            `AA 3-${RUN.slice(1)}`,
            vin(5000),
            'Isuzu',
            'NPR',
            2010,
            'automobile',
            'የግል',
            '',
            'ባለቤት ኤክሴል ታደሰ',
            'male',
            '',
            ''
        ]);
        const content = Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
        // sent by an officer who may also commit: never their own sheet (SEC-AC-6)
        const batch = await send(as.verifier, {
            filename: 'files.xlsx',
            format: 'xlsx',
            content,
            scanFileIds: await scans([reference], SUB.verifier)
        });
        await runCheck(batch.id);
        const checked = await batchOf(batch.id, as.verifier);
        expect(checked).toMatchObject({ state: 'checked', counts: { total: 1, valid: 1 }, mayCommit: false });
        const own = await api.call(
            'POST',
            `/api/v1/vehicle-imports/${batch.id}/commit`,
            as.verifier,
            {},
            ifMatch(checked.version)
        );
        expect(own.statusCode).toBe(403);
        expect(own.json<{ detail?: string }>().detail).toBeTruthy();
    });

    it('is not seen by a sibling office, which cannot import at all', async () => {
        const list = (await api.call('GET', '/api/v1/vehicle-imports', as.damot)).json<{ items: VehicleImport[] }>()
            .items;
        expect(list).toEqual([]);
        const [mine] = (await api.call('GET', '/api/v1/vehicle-imports', as.clerk)).json<{ items: VehicleImport[] }>()
            .items;
        expect((await api.call('GET', `/api/v1/vehicle-imports/${mine?.id ?? ''}`, as.damot)).statusCode).toBe(404);
        // Damot Gale handles no vehicles: the import is not offered there
        const refused = await api.call('POST', '/api/v1/vehicle-imports', as.damot, {
            filename: 'x.csv',
            format: 'csv',
            content: 'a'
        });
        expect(refused.statusCode).toBe(403);
    });
});
