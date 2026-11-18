/**
 * A vehicle arriving from another region (task 1.4c3, DVC-17, ADR-0060), end to end through the API on a real PostgreSQL 16 with the
 * Wolaita seeds: the officer files the vehicle and the vehicle data transfer document its owner brought, the case is paid and
 * approved, and the vehicle joins the register at Boditi on its document. A vehicle on an old regional plate is given a national plate
 * from the office's stock in the same case (held at the approval, put on at the registration, the old plate ended as exchanged); a
 * national plate is kept; with the region's rule off the old plate is kept. Every refusal names its field. Names and chassis are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daysAfter, TransferArrivalService, type TransferArrivalInput } from '@itrms/competency/api';
import { REGISTRATION_CERTIFICATE_TEMPLATE } from '@itrms/competency/contracts';
import { importTransferArrivalService, importVehicleServices } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { PlateStock, VehicleRegistry } from '@itrms/vehicles/api';
import { arrivalKey, parsePlate, vinCheckDigit } from '@itrms/vehicles/contracts';
import {
    importPlateStockDemo,
    importVehicleCategories,
    setUpRegistrationCertificateCounters
} from '@itrms/vehicles/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    // the demo's own: Boditi's cashier
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    officer: '0199f0a0-d000-7000-8000-00000000fa11',
    lead: '0199f0a0-d000-7000-8000-00000000fa12',
    inspector: '0199f0a0-d000-7000-8000-00000000fa13'
};
const SERVICE = 'DVC-17';
const NEW_REGISTRATION = 'DVC-01';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let stock: PlateStock;
let arrivals: TransferArrivalService;
let region: OrgUnit;
let boditi: OrgUnit;
let owner: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

let serial = 0;
function vin(): string {
    serial += 1;
    const base = `3HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}
const legacyPlate = () => `AA 2-${String(randomInt(10000, 99999))}`;
/** A national plate no stock holds: letters the demo's stock never uses. */
const nationalPlate = () => `ETH QZX ${String(randomInt(1000, 9999))}`;
const federalLibre = () => `FED-${String(randomInt(100000, 999999))}`;

interface ProblemBody {
    code?: string;
    errors?: { path: string; code: string; message: string }[];
}

/** A scan the officer uploaded: stored, at Boditi. */
async function scan(): Promise<string> {
    const id = randomUUID();
    await api.owner.query(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
             confirmed_at, origin, created_by)
         values ($1, $2, $3, 'stored', 'transfer-document.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
        [id, boditi.regionId, boditi.id, `files/${boditi.regionId}/${id}`, await api.userId(SUB.officer)]
    );
    return id;
}

/** The request as the officer types it from the document. A legacy plate, exchanged: the default. */
async function answersOf(over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return {
        transferDocumentNumber: `VT/${String(randomInt(100000, 999999))}`,
        issuingRegion: 'Sample Region B',
        issuingOffice: 'Sample Vehicle Office',
        documentDate: today(),
        documentValidUntil: daysAfter(today(), 10),
        documentVerified: true,
        verifiedHow: 'letter',
        transferDocumentScan: [{ file_id: await scan() }],
        owners: [{ ownerPerson: owner }],
        firstRegisteredOn: '2015-03-01',
        ownersSince: '2019-06-01',
        plate: legacyPlate(),
        takesNationalPlate: true,
        libreNumber: federalLibre(),
        libreIssuedOn: '2019-06-10',
        chassisNumber: vin(),
        make: 'Toyota',
        model: 'Corolla',
        modelYear: 2014,
        categoryKey: 'automobile',
        use: 'private',
        seats: 5,
        ...over
    };
}

async function file(service: string, answers: Record<string, unknown>, who: As = as.officer): Promise<CaseOut> {
    const shown = await api.call('POST', '/api/v1/fees/preview', who, { serviceCode: service, answers });
    const fee =
        shown.statusCode === 200 ? shown.json<{ feeRuleVersionId: string | null; totalSantim: string }>() : undefined;
    const started = await api.call('POST', '/api/v1/service-requests', who, {
        serviceCode: service,
        answers,
        ...(fee?.feeRuleVersionId ? { fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim } } : {})
    });
    expect(started.statusCode, started.body).toBe(201);
    return started.json<CaseOut>();
}

