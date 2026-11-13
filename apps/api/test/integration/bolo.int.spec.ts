/**
 * The bolo inspection as it is seeded (task 1.3a, DVC-02), run end to end through the API on a real PostgreSQL 16 with the Wolaita
 * seeds: a vehicle on the register is filed at Boditi's counter with its third-party insurance, paid at the till, inspected on the
 * light-vehicle checklist and given its bolo: the sticker of its use and fiscal year from the office's stationery, or a temporary
 * bolo first while the office has none. A failed item blocks the pass. The refusals at filing; a sibling office reads the bolo and
 * cannot change it. Chassis numbers, plates, insurance numbers and names are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boloValidity } from '@itrms/competency/api';
import { importBoloService, LIGHT_VEHICLE_CHECKLIST, setUpBoloCounters } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { StationeryStock } from '@itrms/fees/api';
import { importFeeRules, importStationeryDemo, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { VehicleRegistry } from '@itrms/vehicles/api';
import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    officer: '0199f0a0-d000-7000-8000-00000000b702',
    cashier: '0199f0a0-d000-7000-8000-000000000303'
};
const SERVICE = 'DVC-02';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let stationery: StationeryStock;
let boditi: OrgUnit;
let damot: OrgUnit;
let owner: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const dayFrom = (days: number) => {
    const d = new Date(`${today()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

let serial = 0;
function vin(): string {
    serial += 1;
    const base = `1HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}

/** A vehicle of Boditi's on the register, of a use, registered straight in the register as a seed would. */
async function onTheRoad(use = 'private', more: Record<string, unknown> = {}) {
    const ctx: DbContext = { ...contextFor(boditi), requestId: `seed-${randomUUID()}` };
    return app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: vin(),
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2015,
            categoryKey: 'automobile',
            use: use as 'private',
            seats: 5,
            firstRegisteredOn: '2016-03-01',
            owners: [{ kind: 'person', id: owner }],
            ...more
        });
        await registry.recordPlate(tx, ctx, vehicle.id, {
            text: `SN 2-${String(randomInt(10000, 99999))}`,
            source: 'legacy',
            since: '2016-03-01'
        });
        return vehicle.id;
    });
}

const request = (vehicle: string, over: Record<string, unknown> = {}) => ({
    vehicle,
    use: 'private',
    insuranceCertificate: String(randomInt(1_000_000, 9_999_999)),
    insurer: 'Sample Insurance S.C.',
    insuredFrom: dayFrom(-30),
    insuredUntil: dayFrom(335),
    ...over
});

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

/** Filed, checked and paid: the vehicle waits for its inspection. */
async function atInspection(vehicle: string, over: Record<string, unknown> = {}): Promise<CaseOut> {
    let c = await filed(request(vehicle, over));
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('inspection');
    return c;
}

/** The checklist with every item passed, and `failed` items failed with a remark. */
const sheet = (failed: string[] = []) => ({
    checklistSerial: `LV-${String(randomInt(100000, 999999))}`,
    inspectedOn: today(),
    inspection: {
        items: Object.fromEntries(
            LIGHT_VEHICLE_CHECKLIST.flatMap((s) => s.items).map((i) => [
                i.key,
                failed.includes(i.key) ? { result: 'fail', remark: 'Not working' } : { result: 'pass' }
            ])
        )
    }
});

const bolosOf = async (caseId: string) =>
    (
        await api.owner.query<{
            id: string;
            status: string;
            sticker_key: string | null;
            fiscal_year: number;
            valid_until: string;
            temporary_until: string | null;
            checklist_serial: string;
        }>(
            `select id, status, sticker_key, fiscal_year, valid_until::text, temporary_until::text, checklist_serial
               from competency.bolos where case_id = $1`,
            [caseId]
        )
    ).rows;

