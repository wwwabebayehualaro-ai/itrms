/**
 * The plate exchange as it is seeded (task 1.2c, DVC-12, Directive 1050/2025), run end to end through the API on a real PostgreSQL 16
 * with the Wolaita seeds: a Boditi vehicle on an old regional plate is filed at the counter, checked, paid at the till, approved (a
 * national plate of Boditi's stock is held from then on) and the officer hands the plate over with the federal id the national
 * system gave. The old plate is retired and points at the one that replaced it. The refusals at filing, a rejection giving the held
 * plate back, and the step run twice giving one plate. Chassis numbers, plates and names are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlateExchangeService } from '@itrms/competency/api';
import { importPlateExchangeService, importVehicleServices, plateExchangeFlow } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { PlateStock, VehicleRegistry } from '@itrms/vehicles/api';
import { vinCheckDigit, type Vehicle } from '@itrms/vehicles/contracts';
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
    officer: '0199f0a0-d000-7000-8000-00000000c702',
    lead: '0199f0a0-d000-7000-8000-00000000c704',
    cashier: '0199f0a0-d000-7000-8000-000000000303'
};
const SERVICE = 'DVC-12';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let boditi: OrgUnit;
let damot: OrgUnit;
let owner: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

let serial = 0;
function vin(): string {
    serial += 1;
    const base = `1HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}

/** A vehicle of `unit` on an old regional plate (or `plate`), registered straight in the register as a seed would. */
async function onTheRoad(unit: OrgUnit, plate = `SN 2-${String(randomInt(10000, 99999))}`, use = 'private') {
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    return app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: vin(),
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2010,
            categoryKey: 'automobile',
            use: use as 'private',
            seats: 5,
            firstRegisteredOn: '2011-03-01',
            owners: [{ kind: 'person', id: owner }]
        });
        const special = /^(መከላከያ|ልዩ|ፖሊስ|CD|UN|AU)/u.test(plate);
        await registry.recordPlate(tx, ctx, vehicle.id, {
            text: plate,
            source: special ? 'manual' : 'legacy',
            since: '2011-03-01'
        });
        return { id: vehicle.id, plate };
    });
}