const step = (c: CaseOut, who: As, body: object) =>
    api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));

async function moved(c: CaseOut, who: As, action: string, more: object = {}): Promise<CaseOut> {
    const res = await step(c, who, { action, ...more });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}

async function tried(c: CaseOut, who: As, action: string, more: object = {}) {
    const res = await step(c, who, { action, ...more });
    return { status: res.statusCode, body: res.json<ProblemBody>() };
}

const caseOf = async (id: string, who: As = as.officer) =>
    (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();

async function paid(c: CaseOut): Promise<void> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.boditiCashier);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call(
        'POST',
        `/api/v1/payment-orders/${id}/payments`,
        as.boditiCashier,
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Owner' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
}

/** Filed, reviewed, paid and approved: at the arrival step. */
async function atTheArrival(answers: Record<string, unknown>): Promise<CaseOut> {
    let c = await file(SERVICE, answers);
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('arrival');
    return c;
}

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

const vehicleOf = async (chassis: string) =>
    (
        await query<{ id: string; status: string; handling_unit_id: string }>(
            'select id, status, handling_unit_id from vehicles.vehicles where chassis_number = $1',
            [chassis]
        )
    )[0];

const platesOfVehicle = (vehicleId: string) =>
    query<{
        plate_key: string;
        format: string;
        source: string;
        until: string | null;
        ended_reason: string | null;
        plate_id: string | null;
        replaced_by_id: string | null;
        id: string;
    }>(
        `select id, plate_key, format, source, until::text, ended_reason, plate_id, replaced_by_id
           from vehicles.plate_assignments where vehicle_id = $1 order by since, created_at`,
        [vehicleId]
    );

const heldFor = (caseId: string) =>
    query<{ plate_key: string; status: string }>('select plate_key, status from vehicles.plates where case_id = $1', [
        caseId
    ]);

const freeAtBoditi = async () =>
    (
        await query<{ n: number }>(
            `select count(*)::int as n from vehicles.plates where holder_unit_id = $1 and status = 'in_stock'`,
            [boditi.id]
        )
    )[0]?.n ?? 0;

const feeOf = async (caseId: string) =>
    (
        await query<{ total: string }>(
            'select total_santim::text as total from fees.case_fees where case_id = $1 order by number desc limit 1',
            [caseId]
        )
    )[0]?.total;

