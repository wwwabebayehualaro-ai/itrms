/**
 * The bolo inspection as it is seeded (task 1.3a, DVC-02), run end to end through the API on a real PostgreSQL 16 with the Wolaita
 * seeds: a vehicle on the register is filed at Boditi's counter with its third-party insurance, paid at the till, inspected on the
 * light-vehicle checklist and given its bolo: the sticker of its use and fiscal year from the office's stationery, or a temporary
 * bolo first while the office has none. A failed item blocks the pass. A failed vehicle goes to a garage and is inspected again on the
 * same case, each inspection in the register; the owners' reminder is scheduled with the sticker and sent once (task 1.3b). The
 * refusals at filing; a sibling office reads the bolo and cannot change it. Chassis numbers, plates, phones, insurance numbers and
 * names are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boloValidity } from '@itrms/competency/api';
import { remindBoloExpiring, sendBoloReminder } from '@itrms/competency/api/worker';
import { importBoloService, LIGHT_VEHICLE_CHECKLIST, setUpBoloCounters } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { StationeryStock } from '@itrms/fees/api';
import { importFeeRules, importStationeryDemo, parseFeeRules } from '@itrms/fees/seed';
import { FIELD_CRYPTO, type FieldCrypto } from '@itrms/kernel/crypto';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { FakeSms } from '@itrms/kernel/notifications';
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
let ownerPhone: string;
let garage: string;
let system: SystemDatabase;
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
        await api.owner.query<{
            key: string;
            number: string;
            superseded_by: string | null;
            revoke_reason: string | null;
        }>(
            `select t.key, d.number, d.superseded_by, d.revoke_reason from documents.issued_documents d
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
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
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
    const mobile = String(randomInt(10_000_000, 99_999_999));
    ownerPhone = `+2519${mobile}`;
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ቦሎ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Bolo', grandfather: 'Person' },
        sex: 'female',
        birthYear: 1982,
        phone: `09${mobile}`,
        acknowledgedDuplicates: []
    });
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
    const garageMade = await api.call('POST', '/api/v1/organisations', as.officer, {
        kind: 'garage',
        name: { am: 'ናሙና ጋራዥ', en: 'Sample Garage' }
    });
    expect(garageMade.statusCode, garageMade.body).toBe(201);
    garage = garageMade.json<{ id: string }>().id;
}, 240_000);

afterAll(async () => {
    await system?.close();
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
        // actions of a transition left from several states keep their labels and the step's form
        const view = await caseOf(c.id);
        expect(view.actionDetails.find((a) => a.action === 'issue_sticker')).toMatchObject({
            label: { en: 'Issue the sticker' },
            needsForm: true
        });
        expect(view.actionDetails.find((a) => a.action === 'reject')).toMatchObject({
            label: { en: 'Reject' },
            commentRequired: true
        });
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
        // Boditi holds private stickers of this year: no temporary bolo while it does
        const stopgap = await step(c, as.officer, { action: 'issue_temporary', answers: {} });
        expect(stopgap.statusCode, stopgap.body).toBe(409);
        expect(stopgap.json<{ detailKey?: string }>().detailKey).toBe('competency.rule.boloStickersInStock');
        c = await caseOf(c.id);
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
        // the inspection is in the register, written and audited with it
        const register = await api.owner.query<{
            id: string;
            attempt: number;
            passed: boolean;
            garage_id: string | null;
        }>('select id, attempt, passed, garage_id from competency.bolo_inspections where case_id = $1', [c.id]);
        expect(register.rows).toEqual([expect.objectContaining({ attempt: 1, passed: true, garage_id: null })]);
        const registered = await api.owner.query<{ action: string }>(
            "select action from kernel.audit_log where table_name = 'competency.bolo_inspections' and row_id = $1",
            [register.rows[0]?.id]
        );
        expect(registered.rows.map((r) => r.action)).toEqual(['insert']);
        // the owners' reminder waits in the outbox until 30 days before the last day, 08:00 in Addis Ababa
        const reminder = await api.owner.query<{ due: string }>(
            `select to_char(available_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as due from kernel.outbox_events
              where type = 'bolo.expiring.v1' and payload ->> 'boloId' = $1`,
            [bolo?.id]
        );
        const due = new Date(`${validUntil}T05:00:00Z`);
        due.setUTCDate(due.getUTCDate() - 30);
        expect(reminder.rows).toEqual([{ due: due.toISOString().slice(0, 16) }]);
    }, 240_000);

    it('is not passed with a failed item: the pass is refused, and a fail sends the vehicle to a garage with the items', async () => {
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
        expect(failed.state).toBe('repair');
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
        // the temporary bolo no longer stands once the sticker is given: its QR says so
        expect(await documentsOf(c.id)).toEqual([
            expect.objectContaining({ key: 'vehicle-temporary-bolo', revoke_reason: 'bolo_sticker_given' }),
            expect.objectContaining({ key: 'vehicle-bolo', revoke_reason: null })
        ]);
    }, 240_000);

    it("stands a temporary bolo for the office's own number of days", async () => {
        // Boditi's setting: 10 days (no NGO stickers in its stock)
        await api.owner.query(
            `insert into kernel.settings_values (id, region_id, unit_id, key, value)
             values (gen_random_uuid(), $1, $2, 'competency.bolo_temporary_days', '10'::jsonb)`,
            [boditi.regionId, boditi.id]
        );
        try {
            let c = await atInspection(await onTheRoad('ngo'), { use: 'ngo' });
            c = await moved(c, as.officer, 'pass', { answers: sheet() });
            c = await moved(c, as.officer, 'issue_temporary', { answers: {} });
            expect(await bolosOf(c.id)).toEqual([
                expect.objectContaining({ status: 'temporary', temporary_until: dayFrom(10) })
            ]);
            // rejected on its temporary bolo: the bolo is void and the temporary document stops standing
            c = await moved(c, as.officer, 'reject', { comment: 'The owner sold the vehicle' });
            expect(await bolosOf(c.id)).toEqual([expect.objectContaining({ status: 'void' })]);
            expect(await documentsOf(c.id)).toEqual([
                expect.objectContaining({ key: 'vehicle-temporary-bolo', revoke_reason: 'bolo_case_rejected' })
            ]);
        } finally {
            await api.owner.query(
                "delete from kernel.settings_values where unit_id = $1 and key = 'competency.bolo_temporary_days'",
                [boditi.id]
            );
        }
    }, 240_000);
});

describe('a vehicle that fails its inspection', () => {
    it('goes to a garage and is inspected again on the same case and fee, each inspection in the register', async () => {
        let c = await atInspection(await onTheRoad());
        const failing = sheet(['headlights', 'tyres']);
        c = await moved(c, as.officer, 'fail', { answers: failing });
        expect(c.state).toBe('repair');
        const view = await caseOf(c.id);
        expect(view.actionDetails.find((a) => a.action === 'reinspect')).toMatchObject({ needsForm: true });
        expect(view.actionDetails.find((a) => a.action === 'close_failed')).toMatchObject({ commentRequired: true });

        // the garage step: a garage of the register, back no earlier than the failure and not in the future
        const notAGarage = await api.call('POST', '/api/v1/organisations', as.officer, {
            kind: 'contractor',
            name: { am: 'ናሙና ተቋራጭ', en: 'Sample Contractor' }
        });
        expect(notAGarage.statusCode, notAGarage.body).toBe(201);
        const wrongKind = await step(c, as.officer, {
            action: 'reinspect',
            answers: { garage: notAGarage.json<{ id: string }>().id }
        });
        expect(wrongKind.statusCode, wrongKind.body).toBe(422);
        expect(wrongKind.json<{ errors?: { path: string; code: string }[] }>().errors).toEqual([
            expect.objectContaining({ path: 'garage', code: 'not_a_garage' })
        ]);
        const early = await step(c, as.officer, {
            action: 'reinspect',
            answers: { garage, repairedOn: dayFrom(-1) }
        });
        expect(early.statusCode, early.body).toBe(422);
        expect(early.json<{ errors?: { path: string; code: string }[] }>().errors).toEqual([
            expect.objectContaining({ path: 'repairedOn', code: 'before_failure' })
        ]);
        c = await moved(await caseOf(c.id), as.officer, 'reinspect', {
            answers: { garage, repairedOn: today(), repairNote: 'Headlight bulb and two tyres replaced' }
        });
        expect(c.state).toBe('inspection');
        // no second payment order: the fee paid for the first inspection covers this one
        const orders = await api.owner.query<{ n: number }>(
            'select count(*)::int as n from fees.payment_orders where case_id = $1',
            [c.id]
        );
        expect(orders.rows[0]?.n).toBe(1);

        const passing = sheet();
        c = await moved(c, as.officer, 'pass', { answers: passing });
        expect(c.state).toBe('sticker');
        const register = await api.owner.query<{
            attempt: number;
            passed: boolean;
            failed_items: { key: string; remark?: string }[];
            garage_id: string | null;
            repaired_on: string | null;
            repair_note: string | null;
            checklist_serial: string;
        }>(
            `select attempt, passed, failed_items, garage_id, repaired_on::text, repair_note, checklist_serial
               from competency.bolo_inspections where case_id = $1 order by attempt`,
            [c.id]
        );
        expect(register.rows).toEqual([
            {
                attempt: 1,
                passed: false,
                failed_items: [
                    { key: 'headlights', remark: 'Not working' },
                    { key: 'tyres', remark: 'Not working' }
                ],
                garage_id: null,
                repaired_on: null,
                repair_note: null,
                checklist_serial: failing.checklistSerial
            },
            {
                attempt: 2,
                passed: true,
                failed_items: [],
                garage_id: garage,
                repaired_on: today(),
                repair_note: 'Headlight bulb and two tyres replaced',
                checklist_serial: passing.checklistSerial
            }
        ]);
        expect(await bolosOf(c.id)).toEqual([
            expect.objectContaining({ status: 'awaiting_sticker', checklist_serial: passing.checklistSerial })
        ]);
        c = await moved(c, as.officer, 'issue_sticker', { answers: {} });
        expect(c.state).toBe('issued');
    }, 240_000);

    it('fails again and goes back to a garage, or is closed as failed when it does not come back', async () => {
        let c = await atInspection(await onTheRoad());
        c = await moved(c, as.officer, 'fail', { answers: sheet(['horn']) });
        c = await moved(c, as.officer, 'reinspect', { answers: { garage } });
        c = await moved(c, as.officer, 'fail', { answers: sheet(['horn']) });
        expect(c.state).toBe('repair');
        // the second repair is the second inspection's: the first one's is not taken again
        const attempts = await api.owner.query<{ attempt: number; garage_id: string | null }>(
            'select attempt, garage_id from competency.bolo_inspections where case_id = $1 order by attempt',
            [c.id]
        );
        expect(attempts.rows).toEqual([
            { attempt: 1, garage_id: null },
            { attempt: 2, garage_id: garage }
        ]);
        const closed = await step(c, as.officer, { action: 'close_failed' });
        expect(closed.statusCode, closed.body).toBe(422);
        c = await moved(await caseOf(c.id), as.officer, 'close_failed', {
            comment: 'The owner did not bring the vehicle back'
        });
        expect(c.state).toBe('failed');
        expect(await bolosOf(c.id)).toEqual([]);
    }, 240_000);
});

describe('a vehicle back from the garage after the fiscal year ended', () => {
    it("is not given the new year's bolo on the old year's request: the repair is refused, the request is closed as failed", async () => {
        let c = await atInspection(await onTheRoad());
        c = await moved(c, as.officer, 'fail', { answers: sheet(['horn']) });
        // the failure was in the last fiscal year (the register's day moved back, as the calendar would have)
        await api.owner.query('update competency.bolo_inspections set inspected_on = $2 where case_id = $1', [
            c.id,
            dayFrom(-400)
        ]);
        const back = await step(c, as.officer, { action: 'reinspect', answers: { garage } });
        expect(back.statusCode, back.body).toBe(422);
        expect(back.json<{ errors?: { path: string; code: string }[] }>().errors).toEqual([
            expect.objectContaining({ path: 'repairedOn', code: 'past_year' })
        ]);
        c = await moved(await caseOf(c.id), as.officer, 'close_failed', { comment: 'A new year: file again' });
        expect(c.state).toBe('failed');
    }, 240_000);
});

describe("a bolo's renewal reminder", () => {
    it('tells the owners by SMS once, with the plate and the last day, reading the phone on record', async () => {
        const vehicle = await onTheRoad();
        let c = await atInspection(vehicle);
        c = await moved(c, as.officer, 'pass', { answers: sheet() });
        c = await moved(c, as.officer, 'issue_sticker', { answers: {} });
        const [bolo] = await bolosOf(c.id);
        if (!bolo) throw new Error('no bolo');
        // due: the bolo is marked and one SMS is asked for per owner, each its own outbox event
        expect(await remindBoloExpiring(system, bolo.id)).toBe(1);
        const due = await api.owner.query<{ payload: { boloId: string; personId: string } }>(
            "select payload from kernel.outbox_events where type = 'bolo-reminder.sms-due.v1' and payload ->> 'boloId' = $1",
            [bolo.id]
        );
        expect(due.rows.map((r) => r.payload)).toEqual([{ boloId: bolo.id, personId: owner }]);
        // the owner's SMS: a gateway that fails throws, so the outbox sends this owner's again
        const down = {
            sendToNumber: () => Promise.reject(new Error('gateway down'))
        };
        const crypto = api.http.get<FieldCrypto>(FIELD_CRYPTO);
        await expect(
            sendBoloReminder(system, { sms: down, crypto }, { boloId: bolo.id, personId: owner })
        ).rejects.toThrow('gateway down');
        const sms = new FakeSms();
        expect(await sendBoloReminder(system, { sms, crypto }, { boloId: bolo.id, personId: owner })).toBe(true);
        expect(sms.sentToNumbers.map((m) => m.phone)).toEqual([ownerPhone]);
        expect(sms.sentToNumbers[0]?.text).toContain('ሰኔ 30');
        const plate = await api.owner.query<{ plate_text: string }>(
            'select plate_text from vehicles.plate_assignments where vehicle_id = $1 and until is null',
            [vehicle]
        );
        expect(sms.sentToNumbers[0]?.text).toContain(plate.rows[0]?.plate_text);
        // once: the due event delivered again asks for nothing more
        expect(await remindBoloExpiring(system, bolo.id)).toBe(false);
        const again = await api.owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.outbox_events where type = 'bolo-reminder.sms-due.v1' and payload ->> 'boloId' = $1",
            [bolo.id]
        );
        expect(again.rows[0]?.n).toBe(1);
        const marked = await api.owner.query<{ reminded: boolean }>(
            'select reminded_at is not null as reminded from competency.bolos where id = $1',
            [bolo.id]
        );
        expect(marked.rows[0]?.reminded).toBe(true);
        // each read of the phone is on record (the failed send's and the retry's)
        const reads = await api.owner.query<{ n: number }>(
            `select count(*)::int as n from kernel.audit_log
              where event_type = 'person.revealed' and row_id = $1 and diff ->> 'reason' = 'competency.bolo_reminder'`,
            [owner]
        );
        expect(reads.rows[0]?.n).toBe(2);
    }, 240_000);

    it('is not sent for a bolo that no longer stands', async () => {
        let c = await atInspection(await onTheRoad('ngo'), { use: 'ngo' });
        c = await moved(c, as.officer, 'pass', { answers: sheet() });
        c = await moved(c, as.officer, 'reject', { comment: 'No NGO stickers this year' });
        const [bolo] = await bolosOf(c.id);
        if (!bolo) throw new Error('no bolo');
        expect(await remindBoloExpiring(system, bolo.id)).toBe(false);
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
            axles: 2,
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
            axles: 3,
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

    it("keeps an office's inspection register to it and the offices above: a sibling office sees none of it", async () => {
        const count = (ctx: DbContext) =>
            app.scoped(
                ctx,
                async (tx) =>
                    (
                        await tx.execute<{ n: number }>(
                            sql`select count(*)::int as n from competency.bolo_inspections
                                 where handling_unit_id = ${boditi.id}`
                        )
                    ).rows[0]?.n
            );
        const total = (
            await api.owner.query<{ n: number }>(
                'select count(*)::int as n from competency.bolo_inspections where handling_unit_id = $1',
                [boditi.id]
            )
        ).rows[0]?.n;
        expect(total).toBeGreaterThan(0);
        expect(await count({ ...contextFor(boditi), requestId: `own-${randomUUID()}` })).toBe(total);
        expect(await count({ ...contextFor(damot), requestId: `sibling-${randomUUID()}` })).toBe(0);
        // written once: the app may not change a row of the register
        const changed = app.scoped({ ...contextFor(boditi), requestId: `write-${randomUUID()}` }, (tx) =>
            tx.execute(sql`update competency.bolo_inspections set passed = true where handling_unit_id = ${boditi.id}`)
        );
        await expect(changed).rejects.toThrow(/permission denied/);
    });
});
