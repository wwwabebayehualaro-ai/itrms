/**
 * The back-capture of a paper vehicle file (ADR-0054, task 1.13, MIG-01) as it is seeded, run end to end through the API on a real
 * PostgreSQL 16 with the Wolaita seeds: a clerk at Boditi captures a paper file in back-capture mode (its original dates, the old
 * regional plate and the libre it records, what it does not give left missing, a check digit that does not match kept as one) with
 * its scan; the vehicle is not on the register until a second person verifies the capture against the paper, and the one who
 * captured it cannot. Then the register shows it as migrated, with its paper reference, its verifier and its capture case. The
 * refusals at filing, a capture sent back for correction, the step run twice making one vehicle, and the migration's facts being
 * fixed once written. Chassis numbers, plates, file references and names are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { BackCaptureService, type BackCaptureInput } from '@itrms/competency/api';
import { backCaptureFlow, importBackCaptureService } from '@itrms/competency/seed';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { PlateStock, VehicleRegistry } from '@itrms/vehicles/api';
import { nationalPlateText, vinCheckDigit, type Vehicle, type VehicleSummary } from '@itrms/vehicles/contracts';
import { importPlateStockDemo, importVehicleCategories } from '@itrms/vehicles/seed';
import { StationeryStock } from '@itrms/fees/api';
import { importStationeryDemo } from '@itrms/fees/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    clerk: '0199f0a0-d000-7000-8000-00000000b301',
    verifier: '0199f0a0-d000-7000-8000-00000000b302',
    zone: '0199f0a0-d000-7000-8000-00000000b303'
};
const SERVICE = 'MIG-01';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let boditi: OrgUnit;
let owner: string;
const as = {} as Record<'bureau' | 'clerk' | 'verifier', As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

let serial = 0;
/** A 17-character VIN of a country where the check digit is law: right, or deliberately wrong. */
function vin(rightDigit = true): string {
    serial += 1;
    const base = `1HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    const wrong = digit === '1' ? '2' : '1';
    return `${base.slice(0, 8)}${rightDigit ? digit : wrong}${base.slice(9)}`;
}
/** An old regional plate of Addis Ababa's code, generated. */
const legacyPlate = () => `AA 2-${String(randomInt(10000, 99999))}`;
const paperReference = () => `BOD/VEH/${String(randomInt(1, 999999)).padStart(6, '0')}`;

const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');

async function registered(): Promise<string> {
    serial += 1;
    const res = await api.call('POST', '/api/v1/persons', as.clerk, {
        nameAm: { given: 'ባለቤት', father: `ወረቀት${lettersOf(serial, ETHIOPIC)}`, grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: `Paper${lettersOf(serial, LATIN)}`, grandfather: 'Person' },
        sex: 'female',
        birthYear: 1979,
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

/** A scan the clerk uploaded: stored, at Boditi. */
async function scan(): Promise<string> {
    const id = randomUUID();
    await api.owner.query(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
             confirmed_at, origin, created_by)
         values ($1, $2, $3, 'stored', 'paper-file.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
        [id, boditi.regionId, boditi.id, `files/${boditi.regionId}/${id}`, await api.userId(SUB.clerk)]
    );
    return id;
}

/** A paper file as the clerk types it: a car first registered in 2009, its current owner since 2015, no seats on the file. */
const capture = async (over: Partial<BackCaptureInput> = {}): Promise<Record<string, unknown>> => ({
    paperReference: paperReference(),
    paperFileScan: [{ file_id: await scan() }],
    owners: [{ ownerPerson: owner }],
    firstRegisteredOn: '2009-05-12',
    ownersSince: '2015-03-01',
    plate: legacyPlate(),
    plateSince: '2009-05-12',
    libreNumber: `OLD-${String(randomInt(100000, 999999))}`,
    libreIssuedOn: '2015-03-10',
    chassisNumber: vin(),
    make: 'Toyota',
    model: 'Corolla',
    modelYear: 2008,
    categoryKey: 'automobile',
    use: 'private',
    colour: 'Blue',
    ...over
});

const file = (answers: Record<string, unknown>, who: As = as.clerk) =>
    api.call('POST', '/api/v1/service-requests', who, { serviceCode: SERVICE, answers });

async function filed(answers: Record<string, unknown>): Promise<CaseOut> {
    const res = await file(answers);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<CaseOut>();
}

const step = (c: CaseOut, who: As, body: object) =>
    api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));

async function moved(c: CaseOut, who: As, action: string, more: object = {}): Promise<CaseOut> {
    const res = await step(c, who, { action, ...more });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}

const factsOf = async (id: string) =>
    (await api.owner.query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [id]))
        .rows[0]?.facts ?? {};

async function submitted(answers: Record<string, unknown>): Promise<CaseOut> {
    const c = await moved(await filed(answers), as.clerk, 'submit');
    expect(c.state).toBe('verification');
    return c;
}

const vehicleIdOf = async (caseId: string): Promise<string> => {
    const vehicle = (await factsOf(caseId)).vehicle as { id?: string } | undefined;
    if (!vehicle?.id) throw new Error('no vehicle on the case');
    return vehicle.id;
};

/** The audit rows one request wrote, by table and action. */
async function auditOf(requestId: string): Promise<Record<string, number>> {
    const { rows } = await api.owner.query<{ line: string; n: number }>(
        `SELECT table_name || ':' || action AS line, count(*)::int AS n FROM kernel.audit_log
          WHERE request_id = $1 GROUP BY 1`,
        [requestId]
    );
    return Object.fromEntries(rows.map((r) => [r.line, r.n]));
}
const requestIdOf = (res: { headers: Record<string, unknown> }): string => {
    const id = res.headers['x-request-id'];
    return typeof id === 'string' ? id : '';
};

const search = async (q: string) =>
    (await api.call('GET', `/api/v1/vehicles?q=${encodeURIComponent(q)}`, as.clerk)).json<{ items: VehicleSummary[] }>()
        .items;

const refusedAt = async (answers: Record<string, unknown>) => {
    const res = await file(answers).then(async (started) => {
        expect(started.statusCode, started.body).toBe(201);
        return step(started.json<CaseOut>(), as.clerk, { action: 'submit' });
    });
    return { status: res.statusCode, body: res.json<{ code?: string; errors?: { path: string; code: string }[] }>() };
};

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.mig.clerk',
            sub: SUB.clerk,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.mig.verifier',
            sub: SUB.verifier,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.officer']]
        },
        {
            username: 'test.mig.zone',
            sub: SUB.zone,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.officer']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.clerk = { sub: SUB.clerk, unit: boditi };
    as.verifier = { sub: SUB.verifier, unit: boditi };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importVehicleCategories(tx, root);
        expect(await importBackCaptureService(tx, root)).toBe(1);
    });
    expect(await importPlateStockDemo(api.installer, 'SER', api.http.get(PlateStock), today())).not.toBeNull();
    // Boditi holds libre booklets handed down from the zone (the demo's stationery)
    expect(await importStationeryDemo(api.installer, 'SER', api.http.get(StationeryStock), today())).not.toBeNull();
    owner = await registered();
}, 240_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('what is seeded', () => {
    it('stays as it is when seeded again', async () => {
        const region = await api.unit('SER', 'SER');
        expect(
            await api.installer.scoped({}, (tx) =>
                importBackCaptureService(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
    });

    it('passes the checks a bureau’s own service version and workflow would meet, with no fee rule', async () => {
        const { rows } = await api.owner.query<{ form: string; flow: string; fee: string | null }>(
            `select v.form_version_id as form, v.workflow_version_id as flow, v.fee_rule_version_id as fee
               from services.service_definitions d join services.service_versions v on v.id = d.current_version_id
              where d.code = 'MIG-01'`
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.fee).toBeNull();
        const published = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
            workflowVersionId: rows[0]?.flow,
            formVersionId: rows[0]?.form,
            feeRuleVersionId: null,
            defaults: {},
            overridePolicy: { sla: ['region', 'unit'] }
        });
        expect(published.statusCode, published.body).toBe(201);
        const flow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'checked-vehicle-back-capture',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: backCaptureFlow()
        });
        expect(flow.statusCode, flow.body).toBe(201);
    });

    it('is offered where vehicles are registered', async () => {
        const list = (await api.call('GET', '/api/v1/services', as.clerk)).json<
            { code: string; enabled: boolean; configured: boolean }[]
        >();
        expect(list.find((s) => s.code === SERVICE)).toMatchObject({ enabled: true, configured: true });
    });
});

describe('a paper file, captured and verified (ADR-0054)', () => {
    it('joins the register only when a second person verifies it, as migrated, with the file’s own dates and papers', async () => {
        const answers = await capture({ chassisNumber: vin(false) });
        const c = await submitted(answers);
        const plate = String(answers.plate);
        // captured, not verified: no vehicle yet, and nothing for a service to act on
        expect(await search(plate)).toEqual([]);

        // whoever captured the file cannot verify it
        expect((await step(c, as.clerk, { action: 'verify' })).statusCode).toBe(403);

        const verifying = await step(c, as.verifier, { action: 'verify' });
        expect(verifying.statusCode, verifying.body).toBe(200);
        expect(verifying.json<CaseOut>().state).toBe('captured');
        const vehicleId = await vehicleIdOf(c.id);
        expect(await auditOf(requestIdOf(verifying))).toMatchObject({
            'vehicles.vehicles:insert': 1,
            'vehicles.vehicle_ownerships:insert': 1,
            'vehicles.plate_assignments:insert': 1,
            'vehicles.libres:insert': 1
        });

        const record = (await api.call('GET', `/api/v1/vehicles/${vehicleId}`, as.clerk)).json<Vehicle>();
        expect(record.migration).toMatchObject({
            source: 'back_capture',
            paperReference: answers.paperReference,
            caseId: c.id,
            verifiedBy: { id: await api.userId(SUB.verifier) }
        });
        expect(record.migration?.verifiedBy?.name).toBe('test.mig.verifier (test)');
        expect(typeof record.migration?.verifiedAt).toBe('string');
        // back-capture mode: the file's own first registration, no seats on it, the check digit kept as a mismatch
        expect(record).toMatchObject({ firstRegisteredOn: '2009-05-12', seats: null, vinCheck: 'mismatch' });
        expect(record.ownerships).toEqual([
            expect.objectContaining({ since: '2015-03-01', until: null, acquiredBy: 'back_capture', caseId: c.id })
        ]);
        expect(record.plates).toEqual([
            expect.objectContaining({ format: 'legacy', source: 'legacy', since: '2009-05-12', until: null })
        ]);
        expect(record.libres).toEqual([
            expect.objectContaining({
                // kept folded, as the register keeps a booklet serial
                number: String(answers.libreNumber).replace('-', ''),
                issuedOn: '2015-03-10',
                status: 'issued'
            })
        ]);

        // found now by its old plate, marked in the search and in the lookup a later service picks it with
        const [found] = await search(plate);
        expect(found).toMatchObject({ id: vehicleId, migration: { source: 'back_capture' } });
        const lookup = await api.call(
            'GET',
            `/api/v1/registry-lookups/vehicle?q=${encodeURIComponent(plate)}`,
            as.clerk
        );
        expect(lookup.statusCode, lookup.body).toBe(200);
        const facts = lookup.json<{ items: { id: string; facts: { key: string; value: string | null }[] }[] }>()
            .items[0]?.facts;
        expect(facts?.find((f) => f.key === 'migrated')?.value).toContain(String(answers.paperReference));
    });

    it('is sent back to the clerk with the reason when it does not match the paper, and verified once corrected', async () => {
        const answers = await capture({ colour: 'Red' });
        const c = await submitted(answers);
        const back = await moved(c, as.verifier, 'return', { comment: 'The file says the colour is white.' });
        expect(back.state).toBe('draft');
        const corrected = await moved(back, as.clerk, 'correct', { answers: { ...answers, colour: 'White' } });
        expect(corrected.state).toBe('verification');
        await moved(corrected, as.verifier, 'verify');
        const record = (await api.call('GET', `/api/v1/vehicles/${await vehicleIdOf(c.id)}`, as.clerk)).json<Vehicle>();
        expect(record.colour).toBe('White');
    });

    it('makes one vehicle when its step runs twice', async () => {
        const answers = await capture();
        const c = await submitted(answers);
        await moved(c, as.verifier, 'verify');
        const first = await vehicleIdOf(c.id);
        const verifierId = await api.userId(SUB.verifier);
        const ctx: DbContext = { ...contextFor(boditi), userId: verifierId, requestId: `mig-${randomUUID()}` };
        const again = await app.scoped(ctx, (tx) =>
            api.http
                .get(BackCaptureService)
                .capture(
                    tx,
                    { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                    answers as BackCaptureInput
                )
        );
        expect(again).toEqual({ vehicle: { id: first } });
        const { rows } = await api.owner.query<{ n: number }>(
            'select count(*)::int as n from vehicles.vehicles where migration_case_id = $1',
            [c.id]
        );
        expect(rows[0]?.n).toBe(1);
    });

    it('keeps the migration’s facts as written: the application cannot change them', async () => {
        const c = await submitted(await capture());
        await moved(c, as.verifier, 'verify');
        const vehicleId = await vehicleIdOf(c.id);
        const ctx: DbContext = { ...contextFor(boditi), requestId: `mig-${randomUUID()}` };
        await expect(
            app.scoped(ctx, (tx) =>
                tx.execute(sql`update vehicles.vehicles set paper_reference = 'CHANGED' where id = ${vehicleId}`)
            )
            // insufficient_privilege: the application role has no UPDATE grant on these columns
        ).rejects.toMatchObject({ cause: { code: '42501' } });
    });
});

describe('the refusals at filing', () => {
    it('refuses dates in the future, before the first registration, and a libre with no date, at their boxes', async () => {
        const later = await refusedAt(
            await capture({ firstRegisteredOn: '2099-01-01', ownersSince: undefined, plateSince: undefined })
        );
        expect(later.status).toBe(422);
        expect(later.body.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: 'firstRegisteredOn' })])
        );

        const before = await refusedAt(await capture({ ownersSince: '2001-01-01' }));
        expect(before.status).toBe(422);
        expect(before.body.errors).toEqual([
            expect.objectContaining({ path: 'ownersSince', code: 'before_registration' })
        ]);

        const libre = await refusedAt(await capture({ libreIssuedOn: undefined }));
        expect(libre.status).toBe(422);
        expect(libre.body.errors).toEqual([expect.objectContaining({ path: 'libreIssuedOn', code: 'required' })]);
    });

    it('refuses what is no plate, a plate a vehicle carries, and a national plate still in stock', async () => {
        const nonsense = await refusedAt(await capture({ plate: 'HELLO' }));
        expect(nonsense.status).toBe(422);
        expect(nonsense.body.errors).toEqual([expect.objectContaining({ path: 'plate', code: 'invalid_plate' })]);

        const first = await capture();
        await moved(await submitted(first), as.verifier, 'verify');
        const carried = await refusedAt(await capture({ plate: String(first.plate) }));
        expect(carried.status).toBe(422);
        expect(carried.body.errors).toEqual([expect.objectContaining({ path: 'plate', code: 'duplicate' })]);

        const { rows } = await api.owner.query<{ key: string }>(
            `select plate_key as key from vehicles.plates where status = 'in_stock' and region_id = $1 limit 1`,
            [boditi.regionId]
        );
        const inStock = rows[0]?.key;
        expect(inStock).toBeDefined();
        const stocked = await refusedAt(await capture({ plate: nationalPlateText(inStock ?? '') }));
        expect(stocked.status).toBe(422);
        expect(stocked.body.errors).toEqual([expect.objectContaining({ path: 'plate', code: 'in_stock' })]);
    });

    it('refuses a chassis already on the register, and a second open capture of the same file', async () => {
        const first = await capture();
        await moved(await submitted(first), as.verifier, 'verify');
        const again = await refusedAt(await capture({ chassisNumber: String(first.chassisNumber) }));
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('duplicate_reference');

        const open = await capture();
        await submitted(open);
        const twice = await refusedAt(await capture({ chassisNumber: String(open.chassisNumber) }));
        expect(twice.status).toBe(422);
        expect(twice.body.code).toBe('not_eligible');
    });

    it('cannot be filed without its scan', async () => {
        const answers = await capture();
        delete answers.paperFileScan;
        const res = await file(answers);
        expect(res.statusCode).toBe(422);
        expect(res.json<{ errors: { path: string }[] }>().errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: 'paperFileScan' })])
        );
    });
});

/** The verification step's effect, run directly as `who` acting for `unit`: what a bureau's own workflow could make it do. */
async function verifyAs(caseId: string, answers: Record<string, unknown>, unit: OrgUnit, who: string) {
    const ctx: DbContext = { ...contextFor(unit, await api.userId(who)), requestId: `mig-${randomUUID()}` };
    return app.scoped(ctx, (tx) =>
        api.http
            .get(BackCaptureService)
            .capture(
                tx,
                { caseId, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                answers as BackCaptureInput
            )
    );
}

const vehiclesCount = async () =>
    (await api.owner.query<{ n: number }>('select count(*)::int as n from vehicles.vehicles')).rows[0]?.n ?? 0;

describe('who may verify, whatever the workflow (SEC-AC-6)', () => {
    it('never the person who captured the file, and nothing is written when refused', async () => {
        const answers = await capture();
        const c = await submitted(answers);
        const before = await vehiclesCount();
        await expect(verifyAs(c.id, answers, boditi, SUB.clerk)).rejects.toMatchObject({
            detailKey: 'competency.errors.verify_own_capture'
        });
        expect(await vehiclesCount()).toBe(before);
    });

    it('an officer of the office above, when the step was sent up: the vehicle stays the capturing office’s', async () => {
        const zone = await api.unit('SER', 'WOL');
        const answers = await capture();
        const c = await submitted(answers);
        const made = await verifyAs(c.id, answers, zone, SUB.zone);
        const record = (await api.call('GET', `/api/v1/vehicles/${made.vehicle.id}`, as.clerk)).json<Vehicle>();
        expect(record.handlingUnit.id).toBe(boditi.id);
        expect(record.migration?.verifiedBy?.id).toBe(await api.userId(SUB.zone));
    });

    it('not an office beside it', async () => {
        const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
        const answers = await capture();
        const c = await submitted(answers);
        await expect(verifyAs(c.id, answers, damot, SUB.verifier)).rejects.toMatchObject({
            detailKey: 'competency.errors.act_from_handling_office'
        });
    });
});

describe('the libre and the plate a paper file records', () => {
    it('refuses a booklet of the stationery stock, however it is typed, and a libre number another vehicle holds', async () => {
        const { rows } = await api.owner.query<{ series: string; serial: number }>(
            `select series, serial from fees.stationery_items where kind = 'libre_booklet' and region_id = $1 limit 1`,
            [boditi.regionId]
        );
        const booklet = rows[0];
        expect(booklet).toBeDefined();
        const stocked = await refusedAt(
            await capture({ libreNumber: `${booklet?.series ?? ''} ${booklet?.serial ?? 0}` })
        );
        expect(stocked.status).toBe(422);
        expect(stocked.body.errors).toEqual([expect.objectContaining({ path: 'libreNumber', code: 'in_stock' })]);

        const first = await capture();
        await moved(await submitted(first), as.verifier, 'verify');
        const held = await refusedAt(await capture({ libreNumber: String(first.libreNumber) }));
        expect(held.status).toBe(422);
        expect(held.body.errors).toEqual([expect.objectContaining({ path: 'libreNumber', code: 'duplicate' })]);
    });

    it('refuses an old plate another vehicle of the register gave up', async () => {
        const first = await capture();
        const c = await submitted(first);
        await moved(c, as.verifier, 'verify');
        const vehicleId = await vehicleIdOf(c.id);
        // the vehicle exchanged its old plate for a national one
        const ctx: DbContext = { ...contextFor(boditi), requestId: `mig-${randomUUID()}` };
        await app.scoped(ctx, (tx) =>
            api.http.get(VehicleRegistry).recordPlate(tx, ctx, vehicleId, {
                text: `ETH ZQX ${String(randomInt(1000, 9999))}`,
                source: 'manual',
                since: today(),
                endedReason: 'exchanged'
            })
        );
        const again = await refusedAt(await capture({ plate: String(first.plate) }));
        expect(again.status).toBe(422);
        expect(again.body.errors).toEqual([expect.objectContaining({ path: 'plate', code: 'plate_ended' })]);
    });
});