const documentsOf = async (caseId: string) =>
    (
        await api.owner.query<{ key: string; number: string; superseded_by: string | null }>(
            `select t.key, d.number, d.superseded_by from documents.issued_documents d
               join documents.document_templates t on t.id = d.template_id
              where d.case_id = $1 and t.key like 'vehicle-%bolo' order by d.created_at`,
            [caseId]
        )
    ).rows;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.bolo.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    stationery = api.http.get(StationeryStock);
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.cashier = { sub: SUB.cashier, unit: boditi };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await importDocumentTemplates(tx, root);
        expect(await importBoloService(tx, root)).toBe(1);
        expect(await setUpBoloCounters(tx, root.regionId)).toBeGreaterThan(0);
    });
    expect(await importStationeryDemo(api.installer, 'SER', stationery, today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ቦሎ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Bolo', grandfather: 'Person' },
        sex: 'female',
        birthYear: 1982,
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

describe('a bolo inspection', () => {
    it('passes on the checklist and gives the bolo: the sticker of its use and year, and the document', async () => {
        const vehicle = await onTheRoad();
        let c = await atInspection(vehicle);
        const inspection = sheet();
        c = await moved(c, as.officer, 'pass', { answers: inspection });
        expect(c.state).toBe('sticker');
        const { fiscalYear, validUntil } = boloValidity(today());
        expect(await bolosOf(c.id)).toEqual([
            expect.objectContaining({
                status: 'awaiting_sticker',
                sticker_key: null,
                fiscal_year: fiscalYear,
                valid_until: validUntil,
                checklist_serial: inspection.checklistSerial
            })
        ]);
        const issued = step(c, as.officer, { action: 'issue_sticker', answers: {} });
        const res = await issued;
        expect(res.statusCode, res.body).toBe(200);
        c = res.json<CaseOut>();
        expect(c.state).toBe('issued');
        const [bolo] = await bolosOf(c.id);
        expect(bolo).toMatchObject({ status: 'valid' });
        // a private vehicle's sticker, of this fiscal year, from Boditi's stock, used for this bolo
        const sticker = await api.owner.query<{ variant: string; valid_efy: number; status: string; holder: string }>(
            `select variant, valid_efy, status, holder_unit_id as holder from fees.stationery_items
              where kind = 'bolo_sticker' and used_for_table = 'competency.bolos' and used_for_id = $1`,
            [bolo?.id]
        );
        expect(sticker.rows).toEqual([
            { variant: 'private', valid_efy: fiscalYear, status: 'used', holder: boditi.id }
        ]);
        expect(await documentsOf(c.id)).toEqual([
            { key: 'vehicle-bolo', number: bolo?.sticker_key, superseded_by: null }
        ]);
        // the bolo was written and audited in the same transactions
        const audit = await api.owner.query<{ action: string }>(
            "select action from kernel.audit_log where table_name = 'competency.bolos' and row_id = $1",
            [bolo?.id]
        );
        expect(audit.rows.map((r) => r.action).sort()).toEqual(['insert', 'update']);
    }, 240_000);

    it('is not passed with a failed item: the pass is refused, and a fail closes the case with the items', async () => {
        const vehicle = await onTheRoad();
        const c = await atInspection(vehicle);
        const failing = sheet(['headlights', 'serviceBrake']);
        const pass = await step(c, as.officer, { action: 'pass', answers: failing });
        expect(pass.statusCode, pass.body).toBe(409);
        // what a browser sends as an outcome is never taken: the server's says failed
        const forged = await step(c, as.officer, {
            action: 'pass',
            answers: {
                ...failing,
                inspection: { ...failing.inspection, outcome: { passed: true, total: 26, max: 26 } }
            }
        });
        expect(forged.statusCode, forged.body).toBe(409);
        expect(await bolosOf(c.id)).toEqual([]);
        const failed = await moved(await caseOf(c.id), as.officer, 'fail', { answers: failing });
        expect(failed.state).toBe('failed');
        const facts = await api.owner.query<{ facts: { inspection?: { failed?: string[]; passed?: boolean } } }>(
            'select facts from workflow.cases where id = $1',
            [c.id]
        );
        expect(facts.rows[0]?.facts.inspection).toMatchObject({
            passed: false,
            failed: ['headlights', 'serviceBrake']
        });
        // and a checklist that passed is never recorded as failed
        const other = await atInspection(await onTheRoad());
        const wrong = await step(other, as.officer, { action: 'fail', answers: sheet() });
        expect(wrong.statusCode, wrong.body).toBe(409);
    }, 240_000);

    it('gives a temporary bolo while the office has no sticker of the kind, and the sticker on the same case when it comes', async () => {
        const vehicle = await onTheRoad('defence');
        let c = await atInspection(vehicle, { use: 'defence' });
        c = await moved(c, as.officer, 'pass', { answers: sheet() });
        // Boditi has no defence stickers
        const none = await step(c, as.officer, { action: 'issue_sticker', answers: {} });
        expect(none.statusCode, none.body).toBe(409);
        c = await moved(await caseOf(c.id), as.officer, 'issue_temporary', { answers: {} });
        expect(c.state).toBe('temporary');
        const [temporary] = await bolosOf(c.id);
        expect(temporary).toMatchObject({ status: 'temporary', temporary_until: dayFrom(30) });
        const [temporaryDocument] = await documentsOf(c.id);
        expect(temporaryDocument).toMatchObject({ key: 'vehicle-temporary-bolo' });
        expect(temporaryDocument?.number).toMatch(/\/TB\/00001$/);

        // the region's defence stickers of this year reach Boditi
        const { fiscalYear } = boloValidity(today());
        const ctx: DbContext = { ...contextFor(boditi), requestId: `stickers-${randomUUID()}` };
        await app.scoped(ctx, (tx) =>
            stationery.receive(tx, ctx, {
                kind: 'bolo_sticker',
                source: 'ministry',
                reference: `DEF-${randomInt(1000, 9999)}`,
                receivedOn: today(),
                range: { series: 'D', from: 1, to: 5 },
                width: 7,
                variant: 'defence',
                validEfy: fiscalYear
            })
        );
        c = await moved(await caseOf(c.id), as.officer, 'issue_sticker', { answers: {} });
        expect(c.state).toBe('issued');
        expect(await bolosOf(c.id)).toEqual([expect.objectContaining({ status: 'valid', sticker_key: 'D0000001' })]);
        expect((await documentsOf(c.id)).map((d) => d.key)).toEqual(['vehicle-temporary-bolo', 'vehicle-bolo']);
    }, 240_000);
});

describe('a bolo request that is refused', () => {
    const refusedAt = async (answers: Record<string, unknown>) => {
        const c = await filed(answers);
        const res = await step(c, as.officer, { action: 'submit' });
        return {
            status: res.statusCode,
            body: res.json<{ code?: string; errors?: { path: string; code: string }[] }>()
        };
    };

    it('on an insurance policy that does not cover today, a use the register does not say, or no Road Fund receipt for freight', async () => {
        const vehicle = await onTheRoad();
        const expired = await refusedAt(request(vehicle, { insuredFrom: dayFrom(-400), insuredUntil: dayFrom(-1) }));
        expect(expired.status).toBe(422);
        expect(expired.body.errors).toEqual([expect.objectContaining({ path: 'insuredUntil', code: 'expired' })]);
        const notYet = await refusedAt(request(vehicle, { insuredFrom: dayFrom(2), insuredUntil: dayFrom(300) }));
        expect(notYet.body.errors).toEqual([expect.objectContaining({ path: 'insuredUntil', code: 'expired' })]);
        const use = await refusedAt(request(vehicle, { use: 'commercial' }));
        expect(use.body.errors).toEqual([expect.objectContaining({ path: 'use', code: 'mismatch' })]);
        const truck = await onTheRoad('commercial', {
            seats: undefined,
            loadCapacityKg: 8000,
            categoryKey: 'light_truck'
        });
        const roadFund = await refusedAt(request(truck, { use: 'commercial', loadTonnes: 8 }));
        expect(roadFund.body.errors).toEqual([expect.objectContaining({ path: 'roadFundReceipt', code: 'required' })]);
    }, 240_000);

    it('on fewer seats than the register gives a bus, or another load for a truck: the fee is worked out from them', async () => {
        const bus = await onTheRoad('public_transport', { seats: 60, categoryKey: 'bus' });
        const seats = await refusedAt(request(bus, { use: 'public_transport', seats: 10 }));
        expect(seats.status).toBe(422);
        expect(seats.body.errors).toEqual([expect.objectContaining({ path: 'seats', code: 'mismatch' })]);
        const blank = await refusedAt(request(bus, { use: 'public_transport' }));
        expect(blank.body.errors).toEqual([expect.objectContaining({ path: 'seats', code: 'mismatch' })]);
        const truck = await onTheRoad('commercial', {
            seats: undefined,
            loadCapacityKg: 50000,
            categoryKey: 'heavy_truck'
        });
        const load = await refusedAt(request(truck, { use: 'commercial', loadTonnes: 10 }));
        expect(load.body.errors).toEqual([expect.objectContaining({ path: 'loadTonnes', code: 'mismatch' })]);
    }, 240_000);

    it('on an inspection day of a past fiscal year', async () => {
        const c = await atInspection(await onTheRoad());
        const old = await step(c, as.officer, {
            action: 'pass',
            answers: { ...sheet(), inspectedOn: dayFrom(-400) }
        });
        expect(old.statusCode, old.body).toBe(422);
        expect(old.json<{ errors?: { path: string; code: string }[] }>().errors).toEqual([
            expect.objectContaining({ path: 'inspectedOn', code: 'past_year' })
        ]);
    }, 240_000);

    it('after the pass, when no sticker can be given: the bolo is void and the vehicle can be filed again', async () => {
        const vehicle = await onTheRoad('ngo');
        let c = await atInspection(vehicle, { use: 'ngo' });
        c = await moved(c, as.officer, 'pass', { answers: sheet() });
        expect(c.state).toBe('sticker');
        c = await moved(c, as.officer, 'reject', { comment: 'No NGO stickers this year' });
        expect(c.state).toBe('rejected');
        expect(await bolosOf(c.id)).toEqual([expect.objectContaining({ status: 'void' })]);
        const again = await filed(request(vehicle, { use: 'ngo' }));
        expect((await moved(again, as.officer, 'submit')).state).toBe('review');
    }, 240_000);

    it("for a vehicle that has this fiscal year's bolo already", async () => {
        const vehicle = await onTheRoad();
        let c = await atInspection(vehicle);
        c = await moved(c, as.officer, 'pass', { answers: sheet() });
        await moved(c, as.officer, 'issue_sticker', { answers: {} });
        const again = await refusedAt(request(vehicle));
        expect(again.status).toBe(422);
        expect(again.body.code).toBe('not_eligible');
    }, 240_000);
});

describe("a bolo's record", () => {
    it('is read by any office of the region, and changed only from its handling office', async () => {
        const [bolo] = (
            await api.owner.query<{ id: string }>("select id from competency.bolos where status = 'valid' limit 1")
        ).rows;
        expect(bolo).toBeDefined();
        const atDamot: DbContext = { ...contextFor(damot), requestId: `read-${randomUUID()}` };
        const seen = await app.scoped(
            atDamot,
            async (tx) =>
                (
                    await tx.execute<{ n: number }>(
                        sql`select count(*)::int as n from competency.bolos where id = ${bolo?.id}`
                    )
                ).rows[0]?.n
        );
        expect(seen).toBe(1);
        const changed = await app.scoped(
            atDamot,
            async (tx) =>
                (
                    await tx.execute(
                        sql`update competency.bolos set status = 'void', void_reason = 'not ours' where id = ${bolo?.id}`
                    )
                ).rowCount
        );
        expect(changed).toBe(0);
    });
});
