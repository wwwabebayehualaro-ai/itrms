/**
 * The new vehicle registration service as it is seeded (task 1.2b, DVC-01), run end to end through the API on a real PostgreSQL 16
 * with the Wolaita seeds: filed at Boditi's counter, checked, paid at the till, approved, and registered with a federal id, which
 * makes the vehicle, its first ownership, its plate from the office's stock and its libre with a numbered document. The refusals
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
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { PlateStock } from '@itrms/vehicles/api';
import { nationalPlateText, vinCheckDigit } from '@itrms/vehicles/contracts';
import { importPlateStockDemo, importVehicleCategories, setUpLibreCounters } from '@itrms/vehicles/seed';
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

async function count(sql: string, params: unknown[] = []): Promise<number> {
    return (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
}

async function freeAtBoditi(): Promise<number> {
    return count(`select count(*)::int as n from vehicles.plates where holder_unit_id = $1 and status = 'in_stock'`, [
        boditi.id
    ]);
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
        await setUpLibreCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        expect(await importVehicleServices(tx, root)).toBe(1);
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
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
            definition: vehicleRegistrationFlow('vehicle-national-entry@1')
        });
        expect(flow.statusCode, flow.body).toBe(201);
    });
});

describe('a new vehicle registration', () => {
    it('runs from the counter to a vehicle with its owner, its plate from the stock and its libre', async () => {
        const answers = request();
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
        c = await moved(c, as.lead, 'approve');
        expect(c.state).toBe('registration');

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
        c = await moved(c, as.officer, 'register', { answers: { federalVehicleId: id } });
        expect(c.state).toBe('registered');

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

        // the libre, numbered from the office's counter, and its document
        const libres = await api.owner.query<{ id: string; number: string }>(
            'select id, number from vehicles.libres where case_id = $1',
            [c.id]
        );
        expect(libres.rows).toHaveLength(1);
        expect(libres.rows[0]?.number).toMatch(/\/LB\/\d{6}$/);
        const docs = await api.owner.query<{
            number: string;
            subject_table: string;
            subject_id: string;
            data: { plate: string };
        }>(
            `select d.number, d.subject_table, d.subject_id, d.data from documents.issued_documents d
               join documents.document_templates t on t.id = d.template_id
              where t.key = 'vehicle-libre' and d.case_id = $1`,
            [c.id]
        );
        expect(docs.rows).toHaveLength(1);
        expect(docs.rows[0]).toMatchObject({
            number: libres.rows[0]?.number,
            subject_table: 'vehicles.libres',
            subject_id: libres.rows[0]?.id
        });
        expect(docs.rows[0]?.data.plate).toBe(nationalPlateText(held[0]?.plate_key ?? ''));
        const listed = await api.call('GET', `/api/v1/issued-documents?caseId=${c.id}`, as.officer);
        expect(listed.json<{ items: { templateKey: string }[] }>().items.map((d) => d.templateKey)).toContain(
            'vehicle-libre'
        );

        // each step run again for the same case makes nothing new
        const facts = await factsOf(c.id);
        const p = place(c.id);
        await inTx(p, async (tx) => {
            expect(await registration.register(tx, p, facts, answers)).toEqual({ vehicle: { id: vehicle?.id } });
            expect((await registration.assignPlate(tx, p, facts, {})).plate.key).toBe(held[0]?.plate_key);
            expect((await registration.issueLibre(tx, p, facts, undefined)).libre).toEqual({
                id: libres.rows[0]?.id,
                number: libres.rows[0]?.number
            });
        });
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
        expect(done.state).toBe('registered');
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
        const now = await caseOf(second.id);
        expect(now.state).toBe('registration');
        expect(await platesOf(second.id)).toEqual([expect.objectContaining({ status: 'reserved', vehicle_id: null })]);
        expect(
            await count('select count(*)::int as n from vehicles.vehicle_ownerships where case_id = $1', [second.id])
        ).toBe(0);
        expect(await count('select count(*)::int as n from vehicles.libres where case_id = $1', [second.id])).toBe(0);
        // with its own id it goes through
        expect((await moved(now, as.officer, 'register', { answers: { federalVehicleId: federalId() } })).state).toBe(
            'registered'
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
