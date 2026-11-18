/**
 * A vehicle returning to the region (task 1.4c3b, DVC-17, ADR-0060 point 8), end to end through the API on a real PostgreSQL 16 with
 * the Wolaita seeds: a vehicle that left the region on a DVC-14 release outside, whose release has lapsed, comes back on its own
 * record. The office the request is filed at takes it (and moves its live rows when it is another office); the owners, plate and libre
 * the owner brings change the register only where they differ; the release ends `returned`. Refused while the release stands and
 * with no owners on record; another request for the vehicle (DVC-16) stops it, both ways; the reviewed command and the trigger hold
 * what the case may write. Names and chassis are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daysAfter, TransferArrivalService, type TransferArrivalInput } from '@itrms/competency/api';
import { VEHICLE_TRANSFER_DOCUMENT_COUNTER, VEHICLE_TRANSFER_DOCUMENT_PATTERN } from '@itrms/competency/contracts';
import {
    importReleaseCancelService,
    importTransferArrivalService,
    importTransferOutService,
    importVehicleServices
} from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { PlateStock, VehicleRegistry } from '@itrms/vehicles/api';
import {
    REGISTRATION_CERTIFICATE_COUNTER,
    REGISTRATION_CERTIFICATE_PATTERN,
    vinCheckDigit
} from '@itrms/vehicles/contracts';
import {
    importPlateStockDemo,
    importVehicleCategories,
    setUpRegistrationCertificateCounters
} from '@itrms/vehicles/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    // the demo's own: Boditi's cashier
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    officer: '0199f0a0-d000-7000-8000-00000000f831',
    lead: '0199f0a0-d000-7000-8000-00000000f832',
    zoneOfficer: '0199f0a0-d000-7000-8000-00000000f833',
    zoneLead: '0199f0a0-d000-7000-8000-00000000f834',
    zoneCashier: '0199f0a0-d000-7000-8000-00000000f835'
};
const OUT = 'DVC-14';
const CANCEL = 'DVC-16';
const ARRIVAL = 'DVC-17';
const OUTSIDE = {
    destination: 'outside',
    destinationName: 'Sample Transport Bureau',
    destinationRegion: 'Sample Region'
};
const DOCUMENT_ANSWERS = { customsDeclarationNumber: 'CD-1', purchaseValueBirr: 350000 };

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let stock: PlateStock;
let arrivals: TransferArrivalService;
let region: OrgUnit;
let zone: OrgUnit;
let boditi: OrgUnit;
let owner: string;
let otherOwner: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

/** The people that work one office's request, to the end. */
interface Desk {
    officer: As;
    lead: As;
    cashier: As;
    unit: OrgUnit;
}
let boditiDesk: Desk;
let zoneDesk: Desk;

