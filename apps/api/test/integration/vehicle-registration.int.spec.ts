/**
 * The new vehicle registration service as it is seeded (task 1.2b, DVC-01), run end to end through the API on a real PostgreSQL 16
 * with the Wolaita seeds: filed at Boditi's counter, checked, paid at the till, approved, and registered with a federal id, which
 * makes the vehicle, its first ownership, its plate from the office's stock, its libre and the temporary libre (a numbered
 * certificate); the last step writes the libre in a federal booklet from the office's stationery (task 1.2d, ADR-0050). The refusals
 * at filing, the plate's life (held from approval, given back on rejection, replaced by another), a step that fails undoing
 * everything it did, and each effect run twice making one record. Chassis numbers, plates and names are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VehicleRegistrationService, type RegistrationInput } from '@itrms/competency/api';
import { importVehicleServices, vehicleRegistrationFlow } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { StationeryStock } from '@itrms/fees/api';
import { importFeeRules, importStationeryDemo, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { PlateStock } from '@itrms/vehicles/api';
import { nationalPlateText, vinCheckDigit } from '@itrms/vehicles/contracts';
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
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    officer: '0199f0a0-d000-7000-8000-00000000d702',
    lead: '0199f0a0-d000-7000-8000-00000000d704',
    cashier: '0199f0a0-d000-7000-8000-000000000303'
};
const SERVICE = 'DVC-01';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let stock: PlateStock;
let stationery: StationeryStock;
let registration: VehicleRegistrationService;
let boditi: OrgUnit;
let owner: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

let serial = 0;
/** A 17-character VIN of a country where the check digit is law, with its check digit right. */
function vin(): string {
    serial += 1;
    const base = `1HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}

const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');

async function registered(): Promise<string> {
    serial += 1;
    const res = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: `ተሽከርካሪ${lettersOf(serial, ETHIOPIC)}`, grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: `Owner${lettersOf(serial, LATIN)}`, grandfather: 'Person' },
        sex: 'male',
        birthYear: 1985,
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

const request = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
    owners: [{ ownerPerson: owner }],
    chassisNumber: vin(),
    make: 'Toyota',
    model: 'Vitz',
    modelYear: 2018,
    categoryKey: 'automobile',
    use: 'private',
    seats: 5,
    colour: 'White',
    ...over
});

const preview = async (answers: object, who: As) => {
    const res = await api.call('POST', '/api/v1/fees/preview', who, { serviceCode: SERVICE, answers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{
        feeRuleVersionId: string;
        totalSantim: string;
        lines: { key: string; amountSantim: string }[];
    }>();
};

async function filed(answers: Record<string, unknown>, who: As = as.officer): Promise<CaseOut> {
    const shown = await preview(answers, who);
    const started = await api.call('POST', '/api/v1/service-requests', who, {
        serviceCode: SERVICE,
        answers,
        fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
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

const caseOf = async (id: string, who: As = as.officer) =>
    (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();

const factsOf = async (id: string) =>
    (await api.owner.query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [id]))
        .rows[0]?.facts ?? {};

async function paid(c: CaseOut): Promise<void> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.cashier);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call(
        'POST',
        `/api/v1/payment-orders/${id}/payments`,
        as.cashier,
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Owner' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
}

/** A request filed and submitted, to where the officer has approved the documents. */
async function reviewed(over: Partial<RegistrationInput> = {}): Promise<CaseOut> {
    let c = await filed(request(over));
    c = await moved(c, as.officer, 'submit');
    return moved(c, as.officer, 'approve');
}

/** … paid, and approved by the lead: it waits for the officer to register it, a plate held for it. */
async function approved(over: Partial<RegistrationInput> = {}): Promise<CaseOut> {
    let c = await reviewed(over);
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('registration');
    return c;
}

const federalId = () => `FV-${randomInt(100000, 999999)}`;

const platesOf = async (caseId: string) =>
    (
        await api.owner.query<{ plate_key: string; status: string; vehicle_id: string | null }>(
            'select plate_key, status, vehicle_id from vehicles.plates where case_id = $1',
            [caseId]
        )
    ).rows;

const vehiclesOf = async (chassis: string) =>
    (
        await api.owner.query<{
            id: string;
            status: string;
            federal_vehicle_id: string | null;
            federal_id_source: string | null;
        }>('select id, status, federal_vehicle_id, federal_id_source from vehicles.vehicles where vin_key = $1', [
            chassis
        ])
    ).rows;

const place = (caseId: string) => {
    const ctx: DbContext = { ...contextFor(boditi), requestId: `reg-${randomUUID()}` };
    return { caseId, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx };
};
const inTx = <T>(p: ReturnType<typeof place>, work: (tx: Tx) => Promise<T>) => app.scoped(p.ctx, work);

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

async function count(sql: string, params: unknown[] = []): Promise<number> {
    return (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
}

async function freeAtBoditi(): Promise<number> {
    return count(`select count(*)::int as n from vehicles.plates where holder_unit_id = $1 and status = 'in_stock'`, [
        boditi.id
    ]);
}

/** Boditi's libre booklets still in stock, in serial order. */
async function bookletsAtBoditi(): Promise<string[]> {
    const { rows } = await api.owner.query<{ item_key: string }>(
        `select item_key from fees.stationery_items
          where holder_unit_id = $1 and kind = 'libre_booklet' and status = 'in_stock' order by series, serial`,
        [boditi.id]
    );
    return rows.map((r) => r.item_key);
}

const bookletOf = async (key: string) =>
    (
        await api.owner.query<{
            status: string;
            used_for_table: string | null;
            used_for_id: string | null;
            case_id: string | null;
        }>('select status, used_for_table, used_for_id, case_id from fees.stationery_items where item_key = $1', [key])
    ).rows[0];

/** The registration certificates of a case: the one in force last. */
const certificatesOf = async (caseId: string) =>
    (
        await api.owner.query<{
            id: string;
            number: string;
            subject_id: string;
            superseded_by: string | null;
            data: { plate: string; bookletSerial: string | null; owners: { name: string; address: string | null }[] };
        }>(
            `select d.id, d.number, d.subject_id, d.superseded_by, d.data from documents.issued_documents d
               join documents.document_templates t on t.id = d.template_id
              where t.key = 'vehicle-registration-certificate' and d.case_id = $1
              order by d.superseded_by is null, d.created_at`,
            [caseId]
        )
    ).rows;

/** A case approved and registered: the vehicle is on the register and the case waits for its booklet. */
async function registeredAwaitingBooklet(over: Partial<RegistrationInput> = {}): Promise<CaseOut> {
    const c = await moved(await approved(over), as.officer, 'register', { answers: { federalVehicleId: federalId() } });
    expect(c.state).toBe('booklet');
    return c;
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.reg.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.reg.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    stock = api.http.get(PlateStock);
    stationery = api.http.get(StationeryStock);
    registration = api.http.get(VehicleRegistrationService);
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.cashier = { sub: SUB.cashier, unit: boditi };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        expect(await importVehicleServices(tx, root)).toBe(1);
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
    // Boditi holds libre booklets handed down from the zone (the demo's stationery)
    expect(await importStationeryDemo(api.installer, 'SER', stationery, today())).not.toBeNull();
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
                importVehicleServices(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
    });

    it('passes the checks a bureau’s own form, workflow and service version would meet', async () => {
        const { rows } = await api.owner.query<{ form: string; flow: string; fee: string }>(
            `select v.form_version_id as form, v.workflow_version_id as flow, v.fee_rule_version_id as fee
               from services.service_definitions d join services.service_versions v on v.id = d.current_version_id
              where d.code = 'DVC-01'`
        );
        expect(rows).toHaveLength(1);
        const published = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
            workflowVersionId: rows[0]?.flow,
            formVersionId: rows[0]?.form,
            feeRuleVersionId: rows[0]?.fee,
            defaults: { approval_unit: 'handling' },
            overridePolicy: { approval_unit: ['region', 'unit'], sla: ['region', 'unit'] }
        });
        expect(published.statusCode, published.body).toBe(201);
        const flow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'checked-vehicle-registration',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: vehicleRegistrationFlow('vehicle-national-entry@1', 'vehicle-libre-booklet@1')
        });
        expect(flow.statusCode, flow.body).toBe(201);
    });
});

describe('a new vehicle registration', () => {
    it('runs from the counter to a vehicle with its owner, its plate from the stock, its libre and its booklet', async () => {
        const answers = request({
            madeIn: 'Japan',
            engineHp: 86,
            lengthM: 3.945,
            widthM: 1.695,
            heightM: 1.5,
            tyres: 4
        });
        // the demo's placeholder amounts: automobile 1000 Birr + plate 500 + libre 200
        const shown = await preview(answers, as.officer);
        expect(shown.totalSantim).toBe('170000');

        let c = await filed(answers);
        c = await moved(c, as.officer, 'submit');
        expect(c.state).toBe('review');
        expect((await factsOf(c.id)).registration).toMatchObject({ vinCheck: 'ok' });
        c = await moved(c, as.officer, 'approve');
        expect(c.state).toBe('payment');
        await paid(c);
        c = await caseOf(c.id);
        expect(c.state).toBe('approval');

        // the people who filed and checked it may not approve it
        expect((await step(c, as.officer, { action: 'approve' })).statusCode).toBe(403);
        const before = await freeAtBoditi();
        const approval = await step(c, as.lead, { action: 'approve' });
        expect(approval.statusCode, approval.body).toBe(200);
        c = approval.json<CaseOut>();
        expect(c.state).toBe('registration');
        // the plate is held in the approval's own transaction, with its audit row
        expect(await auditOf(requestIdOf(approval))).toMatchObject({ 'vehicles.plates:update': 1 });

        // a plate is held for the case from now on, and no vehicle exists yet
        const held = await platesOf(c.id);
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({ status: 'reserved', vehicle_id: null });
        expect(await freeAtBoditi()).toBe(before - 1);
        expect(await vehiclesOf(String(answers.chassisNumber))).toHaveLength(0);
        // the approver may not register it
        expect(
            (await step(c, as.lead, { action: 'register', answers: { federalVehicleId: federalId() } })).statusCode
        ).toBe(403);

        const id = federalId();
        const registering = await step(c, as.officer, { action: 'register', answers: { federalVehicleId: id } });
        expect(registering.statusCode, registering.body).toBe(200);
        c = registering.json<CaseOut>();
        // registered, and waiting for its booklet (ADR-0050)
        expect(c.state).toBe('booklet');
        // every record the step made is audited in the step's own transaction
        expect(await auditOf(requestIdOf(registering))).toMatchObject({
            'vehicles.vehicles:insert': 1,
            'vehicles.vehicle_ownerships:insert': 1,
            'vehicles.plate_assignments:insert': 1,
            'vehicles.plates:update': 1,
            'vehicles.libres:insert': 1,
            'documents.issued_documents:insert': 1
        });

        const [vehicle] = await vehiclesOf(String(answers.chassisNumber));
        expect(vehicle).toMatchObject({ status: 'active', federal_vehicle_id: id, federal_id_source: 'manual' });
        const owners = await api.owner.query<{ acquired_by: string }>(
            'select acquired_by from vehicles.vehicle_ownerships where case_id = $1',
            [c.id]
        );
        expect(owners.rows).toEqual([{ acquired_by: 'first_registration' }]);
        // the plate that was held is the plate the vehicle carries, from the stock
        const [plate] = await platesOf(c.id);
        expect(plate).toMatchObject({ plate_key: held[0]?.plate_key, status: 'assigned', vehicle_id: vehicle?.id });
        const carried = await api.owner.query<{ plate_key: string }>(
            'select plate_key from vehicles.plate_assignments where vehicle_id = $1 and until is null',
            [vehicle?.id]
        );
        expect(carried.rows).toEqual([{ plate_key: held[0]?.plate_key }]);

        // the vehicle's other facts, the size in millimetres
        const details = await api.owner.query<{
            made_in: string;
            engine_hp: number;
            length_mm: number;
            width_mm: number;
        }>('select made_in, engine_hp, length_mm, width_mm from vehicles.vehicles where id = $1', [vehicle?.id]);
        expect(details.rows[0]).toEqual({ made_in: 'Japan', engine_hp: 86, length_mm: 3945, width_mm: 1695 });

        // the libre, with no number of ours (ADR-0050), and the temporary libre: numbered from the office's counter
        const libres = await api.owner.query<{ id: string; number: string | null }>(
            'select id, number from vehicles.libres where case_id = $1',
            [c.id]
        );
        expect(libres.rows).toHaveLength(1);
        const libreId = libres.rows[0]?.id ?? '';
        expect(libres.rows[0]?.number).toBeNull();
        const [temporary, ...others] = await certificatesOf(c.id);
        expect(others).toHaveLength(0);
        expect(temporary?.number).toMatch(/\/RC\/\d{6}$/);
        expect(temporary?.subject_id).toBe(libreId);
        expect(temporary?.data.plate).toBe(nationalPlateText(held[0]?.plate_key ?? ''));
        expect(temporary?.data.bookletSerial).toBeNull();
        expect(temporary?.data.owners).toHaveLength(1);
        const listed = await api.call('GET', `/api/v1/issued-documents?caseId=${c.id}`, as.officer);
        expect(listed.json<{ items: { templateKey: string }[] }>().items.map((d) => d.templateKey)).toContain(
            'vehicle-registration-certificate'
        );

        // the booklet: the office's next one, taken from its stock once, in the step's own transaction
        const [next] = await bookletsAtBoditi();
        expect(next).toMatch(/^LB\d{7}$/);
        const issuing = await step(c, as.officer, { action: 'issue_booklet', answers: {} });
        expect(issuing.statusCode, issuing.body).toBe(200);
        c = issuing.json<CaseOut>();
        expect(c.state).toBe('registered');
        expect(await auditOf(requestIdOf(issuing))).toMatchObject({
            'fees.stationery_items:update': 1,
            'fees.stationery_movements:insert': 1,
            'vehicles.libres:update': 1,
            'documents.issued_documents:insert': 1
        });
        expect(await bookletOf(next ?? '')).toEqual({
            status: 'used',
            used_for_table: 'vehicles.libres',
            used_for_id: libreId,
            case_id: c.id
        });
        expect(
            (await api.owner.query<{ number: string }>('select number from vehicles.libres where id = $1', [libreId]))
                .rows[0]?.number
        ).toBe(next);
        // the certificate names the booklet now; the temporary one says superseded, the number kept
        const [old, current] = await certificatesOf(c.id);
        expect(old?.superseded_by).toBe(current?.id);
        expect(current).toMatchObject({ number: temporary?.number, superseded_by: null });
        expect(current?.data.bookletSerial).toBe(next);

        // each step run again for the same case makes nothing new
        const facts = await factsOf(c.id);
        const p = place(c.id);
        await inTx(p, async (tx) => {
            expect(await registration.register(tx, p, facts, answers)).toEqual({ vehicle: { id: vehicle?.id } });
            expect((await registration.assignPlate(tx, p, facts, {})).plate.key).toBe(held[0]?.plate_key);
            expect((await registration.issueLibre(tx, p, facts, undefined)).libre).toEqual({
                id: libreId,
                number: next,
                template: 'vehicle-registration-certificate'
            });
            expect((await registration.issueBooklet(tx, p, facts, {})).libre.booklet).toBe(next);
        });
        expect(await certificatesOf(c.id)).toHaveLength(2);
        expect(
            await count('select count(*)::int as n from fees.stationery_items where used_for_id = $1', [libreId])
        ).toBe(1);
        expect(
            await count('select count(*)::int as n from vehicles.vehicle_ownerships where case_id = $1', [c.id])
        ).toBe(1);
        expect(await count('select count(*)::int as n from vehicles.libres where case_id = $1', [c.id])).toBe(1);
        expect(
            await count('select count(*)::int as n from vehicles.plate_assignments where vehicle_id = $1', [
                vehicle?.id
            ])
        ).toBe(1);

        // the register finds it by its plate
        const found = await api.call('GET', `/api/v1/vehicles?q=${held[0]?.plate_key}`, as.officer);
        expect(found.json<{ items: { id: string }[] }>().items.map((v) => v.id)).toContain(vehicle?.id);
    }, 240_000);

    it('holds one plate for a case however often it is asked, and gives it back when the case is rejected', async () => {
        let c = await approved();
        const [first] = await platesOf(c.id);
        const p = place(c.id);
        const again = await inTx(p, (tx) => registration.reservePlate(tx, p));
        expect(again.plate.key).toBe(first?.plate_key);
        expect(await platesOf(c.id)).toHaveLength(1);

        const free = await freeAtBoditi();
        c = await moved(c, as.officer, 'reject', { comment: 'The customs declaration is forged' });
        expect(c.state).toBe('rejected');
        expect(await platesOf(c.id)).toHaveLength(0);
        expect(await freeAtBoditi()).toBe(free + 1);
        // and it is the next plate handed out again
        const next = await approved();
        expect((await platesOf(next.id))[0]?.plate_key).toBe(first?.plate_key);
    }, 240_000);

    it('puts on the vehicle the plate the officer names when it is not the reserved one, and frees the reserved one', async () => {
        const c = await approved();
        const [reserved] = await platesOf(c.id);
        const { rows } = await api.owner.query<{ plate_key: string }>(
            `select plate_key from vehicles.plates where holder_unit_id = $1 and status = 'in_stock'
              order by series, serial limit 1`,
            [boditi.id]
        );
        const other = rows[0]?.plate_key ?? '';
        expect(other).not.toBe(reserved?.plate_key);
        const done = await moved(c, as.officer, 'register', {
            answers: { federalVehicleId: federalId(), replacementPlate: nationalPlateText(other) }
        });
        expect(done.state).toBe('booklet');
        expect(await platesOf(c.id)).toEqual([expect.objectContaining({ plate_key: other, status: 'assigned' })]);
        const back = await api.owner.query<{ status: string; case_id: string | null }>(
            'select status, case_id from vehicles.plates where plate_key = $1',
            [reserved?.plate_key]
        );
        expect(back.rows).toEqual([{ status: 'in_stock', case_id: null }]);
    }, 240_000);

    it('undoes the whole step when the federal id is on another vehicle, and the plate stays held', async () => {
        const first = await approved();
        const id = federalId();
        await moved(first, as.officer, 'register', { answers: { federalVehicleId: id } });

        const second = await approved();
        const refused = await step(second, as.officer, { action: 'register', answers: { federalVehicleId: id } });
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json<{ code: string }>().code).toBe('duplicate_reference');
        // the undone step leaves no audit row of the register behind
        expect(Object.keys(await auditOf(requestIdOf(refused))).filter((line) => line.startsWith('vehicles.'))).toEqual(
            []
        );
        const now = await caseOf(second.id);
        expect(now.state).toBe('registration');
        expect(await platesOf(second.id)).toEqual([expect.objectContaining({ status: 'reserved', vehicle_id: null })]);
        expect(
            await count('select count(*)::int as n from vehicles.vehicle_ownerships where case_id = $1', [second.id])
        ).toBe(0);
        expect(await count('select count(*)::int as n from vehicles.libres where case_id = $1', [second.id])).toBe(0);
        // with its own id it goes through
        expect((await moved(now, as.officer, 'register', { answers: { federalVehicleId: federalId() } })).state).toBe(
            'booklet'
        );
    }, 240_000);

    it('is refused at approval when the office has no plate left, and nothing is written', async () => {
        const c = await reviewed();
        await paid(c);
        const waiting = await caseOf(c.id);
        expect(waiting.state).toBe('approval');

        // the office's free plates are held for other cases for a moment
        const fake: string[] = [];
        const held: DbContext = { ...contextFor(boditi), requestId: `drain-${randomUUID()}` };
        const free = await freeAtBoditi();
        await app.scoped(held, async (tx) => {
            for (let i = 0; i < free; i += 1) {
                const caseId = randomUUID();
                fake.push(caseId);
                await stock.reserve(tx, held, { holderUnitId: boditi.id, caseId, on: today() });
            }
        });
        try {
            const refused = await step(waiting, as.lead, { action: 'approve' });
            expect(refused.statusCode, refused.body).toBe(409);
            expect((await caseOf(c.id)).state).toBe('approval');
            expect(await platesOf(c.id)).toHaveLength(0);
        } finally {
            const give: DbContext = { ...contextFor(boditi), requestId: `undrain-${randomUUID()}` };
            await app.scoped(give, async (tx) => {
                for (const caseId of fake) await stock.release(tx, give, { caseId, on: today() });
            });
        }
        expect(await freeAtBoditi()).toBe(free);
        expect((await moved(await caseOf(c.id), as.lead, 'approve')).state).toBe('registration');
    }, 240_000);
});

describe('the libre booklet (ADR-0050)', () => {
    it('records the booklets spoiled on the way and takes the next one; a spoiled booklet is never issued', async () => {
        const c = await registeredAwaitingBooklet();
        const [spoiled, next] = await bookletsAtBoditi();
        // the booklet written in cannot be one listed as spoiled
        const both = await step(c, as.officer, {
            action: 'issue_booklet',
            answers: { bookletSerial: spoiled, spoiledBooklets: [{ spoiledSerial: spoiled, spoiledReason: 'torn' }] }
        });
        expect(both.statusCode, both.body).toBe(422);
        // the same booklet however it is typed, a serial that is not one, and a reason too short: each at its field
        const typed = await step(c, as.officer, {
            action: 'issue_booklet',
            answers: {
                bookletSerial: `${spoiled?.slice(0, 2)} ${Number(spoiled?.slice(2))}`,
                spoiledBooklets: [{ spoiledSerial: spoiled, spoiledReason: 'torn' }]
            }
        });
        expect(typed.statusCode, typed.body).toBe(422);
        expect(typed.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual(['bookletSerial']);
        const unreadable = await step(c, as.officer, {
            action: 'issue_booklet',
            answers: { bookletSerial: '12-34-x' }
        });
        expect(unreadable.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual(['bookletSerial']);
        const short = await step(c, as.officer, {
            action: 'issue_booklet',
            answers: { spoiledBooklets: [{ spoiledSerial: spoiled, spoiledReason: 'ok' }] }
        });
        expect(short.statusCode, short.body).toBe(422);
        const done = await moved(c, as.officer, 'issue_booklet', {
            answers: { spoiledBooklets: [{ spoiledSerial: spoiled, spoiledReason: 'misprinted at the counter' }] }
        });
        expect(done.state).toBe('registered');
        expect(await bookletOf(spoiled ?? '')).toMatchObject({ status: 'spoiled', used_for_id: null, case_id: c.id });
        expect((await bookletOf(next ?? ''))?.status).toBe('used');
        const reason = await api.owner.query<{ end_reason: string; note: string }>(
            'select end_reason, note from fees.stationery_items where item_key = $1',
            [spoiled]
        );
        expect(reason.rows[0]).toEqual({ end_reason: 'misprinted', note: 'misprinted at the counter' });

        // another registration naming the spoiled booklet is refused, and nothing is written
        const other = await registeredAwaitingBooklet();
        const refused = await step(other, as.officer, { action: 'issue_booklet', answers: { bookletSerial: spoiled } });
        expect(refused.statusCode, refused.body).toBe(409);
        expect((await caseOf(other.id)).state).toBe('booklet');
        expect(
            await count('select count(*)::int as n from vehicles.libres where case_id = $1 and number is not null', [
                other.id
            ])
        ).toBe(0);
        // the booklet the officer names, written as the stock prints it
        const [named] = await bookletsAtBoditi();
        const written = await moved(other, as.officer, 'issue_booklet', {
            answers: { bookletSerial: (named ?? '').replace(/^LB/, 'lb '), libreNationalReference: 'NAT-0001' }
        });
        expect(written.state).toBe('registered');
        const libre = await api.owner.query<{ number: string; national_reference: string }>(
            'select number, national_reference from vehicles.libres where case_id = $1',
            [other.id]
        );
        expect(libre.rows[0]).toEqual({ number: named, national_reference: 'NAT-0001' });
    }, 240_000);

    it('waits for the booklets when the office has none, and issues one on the same case when they come', async () => {
        const c = await registeredAwaitingBooklet();
        const p = place(c.id);
        // the office's booklets run out: the rest are spoiled (a damaged box)
        await inTx(p, async (tx) => {
            for (const key of await bookletsAtBoditi())
                await stationery.spoil(tx, p.ctx, { kind: 'libre_booklet', key, reason: 'water-damaged box' });
        });
        expect(await bookletsAtBoditi()).toEqual([]);
        const none = await step(c, as.officer, { action: 'issue_booklet', answers: {} });
        expect(none.statusCode, none.body).toBe(409);
        expect((await caseOf(c.id)).state).toBe('booklet');
        // the vehicle is registered meanwhile, and its temporary libre stands
        const [temporary] = await certificatesOf(c.id);
        expect(temporary?.data.bookletSerial).toBeNull();

        // the ministry's booklets arrive
        await inTx(p, (tx) =>
            stationery.receive(tx, p.ctx, {
                kind: 'libre_booklet',
                source: 'ministry',
                reference: `LATE-${randomInt(1000, 9999)}`,
                receivedOn: today(),
                range: { series: 'LB', from: 9001, to: 9002 },
                width: 7
            })
        );
        const done = await moved(await caseOf(c.id), as.officer, 'issue_booklet', { answers: {} });
        expect(done.state).toBe('registered');
        const libre = await api.owner.query<{ number: string }>(
            'select number from vehicles.libres where case_id = $1',
            [c.id]
        );
        expect(libre.rows[0]?.number).toBe('LB0009001');
        const [old, current] = await certificatesOf(c.id);
        expect(old?.superseded_by).toBe(current?.id);
        expect(current?.data.bookletSerial).toBe('LB0009001');

        // the office's stock still reconciles with its ledger, and each registration with a booklet used exactly one
        const summary = await inTx(p, (tx) => stationery.summary(tx, p.ctx, 'libre_booklet'));
        expect(summary.unit.reconciled, JSON.stringify(summary.unit)).toBe(true);
        const { inStock, used } = summary.unit;
        expect(used).toBe(
            await count(
                `select count(*)::int as n from vehicles.libres l join workflow.cases c on c.id = l.case_id
                  where l.number is not null and l.handling_unit_id = $1`,
                [boditi.id]
            )
        );
        expect(inStock).toBe(1);
    }, 240_000);
});

describe('a request that does not meet the register', () => {
    const refusal = async (over: Partial<RegistrationInput>, who: As = as.officer) => {
        const c = await filed(request(over), who);
        const res = await step(c, who, { action: 'submit' });
        return { res, c };
    };

    it('is refused for a chassis already on the register, and for one in another open request', async () => {
        const done = request();
        let c = await filed(done);
        c = await moved(c, as.officer, 'submit');
        // another open request for the same chassis
        const open = await refusal({ chassisNumber: done.chassisNumber });
        expect(open.res.statusCode, open.res.body).toBe(422);
        expect(open.res.json<{ code: string }>().code).toBe('not_eligible');
        // registered: the register has it
        c = await moved(c, as.officer, 'approve');
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        await moved(c, as.officer, 'register', { answers: { federalVehicleId: federalId() } });
        const onRegister = await refusal({ chassisNumber: done.chassisNumber });
        expect(onRegister.res.statusCode, onRegister.res.body).toBe(409);
        expect(onRegister.res.json<{ code: string }>().code).toBe('duplicate_reference');
        // and a withdrawn one frees its chassis
        const closed = await moved(await caseOf(open.c.id), as.officer, 'withdraw', { comment: 'Filed twice' });
        expect(closed.state).toBe('rejected');
    }, 240_000);

    it('is refused when the category needs seats and none are given, at the field', async () => {
        const { res } = await refusal({ seats: undefined });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toContain('seats');
    });

    it('is refused when an owner row names both a person and an organisation, or neither', async () => {
        const org = await api.call('POST', '/api/v1/organisations', as.officer, {
            kind: 'other',
            name: { am: 'ናሙና ድርጅት', en: `Sample Owner Company ${randomInt(1000, 9999)}` }
        });
        expect(org.statusCode, org.body).toBe(201);
        const organisation = org.json<{ id: string }>().id;
        const both = await refusal({ owners: [{ ownerPerson: owner, ownerOrganisation: organisation }] });
        expect(both.res.statusCode, both.res.body).toBe(422);
        expect(both.res.body).toContain('owners.0');
        // a second row with neither is refused at its own place
        const neither = await refusal({ owners: [{ ownerOrganisation: organisation }, {}] });
        expect(neither.res.statusCode, neither.res.body).toBe(422);
        expect(neither.res.body).toContain('owners.1');
        // an organisation alone owns a vehicle
        const alone = await filed(request({ owners: [{ ownerOrganisation: organisation }] }));
        expect((await moved(alone, as.officer, 'submit')).state).toBe('review');
    }, 120_000);

    it('is refused for a binding check digit that does not match, unless the officer confirms it, and then it is a mismatch', async () => {
        const good = vin();
        const bad = `${good.slice(0, 8)}${good[8] === '0' ? '1' : '0'}${good.slice(9)}`;
        const refused = await refusal({ chassisNumber: bad });
        expect(refused.res.statusCode, refused.res.body).toBe(422);
        expect(refused.res.body).toContain('chassisNumber');
        const confirmed = await filed(request({ chassisNumber: bad, chassisMismatchConfirmed: true }));
        const c = await moved(confirmed, as.officer, 'submit');
        expect(c.state).toBe('review');
        expect((await factsOf(c.id)).registration).toMatchObject({ vinCheck: 'mismatch' });
    }, 120_000);
});