/** A region setting for the time of `work`. */
async function regionSetting(key: string, value: unknown, work: () => Promise<void>) {
    await api.owner.query(
        `insert into kernel.settings_values (id, region_id, unit_id, key, value)
         values (gen_random_uuid(), $1, $2, $3, $4::jsonb)`,
        [region.regionId, region.id, key, JSON.stringify(value)]
    );
    try {
        await work();
    } finally {
        await api.owner.query('delete from kernel.settings_values where unit_id = $1 and key = $2', [region.id, key]);
    }
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.vta.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.vta.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.vta.inspector',
            sub: SUB.inspector,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.inspector']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    stock = api.http.get(PlateStock);
    arrivals = api.http.get(TransferArrivalService);
    region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.inspector = { sub: SUB.inspector, unit: boditi };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        await importVehicleServices(tx, root);
        expect(await importTransferArrivalService(tx, root)).toBe(1);
        expect(await importTransferArrivalService(tx, root)).toBe(0);
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'መጣ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Arriver', grandfather: 'Person' },
        sex: 'female',
        birthYear: 1985,
        acknowledgedDuplicates: []
    });
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
}, 300_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('a vehicle arriving on an old regional plate, the region exchanging it', () => {
    it('is registered at the office with a national plate from its stock, the old plate ended as exchanged', async () => {
        const answers = await answersOf();
        let c = await file(SERVICE, answers);
        // the fee: 2,000 Birr and the private use's plate fee
        expect(await feeOf(c.id)).toBe(String(200000n + 516100n));
        c = await moved(c, as.officer, 'submit');
        expect(c.state).toBe('review');
        c = await moved(c, as.officer, 'approve');
        await paid(c);
        c = await caseOf(c.id);
        const free = await freeAtBoditi();
        c = await moved(c, as.lead, 'approve');
        expect(c.state).toBe('arrival');
        // a national plate is held for the case from the approval
        const [held] = await heldFor(c.id);
        expect(held).toMatchObject({ status: 'reserved' });
        expect(await freeAtBoditi()).toBe(free - 1);
        expect(await vehicleOf(String(answers.chassisNumber))).toBeUndefined();
        // the approver does not register it
        expect((await step(c, as.lead, { action: 'register', answers: {} })).statusCode).toBe(403);

        const registering = await step(c, as.officer, { action: 'register', answers: {} });
        expect(registering.statusCode, registering.body).toBe(200);
        c = registering.json<CaseOut>();
        expect(c.state).toBe('registered');

        const vehicle = await vehicleOf(String(answers.chassisNumber));
        expect(vehicle).toMatchObject({ status: 'active', handling_unit_id: boditi.id });
        // the owners' period is acquired by transfer in, from the day the document gives
        expect(
            await query(
                'select since::text, acquired_by, case_id from vehicles.vehicle_ownerships where vehicle_id = $1',
                [vehicle?.id]
            )
        ).toEqual([{ since: '2019-06-01', acquired_by: 'transfer_in', case_id: c.id }]);
        // the old plate ended exchanged and points at the stock plate that replaced it
        const plates = await platesOfVehicle(String(vehicle?.id));
        expect(plates).toHaveLength(2);
        expect(plates[0]).toMatchObject({
            format: 'legacy',
            source: 'legacy',
            ended_reason: 'exchanged',
            replaced_by_id: plates[1]?.id
        });
        expect(plates[1]).toMatchObject({ plate_key: held?.plate_key, format: 'national', until: null });
        expect(plates[1]?.plate_id).not.toBeNull();
        expect(await heldFor(c.id)).toEqual([{ plate_key: held?.plate_key, status: 'assigned' }]);
        // the federal libre in force, and the registration certificate of this office
        expect(await query('select number, status from vehicles.libres where vehicle_id = $1', [vehicle?.id])).toEqual([
            { number: String(answers.libreNumber).replace('-', ''), status: 'issued' }
        ]);
        const documents = await query<{ key: string; number: string }>(
            `select t.key, d.number from documents.issued_documents d join documents.document_templates t on t.id = d.template_id
              where d.case_id = $1`,
            [c.id]
        );
        expect(documents).toEqual([
            { key: REGISTRATION_CERTIFICATE_TEMPLATE, number: expect.stringMatching(/\/RC\//) as string }
        ]);
        // the document as checked
        expect(
            await query(
                `select document_number, issuing_region, verified_how, valid_until::text, carried_plate_text, returned, holds_listed
                   from vehicles.vehicle_arrivals where vehicle_id = $1`,
                [vehicle?.id]
            )
        ).toEqual([
            {
                document_number: answers.transferDocumentNumber,
                issuing_region: 'Sample Region B',
                verified_how: 'letter',
                valid_until: answers.documentValidUntil,
                carried_plate_text: expect.any(String) as string,
                returned: false,
                holds_listed: false
            }
        ]);
        // every record the step made is audited
        const audit = await query<{ line: string; n: number }>(
            `select table_name || ':' || action as line, count(*)::int as n from kernel.audit_log
              where request_id = (select request_id from kernel.audit_log where table_name = 'vehicles.vehicle_arrivals' and diff::text like $1 limit 1)
              group by 1`,
            [`%${String(answers.transferDocumentNumber)}%`]
        );
        expect(Object.fromEntries(audit.map((a) => [a.line, a.n]))).toMatchObject({
            'vehicles.vehicles:insert': 1,
            'vehicles.vehicle_arrivals:insert': 1,
            'vehicles.libres:insert': 1,
            'documents.issued_documents:insert': 1
        });

        // the step run again writes nothing more
        const place = { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id };
        const facts = (
            await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [c.id])
        )[0]?.facts;
        const ctx = { ...contextFor(boditi), requestId: `again-${randomUUID()}` };
        const again = await app.scoped(ctx, (tx) =>
            arrivals.register(tx, { ...place, ctx }, facts ?? {}, answers as unknown as TransferArrivalInput)
        );
        expect(again.vehicle.id).toBe(vehicle?.id);
        expect(
            (await query('select 1 from vehicles.vehicles where chassis_number = $1', [answers.chassisNumber])).length
        ).toBe(1);
        expect(
            (await query('select 1 from vehicles.vehicle_arrivals where vehicle_id = $1', [vehicle?.id])).length
        ).toBe(1);
        expect(registry).toBeDefined();
    }, 300_000);
});

describe('a vehicle arriving on a plate it keeps', () => {
    it('keeps a national plate, charged no plate fee, with no stock movement', async () => {
        const plate = nationalPlate();
        const answers = await answersOf({ plate, takesNationalPlate: false });
        let c = await atTheArrival(answers);
        expect(await feeOf(c.id)).toBe('200000');
        expect(await heldFor(c.id)).toEqual([]);
        c = await moved(c, as.officer, 'register', { answers: {} });
        expect(c.state).toBe('registered');
        const vehicle = await vehicleOf(String(answers.chassisNumber));
        const plates = await platesOfVehicle(String(vehicle?.id));
        expect(plates).toEqual([
            expect.objectContaining({ format: 'national', source: 'manual', until: null, plate_id: null })
        ]);
        expect(await query('select 1 from vehicles.plate_movements where case_id = $1', [c.id])).toEqual([]);
    }, 300_000);

    it('keeps an old plate when the region does not exchange, the setting frozen when the request was filed', async () => {
        const answers = await answersOf({ takesNationalPlate: false });
        let c: CaseOut | undefined;
        await regionSetting('competency.vehicle_transfer_plate_exchange', false, async () => {
            c = await file(SERVICE, answers);
            c = await moved(c, as.officer, 'submit');
        });
        if (!c) throw new Error('not filed');
        // the setting is back on: the case stands as it was filed
        c = await moved(c, as.officer, 'approve');
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        expect(await heldFor(c.id)).toEqual([]);
        c = await moved(c, as.officer, 'register', { answers: {} });
        const vehicle = await vehicleOf(String(answers.chassisNumber));
        expect(await platesOfVehicle(String(vehicle?.id))).toEqual([
            expect.objectContaining({ format: 'legacy', until: null, ended_reason: null })
        ]);
    }, 300_000);
});

describe('the request', () => {
    const refused = async (over: Record<string, unknown>, path: string, code?: string) => {
        const c = await file(SERVICE, await answersOf(over));
        const r = await tried(c, as.officer, 'submit');
        expect(r.status, JSON.stringify(r.body)).toBe(422);
        expect(r.body.errors ?? []).toEqual(
            expect.arrayContaining([expect.objectContaining({ path, ...(code ? { code } : {}) })])
        );
        expect((await caseOf(c.id)).state).toBe('draft');
    };

    it('is refused at its field for the document: lapsed, dated wrongly, not checked', async () => {
        await refused({ documentValidUntil: '2020-01-02', documentDate: '2020-01-01' }, 'documentValidUntil', 'lapsed');
        await refused({ documentDate: today(), documentValidUntil: '2020-01-01' }, 'documentValidUntil', 'before_date');
        await refused({ documentVerified: false }, 'documentVerified', 'not_verified');
        await refused({ transferDocumentNumber: '   ' }, 'transferDocumentNumber', 'required');
    }, 300_000);

    it('is refused for a plate that does not follow the rule', async () => {
        await refused({ takesNationalPlate: false }, 'takesNationalPlate', 'must_take');
        await refused({ plate: nationalPlate(), takesNationalPlate: true }, 'takesNationalPlate', 'keeps_plate');
    }, 300_000);

    it('is refused for a chassis or federal id the register knows, by the status it has', async () => {
        const ctx = { ...contextFor(boditi), requestId: `seed-${randomUUID()}` };
        const known = async (federal: string) =>
            app.scoped(ctx, async (tx) => {
                const chassis = vin();
                const v = await registry.register(tx, ctx, {
                    chassisNumber: chassis,
                    federalVehicleId: federal,
                    federalIdSource: 'manual',
                    make: 'Toyota',
                    model: 'Corolla',
                    modelYear: 2012,
                    categoryKey: 'automobile',
                    use: 'private',
                    seats: 5,
                    firstRegisteredOn: '2013-03-01',
                    owners: [{ kind: 'person', id: owner }]
                });
                return { id: v.id, chassis };
            });
        const active = await known(`FED-${randomInt(100000, 999999)}`);
        await refused({ chassisNumber: active.chassis }, 'chassisNumber', 'active');
        const federal = `FED-${randomInt(100000, 999999)}`;
        const out = await known(federal);
        await api.owner.query(`update vehicles.vehicles set status = 'transferred_out' where id = $1`, [out.id]);
        // the vehicle of this region that left comes back by its own path (task 1.4c3b): refused here
        await refused({ chassisNumber: out.chassis }, 'chassisNumber', 'transferred_out');
        await refused({ federalVehicleId: federal }, 'federalVehicleId', 'transferred_out');
        // a chassis and a federal id of two vehicles
        await refused(
            { chassisNumber: active.chassis, federalVehicleId: federal },
            'federalVehicleId',
            'other_vehicle'
        );
    }, 300_000);

    it('is refused a libre another vehicle holds and a plate on the register', async () => {
        const first = await answersOf();
        const c = await atTheArrival(first);
        await moved(c, as.officer, 'register', { answers: {} });
        await refused({ libreNumber: first.libreNumber }, 'libreNumber', 'duplicate');
        // the plate the vehicle carried is the register's now: it ended exchanged, and an old plate is never handed out again
        const parsed = parsePlate(String(first.plate));
        expect(parsed, 'a plate of the default codes').not.toBeNull();
        await refused({ plate: String(first.plate) }, 'plate', 'plate_ended');
        // the document is used once per issuing region, however its number and the region's name are written
        await refused(
            {
                transferDocumentNumber: String(first.transferDocumentNumber).toLowerCase().replace('/', '-'),
                issuingRegion: 'sample-region b'
            },
            'transferDocumentNumber',
            'duplicate'
        );
    }, 300_000);

    it('folds a document number as a plate is folded', () => {
        expect(arrivalKey('SD/TR/123/2017')).toBe(arrivalKey('sd-tr-123-2017'));
        expect(arrivalKey(' Sample  Region_B ')).toBe('SAMPLEREGIONB');
    });

    it('refuses an arrival of a document, a libre or a federal id that another open arrival names', async () => {
        const first = await answersOf({ federalVehicleId: `FED-${randomInt(100000, 999999)}` });
        const a = await file(SERVICE, first);
        await moved(a, as.officer, 'submit');
        const notEligible = async (over: Record<string, unknown>) => {
            const c = await file(SERVICE, await answersOf(over));
            const r = await tried(c, as.officer, 'submit');
            expect(r.status, JSON.stringify(r.body)).toBe(422);
            expect(r.body.code).toBe('not_eligible');
            expect((await caseOf(c.id)).state).toBe('draft');
        };
        // the same document on another chassis, written otherwise
        await notEligible({
            transferDocumentNumber: String(first.transferDocumentNumber).toLowerCase(),
            issuingRegion: first.issuingRegion
        });
        // the same libre, and the same federal id
        await notEligible({ libreNumber: first.libreNumber });
        await notEligible({ federalVehicleId: first.federalVehicleId });
        // withdrawn (closed), the first claims nothing more
        const back = await moved(await caseOf(a.id), as.officer, 'return', { comment: 'Sent back' });
        await moved(back, as.officer, 'withdraw', { comment: 'Not needed' });
        const free = await file(SERVICE, await answersOf({ transferDocumentNumber: first.transferDocumentNumber }));
        expect((await tried(free, as.officer, 'submit')).status).toBe(200);
    }, 300_000);

    it('has no claim with no context: the reviewed function answers yes', async () => {
        const { rows } = await api.owner.query<{ claimed: boolean }>(
            `select competency.arrival_in_open_case('X', 'Y', null, null, null) as claimed`
        );
        expect(rows[0]?.claimed).toBe(true);
    });

    it('refuses a plate handed over for a vehicle that keeps its plate', async () => {
        const answers = await answersOf({ plate: nationalPlate(), takesNationalPlate: false });
        const c = await atTheArrival(answers);
        const r = await tried(c, as.officer, 'register', { answers: { replacementPlate: 'ETH ABC 1234' } });
        expect(r.status, JSON.stringify(r.body)).toBe(422);
        expect(r.body.errors).toEqual([expect.objectContaining({ path: 'replacementPlate', code: 'not_exchanged' })]);
        expect((await caseOf(c.id)).state).toBe('arrival');
    }, 300_000);
    it('refuses an open registration and another open arrival of the same chassis or plate, both ways', async () => {
        const first = await answersOf();
        const a = await file(SERVICE, first);
        await moved(a, as.officer, 'submit');
        // another arrival of the chassis, and of the plate
        const sameChassis = await file(SERVICE, await answersOf({ chassisNumber: first.chassisNumber }));
        expect((await tried(sameChassis, as.officer, 'submit')).status).toBe(422);
        const samePlate = await file(SERVICE, await answersOf({ plate: first.plate }));
        expect((await tried(samePlate, as.officer, 'submit')).status).toBe(422);
        // a new registration of the chassis
        const registration = await file(NEW_REGISTRATION, {
            owners: [{ ownerPerson: owner }],
            chassisNumber: first.chassisNumber,
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2014,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5
        });
        const r = await tried(registration, as.officer, 'submit');
        expect(r.status, JSON.stringify(r.body)).toBe(422);
        // and the other way: an open registration refuses an arrival
        const other = await answersOf();
        const open = await file(NEW_REGISTRATION, {
            owners: [{ ownerPerson: owner }],
            chassisNumber: other.chassisNumber,
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2014,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5
        });
        await moved(open, as.officer, 'submit');
        const arrival = await file(SERVICE, other);
        expect((await tried(arrival, as.officer, 'submit')).status).toBe(422);
    }, 300_000);

    it('is refused at filing by an office with no registration-certificate counter', async () => {
        const c = await file(SERVICE, await answersOf());
        const key = 'vehicles.registration-certificate';
        await api.owner.query(`update kernel.number_counters set key = $3 where unit_id = $1 and key = $2`, [
            boditi.id,
            key,
            `${key}.off`
        ]);
        try {
            const r = await tried(c, as.officer, 'submit');
            expect(r.status, JSON.stringify(r.body)).toBe(409);
            expect(r.body.code).toBe('not_configured');
        } finally {
            await api.owner.query(`update kernel.number_counters set key = $2 where unit_id = $1 and key = $3`, [
                boditi.id,
                key,
                `${key}.off`
            ]);
        }
        expect((await caseOf(c.id)).state).toBe('draft');
    }, 300_000);

    it('notes the holds the document lists and records none', async () => {
        const answers = await answersOf({ holdsListed: true, holdsNote: 'A bank loan is listed' });
        let c = await file(SERVICE, answers);
        c = await moved(c, as.officer, 'submit');
        const [row] = await query<{ facts: { transferArrival: { notices: string[] } } }>(
            'select facts from workflow.cases where id = $1',
            [c.id]
        );
        expect(row?.facts.transferArrival.notices).toContain('competency.notice.arrivalHoldsListed');
        c = await moved(c, as.officer, 'approve');
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        await moved(c, as.officer, 'register', { answers: {} });
        const vehicle = await vehicleOf(String(answers.chassisNumber));
        expect(
            await query('select holds_listed, holds_note from vehicles.vehicle_arrivals where vehicle_id = $1', [
                vehicle?.id
            ])
        ).toEqual([{ holds_listed: true, holds_note: 'A bank loan is listed' }]);
        expect(await query('select 1 from vehicles.vehicle_encumbrances where vehicle_id = $1', [vehicle?.id])).toEqual(
            []
        );
    }, 300_000);
});

describe('the case', () => {
    it('gives the held plate back to the stock when it is rejected at the arrival', async () => {
        const free = await freeAtBoditi();
        let c = await atTheArrival(await answersOf());
        expect(await freeAtBoditi()).toBe(free - 1);
        c = await moved(c, as.officer, 'reject', { comment: 'The document turned out to be forged' });
        expect(c.state).toBe('rejected');
        expect(await freeAtBoditi()).toBe(free);
        expect(await heldFor(c.id)).toEqual([]);
    }, 300_000);

    it('is inspected first when the region asks for it when the request is filed', async () => {
        let c: CaseOut | undefined;
        await regionSetting('competency.vehicle_transfer_reinspect', true, async () => {
            c = await file(SERVICE, await answersOf());
            c = await moved(c, as.officer, 'submit');
        });
        if (!c) throw new Error('not filed');
        c = await moved(c, as.officer, 'approve');
        expect(c.state).toBe('inspection');
        c = await moved(c, as.inspector, 'inspect', { answers: { inspectionMatches: true } });
        expect(c.state).toBe('payment');
    }, 300_000);
});