let serial = 0;
function vin(): string {
    serial += 1;
    const base = `4HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}
const legacyPlate = () => `SN 2-${String(randomInt(10000, 99999))}`;
const nationalPlate = () => `ETH QZX ${String(randomInt(1000, 9999))}`;
const bookletNumber = () => `FED${String(randomInt(100000, 999999))}`;

interface ProblemBody {
    code?: string;
    errors?: { path: string; code: string; message: string }[];
}

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

interface OnTheRoad {
    id: string;
    chassis: string;
    legacy: string;
    libre: string;
}

/**
 * A vehicle of Boditi with its owner, an old regional plate and a numbered libre in force; with `stockPlate`, a national plate from
 * the office's stock is on it (the old one ended exchanged).
 */
async function onTheRoad(stockPlate: boolean): Promise<OnTheRoad> {
    const ctx: DbContext = { ...contextFor(boditi), requestId: `seed-${randomUUID()}` };
    const chassis = vin();
    const legacy = legacyPlate();
    const libre = bookletNumber();
    return app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: chassis,
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2012,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5,
            firstRegisteredOn: '2013-03-01',
            owners: [{ kind: 'person', id: owner }]
        });
        await registry.recordPlate(tx, ctx, vehicle.id, { text: legacy, source: 'legacy', since: '2013-03-01' });
        await registry.recordLibre(tx, ctx, vehicle.id, { number: libre, issuedOn: '2013-03-01' });
        if (stockPlate) await registry.assignStockPlate(tx, ctx, vehicle.id, { since: today() });
        return { id: vehicle.id, chassis, legacy, libre };
    });
}

async function file(service: string, answers: Record<string, unknown>, who: As): Promise<CaseOut> {
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

const caseOf = async (id: string, who: As) => (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();

async function paid(c: CaseOut, cashier: As): Promise<void> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, cashier);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call(
        'POST',
        `/api/v1/payment-orders/${id}/payments`,
        cashier,
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Owner' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
}

/** A scan the officer uploaded: stored, at the office. */
async function scan(desk: Desk): Promise<string> {
    const id = randomUUID();
    await api.owner.query(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
             confirmed_at, origin, created_by)
         values ($1, $2, $3, 'stored', 'transfer-document.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
        [
            id,
            desk.unit.regionId,
            desk.unit.id,
            `files/${desk.unit.regionId}/${id}`,
            await api.userId(desk === zoneDesk ? SUB.zoneOfficer : SUB.officer)
        ]
    );
    return id;
}

/** The plate the vehicle carries, as written. */
const carriedText = async (vehicleId: string) =>
    (
        await query<{ plate_text: string }>(
            'select plate_text from vehicles.plate_assignments where vehicle_id = $1 and until is null',
            [vehicleId]
        )
    )[0]?.plate_text;

/** The request as the officer types it from the document, for the vehicle as the register has it: the same owners, plate and libre. */
async function answersOf(
    v: OnTheRoad,
    over: Record<string, unknown> = {},
    desk: Desk = boditiDesk
): Promise<Record<string, unknown>> {
    return {
        transferDocumentNumber: `VT/${String(randomInt(100000, 999999))}`,
        issuingRegion: 'Sample Region B',
        issuingOffice: 'Sample Vehicle Office',
        documentDate: today(),
        documentValidUntil: daysAfter(today(), 10),
        documentVerified: true,
        verifiedHow: 'letter',
        transferDocumentScan: [{ file_id: await scan(desk) }],
        owners: [{ ownerPerson: owner }],
        firstRegisteredOn: '2013-03-01',
        plate: (await carriedText(v.id)) ?? v.legacy,
        takesNationalPlate: false,
        libreNumber: v.libre,
        libreIssuedOn: '2013-03-01',
        chassisNumber: v.chassis,
        make: 'Toyota',
        model: 'Corolla',
        modelYear: 2012,
        categoryKey: 'automobile',
        use: 'private',
        seats: 5,
        ...over
    };
}

const handoverOf = async (vehicleId: string) =>
    (
        await query<{
            id: string;
            status: string;
            in_case_id: string | null;
            received_on: string | null;
            received_by: string | null;
            valid_until: string;
        }>(
            `select id, status, in_case_id, received_on::text, received_by, valid_until::text from vehicles.vehicle_handovers
              where vehicle_id = $1 order by created_at desc`,
            [vehicleId]
        )
    )[0];

/** A release outside the region, standing, with its transfer document. */
async function leftTheRegion(v: OnTheRoad): Promise<{ out: CaseOut; handoverId: string }> {
    let out = await file(OUT, { vehicle: v.id, ...OUTSIDE }, boditiDesk.officer);
    out = await moved(out, boditiDesk.officer, 'submit');
    out = await moved(out, boditiDesk.officer, 'approve');
    await paid(out, boditiDesk.cashier);
    out = await moved(await caseOf(out.id, boditiDesk.officer), boditiDesk.lead, 'approve');
    expect(out.state).toBe('document');
    out = await moved(out, boditiDesk.officer, 'issue_document', { answers: DOCUMENT_ANSWERS });
    expect(out.state).toBe('transferred_out');
    const handover = await handoverOf(v.id);
    expect(handover).toMatchObject({ status: 'released' });
    return { out, handoverId: handover?.id ?? '' };
}

/** The document the vehicle left on has lapsed: the trigger refuses a day moved by hand, so this is the passing of time. */
async function lapsed(vehicleId: string, outCaseId: string): Promise<void> {
    try {
        await api.owner.query('alter table vehicles.vehicle_handovers disable trigger user');
        await api.owner.query('alter table documents.issued_documents disable trigger user');
        await api.owner.query(
            `update vehicles.vehicle_handovers set released_on = $2::date - 3, valid_until = $2::date - 1 where vehicle_id = $1`,
            [vehicleId, today()]
        );
        await api.owner.query('update documents.issued_documents set valid_until = $2::date - 1 where case_id = $1', [
            outCaseId,
            today()
        ]);
    } finally {
        await api.owner.query('alter table documents.issued_documents enable trigger user');
        await api.owner.query('alter table vehicles.vehicle_handovers enable trigger user');
    }
}

/** A vehicle that left the region on a release that has lapsed. */
async function gone(stockPlate: boolean) {
    const v = await onTheRoad(stockPlate);
    const left = await leftTheRegion(v);
    await lapsed(v.id, left.out.id);
    return { v, ...left };
}

/** Filed, reviewed, paid and approved: at the arrival step. */
async function atTheArrival(answers: Record<string, unknown>, desk: Desk = boditiDesk): Promise<CaseOut> {
    let c = await file(ARRIVAL, answers, desk.officer);
    c = await moved(c, desk.officer, 'submit');
    c = await moved(c, desk.officer, 'approve');
    expect(c.state).toBe('payment');
    await paid(c, desk.cashier);
    c = await caseOf(c.id, desk.officer);
    expect(c.state).toBe('approval');
    c = await moved(c, desk.lead, 'approve');
    expect(c.state).toBe('arrival');
    return c;
}

/** The request filed and submitted: the check has written its facts. */
async function submitted(answers: Record<string, unknown>, desk: Desk = boditiDesk): Promise<CaseOut> {
    return moved(await file(ARRIVAL, answers, desk.officer), desk.officer, 'submit');
}

const factsOf = async (caseId: string) =>
    (await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [caseId]))[0]
        ?.facts ?? {};

const vehicleRow = async (id: string) =>
    (
        await query<{ status: string; handling_unit_id: string; make: string; model: string }>(
            'select status, handling_unit_id, make, model from vehicles.vehicles where id = $1',
            [id]
        )
    )[0];

const periodsOf = (vehicleId: string) =>
    query<{ since: string; until: string | null; acquired_by: string; handling_unit_id: string }>(
        `select since::text, until::text, acquired_by, handling_unit_id from vehicles.vehicle_ownerships
          where vehicle_id = $1 order by since`,
        [vehicleId]
    );

const platesOf = (vehicleId: string) =>
    query<{
        plate_key: string;
        source: string;
        until: string | null;
        ended_reason: string | null;
        plate_id: string | null;
        handling_unit_id: string;
        id: string;
        replaced_by_id: string | null;
    }>(
        `select id, plate_key, source, until::text, ended_reason, plate_id, handling_unit_id, replaced_by_id
           from vehicles.plate_assignments where vehicle_id = $1 order by since, created_at`,
        [vehicleId]
    );

const librePlaces = (vehicleId: string) =>
    query<{ number: string | null; status: string; handling_unit_id: string; replaces_id: string | null; id: string }>(
        'select id, number, status, handling_unit_id, replaces_id from vehicles.libres where vehicle_id = $1 order by created_at',
        [vehicleId]
    );

const arrivalOf = async (vehicleId: string) =>
    query<{ returned: boolean; handover_id: string | null; case_id: string; handling_unit_id: string }>(
        'select returned, handover_id, case_id, handling_unit_id from vehicles.vehicle_arrivals where vehicle_id = $1',
        [vehicleId]
    );

const events = async (caseId: string) =>
    (
        await query<{ n: number }>(
            `select count(*)::int as n from kernel.audit_log where event_type = 'vehicles.returned' and diff->>'caseId' = $1`,
            [caseId]
        )
    )[0]?.n ?? 0;

/** What a statement written as the application role is refused with, if it is. */
async function refusedAs(unit: OrgUnit, statement: ReturnType<typeof sql>) {
    const error: unknown = await app
        .scoped(contextFor(unit), (tx) => tx.execute(statement))
        .then(
            () => undefined,
            (e: unknown) => e
        );
    return (error as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
}

const refusedAt = async (c: CaseOut, desk: Desk, path: string, code: string) => {
    const r = await tried(c, desk.officer, 'submit');
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.errors ?? []).toEqual(expect.arrayContaining([expect.objectContaining({ path, code })]));
    expect((await caseOf(c.id, desk.officer)).state).toBe('draft');
};

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.vr.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.vr.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.vr.zoneofficer',
            sub: SUB.zoneOfficer,
            region: 'SER',
            home: 'WOL',
            roles: [
                ['WOL', 'competency.officer'],
                ['WOL', 'records_officer']
            ]
        },
        {
            username: 'test.vr.zonelead',
            sub: SUB.zoneLead,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.lead']]
        },
        {
            username: 'test.vr.zonecashier',
            sub: SUB.zoneCashier,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'cashier']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    stock = api.http.get(PlateStock);
    arrivals = api.http.get(TransferArrivalService);
    region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.zoneOfficer = { sub: SUB.zoneOfficer, unit: zone };
    as.zoneLead = { sub: SUB.zoneLead, unit: zone };
    as.zoneCashier = { sub: SUB.zoneCashier, unit: zone };
    boditiDesk = { officer: as.officer, lead: as.lead, cashier: as.boditiCashier, unit: boditi };
    zoneDesk = { officer: as.zoneOfficer, lead: as.zoneLead, cashier: as.zoneCashier, unit: zone };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        await importVehicleServices(tx, root);
        await importTransferOutService(tx, root);
        await importReleaseCancelService(tx, root);
        expect(await importTransferArrivalService(tx, root)).toBe(1);
        await setUpCounter(tx, {
            key: VEHICLE_TRANSFER_DOCUMENT_COUNTER,
            unitId: boditi.id,
            regionId: root.regionId,
            pattern: VEHICLE_TRANSFER_DOCUMENT_PATTERN
        });
        // the zone numbers the certificate of a vehicle it takes back
        await setUpCounter(tx, {
            key: REGISTRATION_CERTIFICATE_COUNTER,
            unitId: zone.id,
            regionId: root.regionId,
            pattern: REGISTRATION_CERTIFICATE_PATTERN
        });
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
    const person = async (father: string) => {
        const res = await api.call('POST', '/api/v1/persons', as.officer, {
            nameAm: { given: 'ባለቤት', father: 'ተመላሽ', grandfather: 'ታደሰ' },
            nameEn: { given: 'Sample', father, grandfather: 'Person' },
            sex: 'female',
            birthYear: 1985,
            acknowledgedDuplicates: []
        });
        expect(res.statusCode, res.body).toBe(201);
        return res.json<{ id: string }>().id;
    };
    owner = await person('Returner');
    otherOwner = await person('Buyer');
}, 300_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('a vehicle returning to the office it left from', () => {
    it('comes back on its own record, with the same owners, plate and libre changing nothing', async () => {
        const { v, handoverId } = await gone(true);
        expect(await vehicleRow(v.id)).toMatchObject({ status: 'transferred_out', handling_unit_id: boditi.id });
        const platesBefore = await platesOf(v.id);
        const answers = await answersOf(v);
        let c = await submitted(answers);
        // the case shows that the vehicle comes back
        const facts = await factsOf(c.id);
        expect(facts.transferArrival).toMatchObject({
            returning: { vehicleId: v.id, handoverId, ownersChanged: false, plate: 'same' },
            notices: ['competency.notice.arrivalReturning']
        });
        c = await moved(c, as.officer, 'approve');
        await paid(c, as.boditiCashier);
        c = await moved(await caseOf(c.id, as.officer), as.lead, 'approve');
        expect(c.state).toBe('arrival');
        expect(await vehicleRow(v.id)).toMatchObject({ status: 'transferred_out' });
        c = await moved(c, as.officer, 'register', { answers: {} });
        expect(c.state).toBe('registered');

        // the same record, active again at the office, the release ended returned by this case
        expect(await vehicleRow(v.id)).toMatchObject({ status: 'active', handling_unit_id: boditi.id });
        expect(
            await query('select 1 from vehicles.vehicles where chassis_number = $1', [answers.chassisNumber])
        ).toHaveLength(1);
        expect(await handoverOf(v.id)).toMatchObject({
            id: handoverId,
            status: 'returned',
            in_case_id: c.id,
            received_on: today()
        });
        expect((await handoverOf(v.id))?.received_by).not.toBeNull();
        expect(await arrivalOf(v.id)).toEqual([
            { returned: true, handover_id: handoverId, case_id: c.id, handling_unit_id: boditi.id }
        ]);
        // the owners, plate and libre as they were: no new period, plate or libre
        expect(await periodsOf(v.id)).toEqual([
            { since: '2013-03-01', until: null, acquired_by: 'first_registration', handling_unit_id: boditi.id }
        ]);
        expect(await platesOf(v.id)).toEqual(platesBefore);
        expect(await librePlaces(v.id)).toEqual([expect.objectContaining({ number: v.libre, status: 'issued' })]);
        expect(await query('select 1 from vehicles.plate_movements where case_id = $1', [c.id])).toEqual([]);
        // the registration certificate of the office, for the libre in force
        expect(
            await query<{ key: string }>(
                `select t.key from documents.issued_documents d join documents.document_templates t on t.id = d.template_id
                  where d.case_id = $1`,
                [c.id]
            )
        ).toHaveLength(1);
        // the vehicle and the release are audited as moved, in the step's transaction
        expect(await events(c.id)).toBe(2);

        // the step run again writes nothing more: the arrival's own run, and the reviewed command
        const place = { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id };
        const ctx: DbContext = { ...contextFor(boditi), requestId: `again-${randomUUID()}` };
        const again = await app.scoped(ctx, (tx) =>
            arrivals.register(tx, { ...place, ctx }, facts, answers as unknown as TransferArrivalInput)
        );
        expect(again.vehicle.id).toBe(v.id);
        expect(await arrivalOf(v.id)).toHaveLength(1);
        const rerun = await app.scoped(contextFor(boditi), (tx) =>
            tx.execute(sql`select * from vehicles.accept_return(${c.id}::uuid)`)
        );
        expect(rerun.rows).toEqual([]);
        expect(await events(c.id)).toBe(2);
    }, 300_000);

    it('keeps the register’s facts where the document differs, with a notice', async () => {
        const { v } = await gone(true);
        let c = await submitted(await answersOf(v, { model: 'Corolla Cross', modelYear: 2013 }));
        const notices = ((await factsOf(c.id)).transferArrival as { notices: string[] }).notices;
        expect(notices).toEqual(['competency.notice.arrivalReturning', 'competency.notice.arrivalFactsDiffer']);
        c = await moved(c, as.officer, 'approve');
        await paid(c, as.boditiCashier);
        c = await moved(await caseOf(c.id, as.officer), as.lead, 'approve');
        await moved(c, as.officer, 'register', { answers: {} });
        expect(await vehicleRow(v.id)).toMatchObject({ status: 'active', make: 'Toyota', model: 'Corolla' });
    }, 300_000);
});

describe('a vehicle returning to another office, with other owners and another libre', () => {
    it('is taken there with its live rows, the owners changed by transfer in and the libre replaced', async () => {
        const { v, handoverId } = await gone(true);
        const libre = bookletNumber();
        const answers = await answersOf(
            v,
            {
                owners: [{ ownerPerson: otherOwner }],
                ownersSince: '2024-01-01',
                libreNumber: libre,
                libreIssuedOn: '2024-02-01'
            },
            zoneDesk
        );
        const held = (await platesOf(v.id)).find((p) => p.until === null);
        expect(held?.plate_id).not.toBeNull();
        const c = await atTheArrival(answers, zoneDesk);
        expect(((await factsOf(c.id)).transferArrival as { returning: object }).returning).toMatchObject({
            ownersChanged: true,
            plate: 'same'
        });
        const registered = await moved(c, as.zoneOfficer, 'register', { answers: {} });
        expect(registered.state).toBe('registered');

        expect(await vehicleRow(v.id)).toMatchObject({ status: 'active', handling_unit_id: zone.id });
        expect(await handoverOf(v.id)).toMatchObject({ id: handoverId, status: 'returned', in_case_id: c.id });
        // the old period closes the day the new owners took it, the new one is acquired by transfer in; the period that was open moved to the office first
        expect(await periodsOf(v.id)).toEqual([
            {
                since: '2013-03-01',
                until: '2024-01-01',
                acquired_by: 'first_registration',
                handling_unit_id: zone.id
            },
            { since: '2024-01-01', until: null, acquired_by: 'transfer_in', handling_unit_id: zone.id }
        ]);
        // the libre for the former owners is cancelled, and the one brought points at it
        const libres = await librePlaces(v.id);
        expect(libres).toHaveLength(2);
        expect(libres[0]).toMatchObject({ number: v.libre, status: 'cancelled' });
        expect(libres[1]).toMatchObject({
            number: libre,
            status: 'issued',
            handling_unit_id: zone.id,
            replaces_id: libres[0]?.id
        });
        // the plate and its stock plate went with the vehicle, one ledger row at each office
        expect((await platesOf(v.id)).filter((p) => p.until === null)).toEqual([
            expect.objectContaining({ id: held?.id, handling_unit_id: zone.id })
        ]);
        expect(
            await query('select holder_unit_id, status from vehicles.plates where id = $1', [held?.plate_id])
        ).toEqual([{ holder_unit_id: zone.id, status: 'assigned' }]);
        expect(
            await query('select unit_id, kind from vehicles.plate_movements where case_id = $1 order by kind', [c.id])
        ).toEqual([
            { unit_id: zone.id, kind: 'hand_over_in' },
            { unit_id: boditi.id, kind: 'hand_over_out' }
        ]);
        // the vehicle, its period and holder, its plate assignment, its libre, the stock plate with its two movements, and the release
        expect(await events(c.id)).toBe(9);
        for (const unit of [boditi, zone]) {
            const summary = await app.scoped(contextFor(unit), (tx) => stock.summary(tx, contextFor(unit)));
            expect(summary.unit.reconciled, unit.code).toBe(true);
        }
    }, 300_000);
});

describe('the plate on return', () => {
    it('records a plate of another region and ends the one the vehicle left with as transferred', async () => {
        const { v } = await gone(true);
        const plate = nationalPlate();
        const answers = await answersOf(v, { plate });
        const held = (await platesOf(v.id)).find((p) => p.until === null);
        const c = await atTheArrival(answers);
        expect(((await factsOf(c.id)).transferArrival as { returning: object }).returning).toMatchObject({
            plate: 'new'
        });
        await moved(c, as.officer, 'register', { answers: {} });
        const plates = await platesOf(v.id);
        expect(plates).toHaveLength(3);
        expect(plates[1]).toMatchObject({
            id: held?.id,
            ended_reason: 'transferred',
            replaced_by_id: plates[2]?.id
        });
        expect(plates[2]).toMatchObject({ source: 'manual', until: null, plate_id: null });
        // the stock plate it left with leaves the stock for good
        expect(await query('select status from vehicles.plates where id = $1', [held?.plate_id])).toEqual([
            { status: 'retired' }
        ]);
    }, 300_000);

    it('refuses a plate of the vehicle’s own past, and takes a national plate from stock for an old regional one', async () => {
        // on its stock plate now: its old regional plate is a plate of its past
        const past = await gone(true);
        const c = await file(
            ARRIVAL,
            await answersOf(past.v, { plate: past.v.legacy, takesNationalPlate: true }),
            as.officer
        );
        await refusedAt(c, boditiDesk, 'plate', 'plate_history');

        // on its old regional plate, the region exchanging: the same case gives it a national plate from the office's stock
        const { v } = await gone(false);
        const answers = await answersOf(v, { takesNationalPlate: true });
        const arrival = await atTheArrival(answers);
        expect(((await factsOf(arrival.id)).transferArrival as { returning: object }).returning).toMatchObject({
            plate: 'same'
        });
        await moved(arrival, as.officer, 'register', { answers: {} });
        const plates = await platesOf(v.id);
        expect(plates).toHaveLength(2);
        expect(plates[0]).toMatchObject({
            plate_key: expect.stringContaining('SN') as string,
            ended_reason: 'exchanged'
        });
        expect(plates[1]).toMatchObject({ until: null, plate_id: expect.any(String) as string });
    }, 300_000);
});

describe('what stops a return', () => {
    it('is the release of this region while its document is valid, and a vehicle with no owners on record', async () => {
        // released outside, not lapsed: its owner cancels it at the releasing office
        const v = await onTheRoad(true);
        await leftTheRegion(v);
        const standing = await file(ARRIVAL, await answersOf(v), as.officer);
        await refusedAt(standing, boditiDesk, 'chassisNumber', 'release_standing');

        // a vehicle that left before the owners were kept on record
        const ctx: DbContext = { ...contextFor(boditi), requestId: `seed-${randomUUID()}` };
        const chassis = vin();
        const bare = await app.scoped(ctx, (tx) =>
            registry.register(tx, ctx, {
                chassisNumber: chassis,
                make: 'Toyota',
                model: 'Corolla',
                modelYear: 2012,
                categoryKey: 'automobile',
                use: 'private',
                seats: 5,
                firstRegisteredOn: '2013-03-01',
                owners: [{ kind: 'person', id: owner }]
            })
        );
        await api.owner.query(`update vehicles.vehicles set status = 'transferred_out' where id = $1`, [bare.id]);
        await api.owner.query(`update vehicles.vehicle_ownerships set until = '2020-01-01' where vehicle_id = $1`, [
            bare.id
        ]);
        const noOwners = await file(
            ARRIVAL,
            await answersOf({ id: bare.id, chassis, legacy: legacyPlate(), libre: bookletNumber() }),
            as.officer
        );
        await refusedAt(noOwners, boditiDesk, 'chassisNumber', 'no_owners_on_record');
    }, 300_000);

    it('is other owners with no day they took it, a libre dated before it, and the libre of the former owners again', async () => {
        const { v } = await gone(true);
        const other = { owners: [{ ownerPerson: otherOwner }] };
        await refusedAt(
            await file(ARRIVAL, await answersOf(v, { ...other, libreNumber: bookletNumber() }), as.officer),
            boditiDesk,
            'ownersSince',
            'before_period'
        );
        await refusedAt(
            await file(
                ARRIVAL,
                await answersOf(v, {
                    ...other,
                    ownersSince: '2024-01-01',
                    libreNumber: bookletNumber(),
                    libreIssuedOn: '2023-12-01'
                }),
                as.officer
            ),
            boditiDesk,
            'libreIssuedOn',
            'before_period'
        );
        // the libre the register holds for other owners is another vehicle's number once they change: not brought again
        await refusedAt(
            await file(
                ARRIVAL,
                await answersOf(v, { ...other, ownersSince: '2024-01-01', libreIssuedOn: '2024-02-01' }),
                as.officer
            ),
            boditiDesk,
            'libreNumber',
            'duplicate'
        );
    }, 300_000);

    it('is another request for the vehicle, DVC-16 for its release or a return, both ways', async () => {
        // a return open: its release cannot be cancelled
        const { v } = await gone(true);
        const open = await submitted(await answersOf(v));
        const cancel = await file(CANCEL, { vehicle: v.id, reason: 'The owner changed their mind' }, as.officer);
        const refused = await tried(cancel, as.officer, 'submit');
        expect([409, 422], JSON.stringify(refused.body)).toContain(refused.status);
        expect((await caseOf(cancel.id, as.officer)).state).toBe('draft');
        // and the return is withdrawn: the cancellation goes through, the vehicle is active, so it is no return any more
        const back = await moved(open, as.officer, 'return', { comment: 'Sent back' });
        await moved(back, as.officer, 'withdraw', { comment: 'Not needed' });

        // a cancellation open: the return is refused
        const w = await gone(true);
        const cancelling = await moved(
            await file(CANCEL, { vehicle: w.v.id, reason: 'The owner changed their mind' }, as.officer),
            as.officer,
            'submit'
        );
        expect(cancelling.state).toBe('review');
        const r = await tried(await file(ARRIVAL, await answersOf(w.v), as.officer), as.officer, 'submit');
        expect(r.status, JSON.stringify(r.body)).toBe(422);
        expect(r.body.code).toBe('not_eligible');
    }, 300_000);
});

describe('the reviewed command and the trigger', () => {
    it('refuse what is not the case’s own open return', async () => {
        const { v } = await gone(true);
        const c = await atTheArrival(await answersOf(v));
        const accept = (ctx: DbContext, caseId: string) =>
            app.scoped(ctx, (tx) => tx.execute(sql`select * from vehicles.accept_return(${caseId}::uuid)`));
        // nobody: no context; an office the case is not within; the other region's view of it
        await expect(accept({}, c.id)).rejects.toMatchObject({ cause: { code: '42501' } });
        await expect(accept(contextFor(await api.unit('SER', 'WOL-DAMOT-GALE')), c.id)).rejects.toMatchObject({
            cause: { code: '42501' }
        });
        await expect(accept({ ...contextFor(boditi), regionId: randomUUID() }, c.id)).rejects.toMatchObject({
            cause: { code: '23514', constraint: 'handover_return_refused' }
        });
        // a case that is no DVC-17 case
        const cancelCase = await file(CANCEL, { vehicle: v.id, reason: 'The owner changed their mind' }, as.officer);
        await expect(accept(contextFor(boditi), cancelCase.id)).rejects.toMatchObject({
            cause: { code: '23514', constraint: 'handover_return_refused' }
        });
        // a case that names another vehicle, or none that left
        const other = await onTheRoad(false);
        const facts = await factsOf(c.id);
        for (const named of [other.id, randomUUID()]) {
            await api.owner.query(
                `update workflow.cases set facts = jsonb_set(facts, '{transferArrival,returning,vehicleId}', to_jsonb($2::text)) where id = $1`,
                [c.id, named]
            );
            await expect(accept(contextFor(boditi), c.id)).rejects.toMatchObject({
                cause: { code: '23514', constraint: 'handover_return_refused' }
            });
        }
        await api.owner.query('update workflow.cases set facts = $2::jsonb where id = $1', [
            c.id,
            JSON.stringify(facts)
        ]);
        // the vehicle did not come back through any of them
        expect(await vehicleRow(v.id)).toMatchObject({ status: 'transferred_out' });

        // a closed case: rejected, it names the vehicle and the release, and is refused
        const rejected = await moved(c, as.officer, 'reject', { comment: 'The document turned out to be forged' });
        expect(rejected.state).toBe('rejected');
        await expect(accept(contextFor(boditi), rejected.id)).rejects.toMatchObject({
            cause: { code: '23514', constraint: 'handover_return_refused' }
        });
        expect(await vehicleRow(v.id)).toMatchObject({ status: 'transferred_out' });
        expect(await handoverOf(v.id)).toMatchObject({ status: 'released' });
    }, 300_000);

    it('keep the application role from ending a release as returned by hand', async () => {
        const { v, handoverId } = await gone(false);
        const trigger = { code: '23514', constraint: 'handover_transition' };
        // no case of the office names this release
        expect(
            await refusedAs(
                boditi,
                sql`update vehicles.vehicle_handovers set status = 'returned' where id = ${handoverId}::uuid`
            )
        ).toMatchObject(trigger);
        // an arrival case that names it, written by the role: not the columns of the receipt
        const c = await submitted(await answersOf(v, { takesNationalPlate: true }));
        expect(
            await refusedAs(
                boditi,
                sql`update vehicles.vehicle_handovers set status = 'returned', in_case_id = ${c.id}::uuid where id = ${handoverId}::uuid`
            )
        ).toBeDefined();
        expect(await handoverOf(v.id)).toMatchObject({ status: 'released' });
    }, 300_000);
});

describe('the reviewed question of an open return', () => {
    it('answers yes for a release a return names, and no for one nothing names', async () => {
        const { v, handoverId } = await gone(true);
        const asked = (handover: string) =>
            app.scoped(contextFor(boditi), async (tx) => {
                const { rows } = await tx.execute<{ taken: boolean }>(
                    sql`select competency.release_in_open_case(${handover}::uuid, ${v.id}::uuid, null) as taken`
                );
                return rows[0]?.taken;
            });
        expect(await asked(handoverId)).toBe(false);
        const open = await submitted(await answersOf(v));
        expect(await asked(handoverId)).toBe(true);
        const back = await moved(open, as.officer, 'return', { comment: 'Sent back' });
        await moved(back, as.officer, 'withdraw', { comment: 'Not needed' });
        expect(await asked(handoverId)).toBe(false);
    }, 300_000);
});