const preview = async (answers: object) => {
    const res = await api.call('POST', '/api/v1/fees/preview', as.officer, { serviceCode: SERVICE, answers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ feeRuleVersionId: string; totalSantim: string }>();
};

async function filed(answers: Record<string, unknown>): Promise<CaseOut> {
    const shown = await preview(answers);
    const started = await api.call('POST', '/api/v1/service-requests', as.officer, {
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

const caseOf = async (id: string) => (await api.call('GET', `/api/v1/cases/${id}`, as.officer)).json<CaseOut>();

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

/** Filed, checked, paid and approved by the lead: a plate is held, the officer hands it over next. */
async function approved(vehicleId: string, use = 'private'): Promise<CaseOut> {
    let c = await filed({ vehicle: vehicleId, use });
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('exchange');
    return c;
}

const heldFor = async (caseId: string) =>
    (
        await api.owner.query<{ plate_key: string; status: string; vehicle_id: string | null }>(
            'select plate_key, status, vehicle_id from vehicles.plates where case_id = $1',
            [caseId]
        )
    ).rows;

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

const refusedAt = async (answers: Record<string, unknown>) => {
    const c = await filed(answers);
    const res = await step(c, as.officer, { action: 'submit' });
    return { status: res.statusCode, body: res.json<{ code?: string; errors?: { path: string; code: string }[] }>() };
};

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.plx.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.plx.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
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
        await importVehicleServices(tx, root);
        expect(await importPlateExchangeService(tx, root)).toBe(1);
    });
    expect(await importPlateStockDemo(api.installer, 'SER', api.http.get(PlateStock), today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ሰሌዳ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Plate', grandfather: 'Person' },
        sex: 'male',
        birthYear: 1980,
        acknowledgedDuplicates: []
    });
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
}, 240_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('what is seeded', () => {
    it('stays as it is when seeded again, and passes the checks a bureau’s own versions would meet', async () => {
        const region = await api.unit('SER', 'SER');
        expect(
            await api.installer.scoped({}, (tx) =>
                importPlateExchangeService(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
        const { rows } = await api.owner.query<{ form: string; flow: string; fee: string }>(
            `select v.form_version_id as form, v.workflow_version_id as flow, v.fee_rule_version_id as fee
               from services.service_definitions d join services.service_versions v on v.id = d.current_version_id
              where d.code = 'DVC-12'`
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
            key: 'checked-plate-exchange',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: plateExchangeFlow('vehicle-plate-handover@1')
        });
        expect(flow.statusCode, flow.body).toBe(201);
    });

    it('charges the plate fee of the vehicle’s use (the zone’s fee sheet, demo amounts)', async () => {
        const { id } = await onTheRoad(boditi);
        expect((await preview({ vehicle: id, use: 'private' })).totalSantim).toBe('516100');
        expect((await preview({ vehicle: id, use: 'commercial' })).totalSantim).toBe('607000');
    });
});

describe('an old plate exchanged for a national one (Directive 1050/2025)', () => {
    it('retires the old plate, links it to the national plate from the stock, and records the federal id', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await approved(vehicle.id);
        const [held] = await heldFor(c.id);
        expect(held).toMatchObject({ status: 'reserved', vehicle_id: null });

        const federalVehicleId = `FV-${randomInt(100000, 999999)}`;
        const exchanging = await step(c, as.officer, { action: 'exchange', answers: { federalVehicleId } });
        expect(exchanging.statusCode, exchanging.body).toBe(200);
        expect(exchanging.json<CaseOut>().state).toBe('exchanged');
        expect(await heldFor(c.id)).toEqual([
            { plate_key: held?.plate_key, status: 'assigned', vehicle_id: vehicle.id }
        ]);
        expect(await auditOf(requestIdOf(exchanging))).toMatchObject({
            'vehicles.plates:update': 1,
            'vehicles.plate_assignments:update': 1,
            'vehicles.plate_assignments:insert': 1
        });

        const record = (await api.call('GET', `/api/v1/vehicles/${vehicle.id}`, as.officer)).json<Vehicle>();
        expect(record.federalVehicleId).toBe(federalVehicleId);
        const national = record.plates.find((p) => p.until === null);
        const old = record.plates.find((p) => p.format === 'legacy');
        expect(national).toMatchObject({ key: held?.plate_key, format: 'national', source: 'federal', since: today() });
        expect(old).toMatchObject({ until: today(), endedReason: 'exchanged', replacedById: national?.id });
        // the old plate still finds the vehicle, as its history
        const found = await api.call('GET', `/api/v1/vehicles?q=${encodeURIComponent(vehicle.plate)}`, as.officer);
        expect(found.json<{ items: { id: string; matched: string }[] }>().items[0]).toMatchObject({
            id: vehicle.id,
            matched: 'old_plate'
        });
    });

    it('hands over the same plate when its step runs twice', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await moved(await approved(vehicle.id), as.officer, 'exchange', { answers: {} });
        const ctx: DbContext = { ...contextFor(boditi), requestId: `plx-${randomUUID()}` };
        const facts = (
            await api.owner.query<{ facts: Record<string, unknown> }>(
                'select facts from workflow.cases where id = $1',
                [c.id]
            )
        ).rows[0]?.facts;
        const again = await app.scoped(ctx, (tx) =>
            api.http
                .get(PlateExchangeService)
                .exchange(
                    tx,
                    { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                    facts ?? {},
                    {}
                )
        );
        const [held] = await heldFor(c.id);
        expect(again).toMatchObject({ plate: { key: held?.plate_key } });
        const { rows } = await api.owner.query<{ n: number }>(
            'select count(*)::int as n from vehicles.plate_assignments where vehicle_id = $1',
            [vehicle.id]
        );
        expect(rows[0]?.n).toBe(2);
    });

    it('does not exchange a plate that changed since the request was checked', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await approved(vehicle.id);
        // meanwhile the register records another old plate on the vehicle
        const ctx: DbContext = { ...contextFor(boditi), requestId: `plx-${randomUUID()}` };
        await app.scoped(ctx, (tx) =>
            registry.recordPlate(tx, ctx, vehicle.id, {
                text: `SN 2-${String(randomInt(10000, 99999))}`,
                source: 'legacy',
                since: today()
            })
        );
        const refused = await step(c, as.officer, { action: 'exchange', answers: {} });
        expect(refused.statusCode, refused.body).toBe(409);
        expect((await heldFor(c.id))[0]?.status).toBe('reserved');
    });

    it('gives the held plate back to the stock when it is rejected', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await approved(vehicle.id);
        const [held] = await heldFor(c.id);
        // the officer at the exchange step (the lead approved, so separation of duties keeps them off it)
        await moved(c, as.officer, 'reject', { comment: 'The owner did not bring the old plates.' });
        const { rows } = await api.owner.query<{ status: string; case_id: string | null }>(
            'select status, case_id from vehicles.plates where plate_key = $1',
            [held?.plate_key]
        );
        expect(rows[0]).toEqual({ status: 'in_stock', case_id: null });
    });
});

describe('the old plates the register keeps (task 1.2c)', () => {
    it('keeps a local-NGO plate of code 35 and a defence plate, and exchanges only the old regional one', async () => {
        const ngo = await onTheRoad(boditi, `SN 35-${String(randomInt(1000, 9999))}`);
        const record = (await api.call('GET', `/api/v1/vehicles/${ngo.id}`, as.officer)).json<Vehicle>();
        expect(record.plates[0]).toMatchObject({ format: 'legacy', legacyUseCode: 35, legacyRegionCode: 'SN' });

        const defence = await onTheRoad(boditi, `መከላከያ ${String(randomInt(1000, 9999))}`);
        const kept = (await api.call('GET', `/api/v1/vehicles/${defence.id}`, as.officer)).json<Vehicle>();
        expect(kept.plates[0]?.format).toBe('special');
        expect(kept.plates[0]?.key).toMatch(/^DEFENCE\d{4}$/);
        const refused = await refusedAt({ vehicle: defence.id, use: 'private' });
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'no_old_plate' })]);
    });

    it('refuses a federal id another vehicle has, keeping the plate held for the case', async () => {
        const first = await onTheRoad(boditi);
        const federalVehicleId = `FV-${randomInt(100000, 999999)}`;
        await moved(await approved(first.id), as.officer, 'exchange', { answers: { federalVehicleId } });
        const second = await onTheRoad(boditi);
        const c = await approved(second.id);
        const taken = await step(c, as.officer, { action: 'exchange', answers: { federalVehicleId } });
        expect(taken.statusCode, taken.body).toBe(409);
        expect((await heldFor(c.id))[0]?.status).toBe('reserved');
    });
});

describe('the refusals at filing', () => {
    it('refuses a vehicle already on a national plate, another office’s vehicle, and a use that is not the vehicle’s', async () => {
        const national = await onTheRoad(boditi, `ETH ZQX ${String(randomInt(1000, 9999))}`);
        const onNational = await refusedAt({ vehicle: national.id, use: 'private' });
        expect(onNational.status).toBe(422);
        expect(onNational.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'no_old_plate' })]);

        const elsewhere = await onTheRoad(damot);
        const other = await refusedAt({ vehicle: elsewhere.id, use: 'private' });
        expect(other.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'other_office' })]);

        const mine = await onTheRoad(boditi);
        const use = await refusedAt({ vehicle: mine.id, use: 'commercial' });
        expect(use.body.errors).toEqual([expect.objectContaining({ path: 'use', code: 'mismatch' })]);
    });

    it('refuses a second open request for the same vehicle', async () => {
        const vehicle = await onTheRoad(boditi);
        await moved(await filed({ vehicle: vehicle.id, use: 'private' }), as.officer, 'submit');
        const twice = await refusedAt({ vehicle: vehicle.id, use: 'private' });
        expect(twice.status).toBe(422);
        expect(twice.body.code).toBe('not_eligible');
    });
});
