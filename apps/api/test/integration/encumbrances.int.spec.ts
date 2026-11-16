/**
 * Encumbrances on a vehicle (task 1.4a) on a real PostgreSQL 16 with the Wolaita seeds, Test Zone B and Test Region X: an office
 * records a bank loan, a court order, a revenue or customs hold on the holder's letter; only that office asks for its release and
 * a different person of that office, or of one above it, confirms; an open or release-pending hold blocks the services it
 * conflicts with (`vehicles.checkEncumbrances:<conflict>` in a DVC-12 version published here as a bureau would), naming the
 * holder; the hold shows on the vehicle record, the search and the lookup; the isolation matrix; the database refuses what the
 * machine does not allow, whatever the writer. Chassis numbers, plates, names and letters are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { NO_OBJECT_STORE } from '@itrms/kernel/files';
import { asUnit, contextFor, ISOLATION_CASES, TEST_CONTEXT_KEY, VISIBLE, WRITABLE } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { importPlateExchangeService, importVehicleServices } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { PlateStock, VehicleRegistry } from '@itrms/vehicles/api';
import {
    DEFAULT_ENCUMBRANCE_BLOCKS,
    ENCUMBRANCE_BLOCKS_SETTING,
    vinCheckDigit,
    type Encumbrance,
    type EncumbranceKind,
    type Vehicle,
    type VehicleSummary
} from '@itrms/vehicles/contracts';
import {
    importPlateStockDemo,
    importVehicleCategories,
    setUpRegistrationCertificateCounters
} from '@itrms/vehicles/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    cashier: '0199f0a0-d000-7000-8000-000000000303',
    officer: '0199f0a0-d000-7000-8000-00000000e101',
    lead: '0199f0a0-d000-7000-8000-00000000e102',
    trxClerk: '0199f0a0-d000-7000-8000-00000000e103'
};
const SERVICE = 'DVC-12';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let region: OrgUnit;
let zone: OrgUnit;
let boditi: OrgUnit;
let damot: OrgUnit;
let tzb: OrgUnit;
let tzbW1: OrgUnit;
let trx: OrgUnit;
let owner: string;
let trxOwner: string;
let bank: { id: string };
let court: { id: string };
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

/** A vehicle of `unit` on an old regional plate, registered straight in the register as a seed would. */
async function onTheRoad(unit: OrgUnit, who = owner) {
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    const plate = `SN 2-${String(randomInt(10000, 99999))}`;
    return app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: vin(),
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2010,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5,
            firstRegisteredOn: '2011-03-01',
            owners: [{ kind: 'person', id: who }]
        });
        await registry.recordPlate(tx, ctx, vehicle.id, { text: plate, source: 'legacy', since: '2011-03-01' });
        return { id: vehicle.id, plate };
    });
}

/** Takes a vehicle of `unit` off the register or reports it stolen, through the register's own command (the ownership chain checks it). */
async function setStatus(unit: OrgUnit, vehicleId: string, status: 'stolen' | 'deregistered'): Promise<void> {
    const { rows } = await api.owner.query<{ row_version: number }>(
        'select row_version from vehicles.vehicles where id = $1',
        [vehicleId]
    );
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    await app.scoped(ctx, (tx) =>
        registry.setStatus(tx, ctx, vehicleId, rows[0]?.row_version ?? 1, { status, on: today() })
    );
}

const letter = () => `LTR-${randomInt(100000, 999999)}`;

/** Records a hold as `who` (the Boditi officer by default). */
const hold = (vehicleId: string, kind: EncumbranceKind, holder = bank, who = as.officer, reference = letter()) =>
    api.call('POST', '/api/v1/encumbrances', who, {
        vehicleId,
        kind,
        holderOrganisationId: holder.id,
        letterReference: reference,
        letterDate: '2026-10-01'
    });
const recorded = async (vehicleId: string, kind: EncumbranceKind, holder = bank, who = as.officer) => {
    const res = await hold(vehicleId, kind, holder, who);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Encumbrance>();
};
const releaseRequest = (e: Pick<Encumbrance, 'id' | 'version'>, who: As, body: object = {}) =>
    api.call(
        'POST',
        `/api/v1/encumbrances/${e.id}/release-request`,
        who,
        { releaseReference: letter(), releaseDate: today(), ...body },
        ifMatch(e.version)
    );
const confirmation = (e: Pick<Encumbrance, 'id' | 'version'>, who: As) =>
    api.call('POST', `/api/v1/encumbrances/${e.id}/release-confirmation`, who, {}, ifMatch(e.version));
const refusal = (e: Pick<Encumbrance, 'id' | 'version'>, who: As, reason = 'The letter is for another vehicle.') =>
    api.call('POST', `/api/v1/encumbrances/${e.id}/release-refusal`, who, { reason }, ifMatch(e.version));
const read = async (id: string) =>
    (await api.call('GET', `/api/v1/encumbrances/${id}`, as.officer)).json<Encumbrance>();
/** Asked for release by the officer and confirmed by the lead. */
async function released(e: Encumbrance): Promise<void> {
    const pending = await releaseRequest(e, as.officer);
    expect(pending.statusCode, pending.body).toBe(200);
    const done = await confirmation(pending.json<Encumbrance>(), as.lead);
    expect(done.statusCode, done.body).toBe(200);
}

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
async function refused(work: Promise<unknown>): Promise<string> {
    try {
        await work;
    } catch (error) {
        const e = error as { message: string; cause?: { message?: string } };
        return e.cause?.message ?? e.message;
    }
    throw new Error('expected a refusal');
}

/** A letter `sub` uploaded and had stored at Boditi (a row, as the upload's confirmation leaves it). */
async function upload(sub: string): Promise<string> {
    const { rows } = await api.owner.query<{ id: string }>(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key, confirmed_at,
                                   origin, created_by, expires_at)
         select g.id, $1::uuid, $2::uuid, 'stored', 'letter.pdf', 'application/pdf', 10, repeat('a', 64),
                'files/' || $1::text || '/' || g.id::text, now(), 'upload', $3::uuid, now() + interval '7 days'
           from (select gen_random_uuid() as id) g
         returning id`,
        [boditi.regionId, boditi.id, await api.userId(sub)]
    );
    return rows[0]?.id ?? '';
}
const holdWithLetter = (vehicleId: string, letterFileId: string, who = as.officer) =>
    api.call('POST', '/api/v1/encumbrances', who, {
        vehicleId,
        kind: 'bank_loan',
        holderOrganisationId: bank.id,
        letterReference: letter(),
        letterDate: '2026-10-01',
        letterFileId
    });

// ---- DVC-12 as a bureau would publish it with the check named

const step = (c: CaseOut, who: As, body: object) =>
    api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
async function moved(c: CaseOut, who: As, action: string, more: object = {}): Promise<CaseOut> {
    const res = await step(c, who, { action, ...more });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}
const caseOf = async (id: string) => (await api.call('GET', `/api/v1/cases/${id}`, as.officer)).json<CaseOut>();

interface Transition {
    from: string | string[];
    action?: string;
    effects?: string[];
    [key: string]: unknown;
}
let published = 0;
/** DVC-12 as seeded: every checked version is built on it, never on the one before (the checks would pile up) */
let seeded: { form: string; fee: string; definition: { transitions: Transition[] } } | undefined;
/** DVC-12's seeded flow with `vehicles.checkEncumbrances:<conflict>` on filing, before the payment order and before the plate is given. */
async function publishChecked(conflict: string): Promise<void> {
    published += 1;
    const { rows } = await api.owner.query<{ form: string; fee: string; definition: { transitions: Transition[] } }>(
        `select v.form_version_id as form, v.fee_rule_version_id as fee, w.definition
           from services.service_definitions d
           join services.service_versions v on v.id = d.current_version_id
           join workflow.workflow_definition_versions w on w.id = v.workflow_version_id
          where d.code = $1`,
        [SERVICE]
    );
    seeded ??= rows[0];
    const current = seeded;
    if (!current) throw new Error('DVC-12 is not seeded');
    const check = `vehicles.checkEncumbrances:${conflict}`;
    const definition = {
        ...current.definition,
        transitions: current.definition.transitions.map((t) => {
            const effects = t.effects ?? [];
            if (t.action === 'submit' || t.action === 'correct') return { ...t, effects: [...effects, check] };
            if (t.from === 'review' && t.action === 'approve') return { ...t, effects: [check, ...effects] };
            if (t.action === 'exchange') return { ...t, effects: [check, ...effects] };
            return t;
        })
    };
    const flow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: `encumbered-plate-exchange-${published}`,
        name: { am: 'ማረጋገጫ', en: 'Encumbrance checked' },
        definition
    });
    expect(flow.statusCode, flow.body).toBe(201);
    const version = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
        workflowVersionId: flow.json<{ latestVersion: { id: string } }>().latestVersion.id,
        formVersionId: current.form,
        feeRuleVersionId: current.fee,
        defaults: { approval_unit: 'handling' },
        overridePolicy: { approval_unit: ['region', 'unit'], sla: ['region', 'unit'] }
    });
    expect(version.statusCode, version.body).toBe(201);
}

async function filed(vehicleId: string): Promise<CaseOut> {
    const answers = { vehicle: vehicleId, use: 'private' };
    const shown = await api.call('POST', '/api/v1/fees/preview', as.officer, { serviceCode: SERVICE, answers });
    expect(shown.statusCode, shown.body).toBe(200);
    const fee = shown.json<{ feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', as.officer, {
        serviceCode: SERVICE,
        answers,
        fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim }
    });
    expect(started.statusCode, started.body).toBe(201);
    return started.json<CaseOut>();
}
const filing = async (vehicleId: string) => {
    const res = await step(await filed(vehicleId), as.officer, { action: 'submit' });
    return { status: res.statusCode, body: res.json<ProblemBody>() };
};
interface ProblemBody {
    code?: string;
    detail?: string;
    errors?: { path: string; code: string; message: string }[];
}
async function paid(c: CaseOut): Promise<void> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.cashier);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call('POST', `/api/v1/payment-orders/${id}/payments`, as.cashier, {
        method: 'cash',
        amountSantim: totalSantim,
        receivedFrom: 'Sample Owner'
    });
    expect(res.statusCode, res.body).toBe(201);
}
/** Filed, checked, paid and approved by the lead: the officer hands the plate over next. */
async function atExchange(vehicleId: string): Promise<CaseOut> {
    let c = await filed(vehicleId);
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    await paid(c);
    c = await moved(await caseOf(c.id), as.lead, 'approve');
    expect(c.state).toBe('exchange');
    return c;
}
const plateGiven = async (vehicleId: string) =>
    (
        await api.owner.query<{ n: number }>(
            `select count(*)::int as n from vehicles.plate_assignments where vehicle_id = $1 and format = 'national'`,
            [vehicleId]
        )
    ).rows[0]?.n ?? 0;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.enc.officer',
                sub: SUB.officer,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [
                    ['WOL-BODITI', 'competency.officer'],
                    ['WOL-BODITI', 'records_officer']
                ]
            },
            {
                username: 'test.enc.lead',
                sub: SUB.lead,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [['WOL-BODITI', 'competency.lead']]
            },
            {
                username: 'test.enc.trx',
                sub: SUB.trxClerk,
                region: 'TRX',
                home: 'TRX-W1',
                roles: [['TRX-W1', 'records_officer']]
            }
        ],
        {
            // a letter's link is signed, never fetched: no object behind it is needed
            objectStore: { ...NO_OBJECT_STORE, presignGet: ({ key }) => Promise.resolve(`https://store.test/${key}`) }
        }
    );
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    tzb = await api.unit('SER', 'TZB');
    tzbW1 = await api.unit('SER', 'TZB-W1');
    trx = await api.unit('TRX', 'TRX-W1');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.zoneHead = { sub: SUB.zoneHead, unit: zone };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.cashier = { sub: SUB.cashier, unit: boditi };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.trxClerk = { sub: SUB.trxClerk, unit: trx };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        await importVehicleServices(tx, root);
        expect(await importPlateExchangeService(tx, root)).toBe(1);
    });
    // Test Region X keeps its own categories, for the vehicle of the isolation matrix
    const trxRoot = await api.unit('TRX', 'TRX');
    await api.installer.scoped({}, (tx) => importVehicleCategories(tx, { id: trxRoot.id, regionId: trxRoot.regionId }));
    expect(await importPlateStockDemo(api.installer, 'SER', api.http.get(PlateStock), today())).not.toBeNull();

    const person = (who: As, family: string) =>
        api.call('POST', '/api/v1/persons', who, {
            nameAm: { given: 'ባለቤት', father: 'ዕዳ', grandfather: 'ታደሰ' },
            nameEn: { given: 'Sample', father: family, grandfather: 'Person' },
            sex: 'male',
            birthYear: 1980,
            acknowledgedDuplicates: []
        });
    const first = await person(as.officer, 'Holder');
    expect(first.statusCode, first.body).toBe(201);
    owner = first.json<{ id: string }>().id;
    const second = await person(as.trxClerk, 'Other');
    expect(second.statusCode, second.body).toBe(201);
    trxOwner = second.json<{ id: string }>().id;

    const organisation = async (kind: 'bank' | 'court', am: string, en: string) => {
        const res = await api.call('POST', '/api/v1/organisations', as.officer, { kind, name: { am, en } });
        expect(res.statusCode, res.body).toBe(201);
        return res.json<{ id: string }>();
    };
    bank = await organisation('bank', 'የናሙና ባንክ', 'Sample Bank');
    court = await organisation('court', 'የናሙና ፍርድ ቤት', 'Sample Court');
}, 300_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('recording a hold', () => {
    it('records a hold open, on record in the same request, and shows it on the vehicle and in its list', async () => {
        const { id } = await onTheRoad(boditi);
        const res = await api.call('POST', '/api/v1/encumbrances', as.officer, {
            vehicleId: id,
            kind: 'bank_loan',
            holderOrganisationId: bank.id,
            letterReference: letter(),
            letterDate: '2026-10-01',
            amountSantim: '250000000',
            note: 'Loan against the vehicle.'
        });
        expect(res.statusCode, res.body).toBe(201);
        const e = res.json<Encumbrance>();
        expect(e).toMatchObject({
            vehicleId: id,
            kind: 'bank_loan',
            status: 'open',
            amountSantim: '250000000',
            holder: { id: bank.id },
            recordedUnit: { id: boditi.id }
        });
        expect(await auditOf(requestIdOf(res))).toMatchObject({ 'vehicles.vehicle_encumbrances:insert': 1 });
        const list = await api.call('GET', `/api/v1/encumbrances?vehicleId=${id}`, as.damotHead);
        expect(list.json<{ items: Encumbrance[] }>().items.map((x) => x.id)).toEqual([e.id]);
        expect((await api.call('GET', `/api/v1/encumbrances/${e.id}`, as.damotHead)).statusCode).toBe(200);
    });

    it('refuses a future letter date, an unknown holder, a vehicle off the register and an unknown vehicle with 422', async () => {
        const { id } = await onTheRoad(boditi);
        const future = await api.call('POST', '/api/v1/encumbrances', as.officer, {
            vehicleId: id,
            kind: 'court_order',
            holderOrganisationId: court.id,
            letterReference: letter(),
            letterDate: '2999-01-01'
        });
        expect(future.statusCode, future.body).toBe(422);
        expect(future.json<ProblemBody>().errors).toEqual([expect.objectContaining({ path: 'letterDate' })]);
        const stranger = await hold(id, 'court_order', { id: randomUUID() });
        expect(stranger.statusCode).toBe(422);
        expect((await hold(randomUUID(), 'court_order')).statusCode).toBe(422);
        await setStatus(boditi, id, 'deregistered');
        const off = await hold(id, 'court_order');
        expect(off.statusCode, off.body).toBe(422);
        expect(off.json<ProblemBody>().errors).toEqual([expect.objectContaining({ path: 'vehicleId' })]);
        expect((await api.call('POST', '/api/v1/encumbrances', as.officer, { vehicleId: id })).statusCode).toBe(422);
    });

    it('records a vehicle reported stolen, and refuses the same letter twice with 409', async () => {
        const { id } = await onTheRoad(boditi);
        await setStatus(boditi, id, 'stolen');
        const reference = letter();
        expect((await hold(id, 'court_order', court, as.officer, reference)).statusCode).toBe(201);
        const twice = await hold(id, 'court_order', court, as.officer, reference);
        expect(twice.statusCode, twice.body).toBe(409);
        expect(twice.json<ProblemBody>().code).toBe('duplicate_reference');
    });

    it('lets a Boditi officer record and the lead read, and keeps the register readers out of recording', async () => {
        const { id } = await onTheRoad(boditi);
        expect((await hold(id, 'revenue_hold', bank, as.damotHead)).statusCode).toBe(403);
        expect((await hold(id, 'revenue_hold', bank, as.zoneHead)).statusCode).toBe(403);
        expect((await api.call('GET', '/api/v1/encumbrances', as.zoneHead)).statusCode).toBe(200);
    });
});

describe('releasing a hold: only the office that recorded it asks, a different person confirms', () => {
    it('keeps the hold standing while its release waits, and lifts it when another person of the office confirms', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        const asked = await releaseRequest(e, as.officer, { note: 'Loan repaid.' });
        expect(asked.statusCode, asked.body).toBe(200);
        const pending = asked.json<Encumbrance>();
        expect(pending).toMatchObject({
            status: 'release_pending',
            releaseRequestedBy: { id: expect.any(String) as string }
        });
        expect(await auditOf(requestIdOf(asked))).toMatchObject({ 'vehicles.vehicle_encumbrances:update': 1 });
        // the hold still shows on the vehicle while the release waits
        const vehicle = (await api.call('GET', `/api/v1/vehicles/${id}`, as.damotHead)).json<Vehicle>();
        expect(vehicle.encumbrances).toMatchObject([{ id: e.id, status: 'release_pending' }]);

        const own = await confirmation(pending, as.officer);
        expect(own.statusCode, own.body).toBe(403);
        expect((await read(e.id)).status).toBe('release_pending');
        const done = await confirmation(pending, as.lead);
        expect(done.statusCode, done.body).toBe(200);
        expect(done.json<Encumbrance>()).toMatchObject({
            status: 'released',
            releasedBy: { id: expect.any(String) as string }
        });
        expect(await auditOf(requestIdOf(done))).toMatchObject({ 'vehicles.vehicle_encumbrances:update': 1 });
        expect((await api.call('GET', `/api/v1/vehicles/${id}`, as.damotHead)).json<Vehicle>().encumbrances).toEqual(
            []
        );
        // released is final
        expect((await releaseRequest(done.json<Encumbrance>(), as.officer)).statusCode).toBe(409);
        expect((await confirmation(done.json<Encumbrance>(), as.lead)).statusCode).toBe(409);
    });

    it('lets only the recording office ask: another office, and an office above, are refused', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'court_order', court);
        expect((await releaseRequest(e, as.damotHead)).statusCode).toBe(403);
        expect((await releaseRequest(e, as.zoneHead)).statusCode).toBe(403);
        expect((await read(e.id)).status).toBe('open');
        // a release dated before the letter, or in the future, is not one
        expect((await releaseRequest(e, as.officer, { releaseDate: '2026-09-01' })).statusCode).toBe(422);
        expect((await releaseRequest(e, as.officer, { releaseDate: '2999-01-01' })).statusCode).toBe(422);
        // nothing is confirmed that was not asked for
        expect((await confirmation(e, as.lead)).statusCode).toBe(409);
    });

    it('lets the zone above confirm, and refuses a sibling office', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        const pending = (await releaseRequest(e, as.officer)).json<Encumbrance>();
        const sibling = await confirmation(pending, as.damotHead);
        expect(sibling.statusCode, sibling.body).toBe(403);
        expect((await read(e.id)).status).toBe('release_pending');
        const above = await confirmation(pending, as.zoneHead);
        expect(above.statusCode, above.body).toBe(200);
        expect(above.json<Encumbrance>().status).toBe('released');
    });

    it('takes a refusal back to open with its reason, and the office may ask again', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        const pending = (await releaseRequest(e, as.officer)).json<Encumbrance>();
        expect((await refusal(pending, as.officer)).statusCode).toBe(403);
        expect((await refusal(pending, as.lead, 'short')).statusCode).toBe(422);
        const refusedRes = await refusal(pending, as.lead);
        expect(refusedRes.statusCode, refusedRes.body).toBe(200);
        const back = refusedRes.json<Encumbrance>();
        expect(back).toMatchObject({
            status: 'open',
            releaseReference: null,
            releaseRequestedBy: null,
            releaseRefusalReason: 'The letter is for another vehicle.'
        });
        expect((await confirmation(back, as.lead)).statusCode).toBe(409);
        const again = await releaseRequest(back, as.officer);
        expect(again.statusCode, again.body).toBe(200);
        expect(again.json<Encumbrance>().releaseRefusalReason).toBeNull();
    });

    it('refuses a change made on an old version with 409', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        expect((await releaseRequest(e, as.officer)).statusCode).toBe(200);
        expect((await releaseRequest(e, as.officer)).statusCode).toBe(409);
    });
});

describe('what the database keeps, whatever the writer', () => {
    it('refuses to change what the letter said, even to the app role, and to delete a hold', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`update vehicles.vehicle_encumbrances set kind = 'court_order' where id = ${e.id}`)
                )
            )
        ).toMatch(/permission denied/);
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`delete from vehicles.vehicle_encumbrances where id = ${e.id}`)
                )
            )
        ).toMatch(/permission denied/);
        // the owner's own grants are not the app's: the trigger refuses the same change
        expect(
            await refused(
                api.owner.query(`update vehicles.vehicle_encumbrances set kind = 'court_order' where id = $1`, [e.id])
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
    });

    it('refuses a released hold going back to open, and a release confirmed by the person who asked for it', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        await released(e);
        expect(
            await refused(
                api.owner.query(`update vehicles.vehicle_encumbrances set status = 'open' where id = $1`, [e.id])
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
        const other = await recorded((await onTheRoad(boditi)).id, 'bank_loan');
        const pending = (await releaseRequest(other, as.officer)).json<Encumbrance>();
        expect(
            await refused(
                api.owner.query(
                    `update vehicles.vehicle_encumbrances set status = 'released', released_by = release_requested_by, released_at = now() where id = $1`,
                    [pending.id]
                )
            )
        ).toMatch(/status_fields_check/);
        expect(
            await refused(
                api.owner.query(`update vehicles.vehicle_encumbrances set status = 'released' where id = $1`, [
                    other.id
                ])
            )
        ).toMatch(/status_fields_check/);
    });

    it('keeps the maker-checker for the app role: no made-up requester, no skipped step, no rewritten evidence', async () => {
        const open = await recorded((await onTheRoad(boditi)).id, 'bank_loan');
        // a release asked for in the name of someone else
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`update vehicles.vehicle_encumbrances
                        set status = 'release_pending', release_reference = 'R-1', release_date = '2026-10-02',
                            release_requested_by = ${randomUUID()}, release_requested_at = now()
                      where id = ${open.id}`)
                )
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
        // open straight to released, asking and confirming in one statement
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`update vehicles.vehicle_encumbrances
                        set status = 'released', release_reference = 'R-1', release_date = '2026-10-02',
                            release_requested_by = ${randomUUID()}, release_requested_at = now(),
                            released_by = kernel.ctx_user(), released_at = now()
                      where id = ${open.id}`)
                )
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
        expect((await read(open.id)).status).toBe('open');

        // a pending release: the confirmation names the signed user, and changes nothing the request wrote
        const pending = (await releaseRequest(open, as.officer)).json<Encumbrance>();
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`update vehicles.vehicle_encumbrances
                        set status = 'released', released_by = ${randomUUID()}, released_at = now()
                      where id = ${pending.id}`)
                )
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`update vehicles.vehicle_encumbrances
                        set status = 'released', release_requested_by = kernel.ctx_user(), released_by = ${randomUUID()},
                            released_at = now()
                      where id = ${pending.id}`)
                )
            )
        ).toMatch(/encumbrance_transition|cannot go from|status_fields_check/);
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(sql`update vehicles.vehicle_encumbrances
                        set status = 'released', release_reference = 'OTHER-1', released_by = kernel.ctx_user(),
                            released_at = now()
                      where id = ${pending.id}`)
                )
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
        expect((await read(pending.id)).status).toBe('release_pending');

        // a released hold changes no more: its release evidence cannot be rewritten
        expect((await confirmation(pending, as.lead)).statusCode).toBe(200);
        expect(
            await refused(
                asUnit(app, boditi, (tx) =>
                    tx.execute(
                        sql`update vehicles.vehicle_encumbrances set release_note = 'rewritten' where id = ${open.id}`
                    )
                )
            )
        ).toMatch(/encumbrance_transition|cannot go from/);
    });

    it('takes a hold on a new vehicle only open, and lets an org-unit move rewrite the scope of a released one', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'court_order', court);
        await released(e);
        const moved = await api.owner.query(
            `update vehicles.vehicle_encumbrances set recorded_org_path = recorded_org_path where id = $1`,
            [e.id]
        );
        expect(moved.rowCount).toBe(1);
        expect(
            await refused(
                api.owner.query(
                    `insert into vehicles.vehicle_encumbrances (id, vehicle_id, recorded_unit_id, kind, holder_organisation_id,
                        letter_reference, letter_date, status, release_reference, release_date, release_requested_by, release_requested_at)
                     values (gen_random_uuid(), $1, $2, 'bank_loan', $3, 'X-1', '2026-10-01', 'release_pending', 'R-1', '2026-10-02', gen_random_uuid(), now())`,
                    [id, boditi.id, bank.id]
                )
            )
        ).toMatch(/encumbrance_transition|an encumbrance is recorded open/);
    });
});

describe('the letters of a hold', () => {
    it('links the caller’s own stored upload to the hold, in the same request and on record', async () => {
        const { id } = await onTheRoad(boditi);
        const fileId = await upload(SUB.officer);
        const res = await holdWithLetter(id, fileId);
        expect(res.statusCode, res.body).toBe(201);
        const e = res.json<Encumbrance>();
        expect(e.letterFile).toEqual({ id: fileId });
        const { rows } = await api.owner.query<{ linked_table: string; linked_id: string; expires_at: Date | null }>(
            'select linked_table, linked_id, expires_at from kernel.files where id = $1',
            [fileId]
        );
        expect(rows[0]).toMatchObject({
            linked_table: 'vehicles.vehicle_encumbrances',
            linked_id: e.id,
            expires_at: null
        });
        expect(await auditOf(requestIdOf(res))).toMatchObject({
            'vehicles.vehicle_encumbrances:insert': 1,
            'kernel.files:update': 1
        });
    });

    it('refuses another person’s upload with 422, and a file already kept by another record with 409', async () => {
        const { id } = await onTheRoad(boditi);
        const theirs = await holdWithLetter(id, await upload(SUB.lead));
        expect(theirs.statusCode, theirs.body).toBe(422);
        expect(theirs.json<ProblemBody>().errors).toEqual([expect.objectContaining({ path: 'letterFileId' })]);
        const fileId = await upload(SUB.officer);
        expect((await holdWithLetter(id, fileId)).statusCode).toBe(201);
        const again = await holdWithLetter((await onTheRoad(boditi)).id, fileId);
        expect(again.statusCode, again.body).toBe(409);
        expect(again.json<ProblemBody>().code).toBe('invalid_transition');
    });

    it('gives the recording office a short link to a letter, on record, and a sibling office a 404', async () => {
        const { id } = await onTheRoad(boditi);
        const letterFile = await upload(SUB.officer);
        const e = (await holdWithLetter(id, letterFile)).json<Encumbrance>();
        const link = await api.call('POST', `/api/v1/encumbrances/${e.id}/files/${letterFile}`, as.officer);
        expect(link.statusCode, link.body).toBe(200);
        expect(link.json<{ url: string }>().url).toMatch(/^https:\/\/store\.test\//);
        const { rows } = await api.owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.audit_log where event_type = 'file.downloaded' and row_id = $1",
            [letterFile]
        );
        expect(rows[0]?.n).toBe(1);
        // a file that is not a letter of this hold is not found either
        const other = await upload(SUB.officer);
        expect((await api.call('POST', `/api/v1/encumbrances/${e.id}/files/${other}`, as.officer)).statusCode).toBe(
            404
        );
        expect(
            (await api.call('POST', `/api/v1/encumbrances/${e.id}/files/${letterFile}`, as.damotHead)).statusCode
        ).toBe(404);
    });

    it('links the release letter when the release is asked for', async () => {
        const { id } = await onTheRoad(boditi);
        const e = await recorded(id, 'bank_loan');
        const releaseFile = await upload(SUB.officer);
        const asked = await releaseRequest(e, as.officer, { releaseFileId: releaseFile });
        expect(asked.statusCode, asked.body).toBe(200);
        expect(asked.json<Encumbrance>().releaseFile).toEqual({ id: releaseFile });
        const link = await api.call('POST', `/api/v1/encumbrances/${e.id}/files/${releaseFile}`, as.lead);
        expect(link.statusCode, link.body).toBe(200);
    });
});

describe('the blocks on the services a hold conflicts with', () => {
    it.each([
        ['ownership-transfer', 'court_order'],
        ['zone-transfer-out', 'customs_hold'],
        ['replacement', 'bank_loan']
    ] as const)(
        'blocks %s while a %s is open, naming the holder, and lets it through after the release',
        async (conflict, kind) => {
            await publishChecked(conflict);
            const { id } = await onTheRoad(boditi);
            const e = await recorded(id, kind, court);
            const blocked = await filing(id);
            expect(blocked.status).toBe(422);
            expect(blocked.body.code).toBe('not_eligible');
            expect(blocked.body.detail).toMatch(/Sample Court|የናሙና ፍርድ ቤት/);
            expect(blocked.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
            expect(blocked.body.errors?.[0]?.message).toMatch(/Sample Court|የናሙና ፍርድ ቤት/);
            // a release that waits for its confirmation still blocks
            const pending = (await releaseRequest(e, as.officer)).json<Encumbrance>();
            expect((await filing(id)).status).toBe(422);
            expect((await confirmation(pending, as.lead)).statusCode).toBe(200);
            expect((await filing(id)).status).toBe(200);
        }
    );

    it('lets a kind the conflict does not name pass: a revenue hold does not stop a replacement', async () => {
        await publishChecked('replacement');
        const { id } = await onTheRoad(boditi);
        await recorded(id, 'revenue_hold');
        expect((await filing(id)).status).toBe(200);
    });

    it('names the oldest hold and how many more there are', async () => {
        await publishChecked('ownership-transfer');
        const { id } = await onTheRoad(boditi);
        await recorded(id, 'revenue_hold', bank);
        await recorded(id, 'court_order', court);
        const blocked = await filing(id);
        expect(blocked.status).toBe(422);
        expect(blocked.body.detail).toMatch(/Sample Bank|የናሙና ባንክ/);
    });

    it('stops the giving step when a hold is recorded after approval, keeps the case at its step, and gives after the release', async () => {
        await publishChecked('replacement');
        const { id } = await onTheRoad(boditi);
        const c = await atExchange(id);
        const e = await recorded(id, 'bank_loan');
        const blocked = await step(c, as.officer, { action: 'exchange', answers: {} });
        expect(blocked.statusCode, blocked.body).toBe(422);
        expect(blocked.json<ProblemBody>().errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
        expect((await caseOf(c.id)).state).toBe('exchange');
        expect(await plateGiven(id)).toBe(0);
        await released(e);
        const given = await step(await caseOf(c.id), as.officer, { action: 'exchange', answers: {} });
        expect(given.statusCode, given.body).toBe(200);
        expect(await plateGiven(id)).toBe(1);
    });

    it('stops the payment order of a request approved while the vehicle is encumbered', async () => {
        await publishChecked('replacement');
        const { id } = await onTheRoad(boditi);
        let c = await moved(await filed(id), as.officer, 'submit');
        await recorded(id, 'court_order', court);
        const blocked = await step(c, as.officer, { action: 'approve' });
        expect(blocked.statusCode, blocked.body).toBe(422);
        c = await caseOf(c.id);
        expect(c.state).toBe('review');
    });

    it('answers 409 not_configured for a conflict the setting does not know', async () => {
        await publishChecked('no-such-service');
        const { id } = await onTheRoad(boditi);
        const c = await filed(id);
        const res = await step(c, as.officer, { action: 'submit' });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json<ProblemBody>().code).toBe('not_configured');
    });

    it('never both blocks and gives: a hold recorded while the plate is being given either stops it or follows it', async () => {
        await publishChecked('replacement');
        for (let round = 0; round < 5; round += 1) {
            const { id } = await onTheRoad(boditi);
            const c = await atExchange(id);
            const [recordedNow, giving] = await Promise.all([
                hold(id, 'bank_loan'),
                step(c, as.officer, { action: 'exchange', answers: {} })
            ]);
            expect(recordedNow.statusCode, recordedNow.body).toBe(201);
            if (giving.statusCode === 200) {
                expect(await plateGiven(id)).toBe(1);
            } else {
                expect(giving.statusCode, giving.body).toBe(422);
                expect(await plateGiven(id)).toBe(0);
                expect((await caseOf(c.id)).state).toBe('exchange');
            }
        }
    });

    it('follows a region’s own matrix: a region that lets a bank loan pass a replacement', async () => {
        await publishChecked('replacement');
        const { id } = await onTheRoad(boditi);
        await recorded(id, 'bank_loan');
        expect((await filing(id)).status).toBe(422);
        // the region's own value, on the version it has
        const settings = (await api.call('GET', `/api/v1/org-units/${region.id}/settings`, as.bureau)).json<{
            settings: { key: string; own: { version: number } | null }[];
        }>().settings;
        const own = settings.find((s) => s.key === ENCUMBRANCE_BLOCKS_SETTING)?.own;
        // the floor: no region lets a court order pass a change of owner
        const lowered = await api.call(
            'PUT',
            `/api/v1/org-units/${region.id}/settings/${ENCUMBRANCE_BLOCKS_SETTING}`,
            as.bureau,
            { value: { ...DEFAULT_ENCUMBRANCE_BLOCKS, 'ownership-transfer': ['bank_loan'] } },
            { 'if-match': `"${own?.version ?? 0}"` }
        );
        expect(lowered.statusCode, lowered.body).toBe(422);
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${region.id}/settings/${ENCUMBRANCE_BLOCKS_SETTING}`,
            as.bureau,
            { value: { ...DEFAULT_ENCUMBRANCE_BLOCKS, replacement: ['court_order'] } },
            // a new value is version 0
            { 'if-match': `"${own?.version ?? 0}"` }
        );
        expect(set.statusCode, set.body).toBe(200);
        expect((await filing(id)).status).toBe(200);
    });
});

describe('where a hold shows', () => {
    it('is on the summaries of the search, the record and the lookup, and gone after its release', async () => {
        const { id, plate } = await onTheRoad(boditi);
        const e = await recorded(id, 'court_order', court);
        const found = await api.call('GET', `/api/v1/vehicles?q=${encodeURIComponent(plate)}`, as.damotHead);
        const item = found.json<{ items: VehicleSummary[] }>().items.find((v) => v.id === id);
        expect(item?.encumbrances).toMatchObject([
            { id: e.id, kind: 'court_order', status: 'open', holder: { id: court.id }, recordedUnit: { id: boditi.id } }
        ]);
        const record = (await api.call('GET', `/api/v1/vehicles/${id}`, as.damotHead)).json<Vehicle>();
        expect(record.encumbrances).toHaveLength(1);
        const lookup = await api.call(
            'GET',
            `/api/v1/registry-lookups/vehicle?q=${encodeURIComponent(plate)}`,
            as.officer
        );
        const facts = lookup.json<{ items: { id: string; facts: { key: string; value: string | null }[] }[] }>().items;
        const value = facts.find((i) => i.id === id)?.facts.find((f) => f.key === 'encumbrances')?.value ?? '';
        expect(value).toMatch(/Court order: (Sample Court|የናሙና ፍርድ ቤት)|የፍርድ ቤት እግድ: (Sample Court|የናሙና ፍርድ ቤት)/);
        await released(e);
        const after = (await api.call('GET', `/api/v1/vehicles/${id}`, as.damotHead)).json<Vehicle>();
        expect(after.encumbrances).toEqual([]);
        const list = await api.call('GET', `/api/v1/encumbrances?vehicleId=${id}`, as.damotHead);
        expect(list.json<{ items: Encumbrance[] }>().items).toMatchObject([{ id: e.id, status: 'released' }]);
    });

    it('lists the office’s own subtree without a vehicle, and not another office’s holds', async () => {
        const mine = await recorded((await onTheRoad(boditi)).id, 'bank_loan');
        const zoneList = await api.call('GET', '/api/v1/encumbrances?limit=100', as.zoneHead);
        expect(zoneList.statusCode, zoneList.body).toBe(200);
        expect(zoneList.json<{ items: Encumbrance[] }>().items.map((x) => x.id)).toContain(mine.id);
        const sibling = await api.call('GET', '/api/v1/encumbrances?limit=100', as.damotHead);
        expect(sibling.json<{ items: Encumbrance[] }>().items.map((x) => x.id)).not.toContain(mine.id);
        const pending = await api.call('GET', '/api/v1/encumbrances?status=release_pending', as.officer);
        expect(pending.json<{ items: Encumbrance[] }>().items.every((x) => x.status === 'release_pending')).toBe(true);
    });
});

describe('the isolation matrix of the holds (class R at the recording office)', () => {
    const CASE_UNITS = () => ({
        own: zone,
        child: boditi,
        parent: region,
        sibling: tzb,
        otherZone: tzbW1,
        otherRegion: trx
    });

    beforeAll(async () => {
        const serVehicle = (await onTheRoad(boditi)).id;
        const trxVehicle = (await onTheRoad(trx, trxOwner)).id;
        for (const c of ISOLATION_CASES) {
            const unit = CASE_UNITS()[c];
            await api.owner.query(
                `insert into vehicles.vehicle_encumbrances (id, region_id, vehicle_id, recorded_unit_id, kind, holder_organisation_id, letter_reference, letter_date)
                 values (gen_random_uuid(), $1, $2, $3, 'court_order', $4, $5, '2026-10-01')`,
                [
                    unit.regionId,
                    unit.regionId === trx.regionId ? trxVehicle : serVehicle,
                    unit.id,
                    bank.id,
                    `MATRIX-${c}`
                ]
            );
        }
    }, 120_000);

    const caseOfLetter = (reference: string) => ISOLATION_CASES.find((c) => `MATRIX-${c}` === reference);

    it('shows the acting unit exactly the rows its class allows', async () => {
        const seen = await asUnit(app, zone, async (tx) =>
            (
                await tx.execute<{ r: string }>(
                    sql`select letter_reference as r from vehicles.vehicle_encumbrances where letter_reference like 'MATRIX-%'`
                )
            ).rows.map((r) => caseOfLetter(r.r))
        );
        expect([...new Set(seen)].sort()).toEqual([...VISIBLE.registry].sort());
    });

    it.each(ISOLATION_CASES)('lets the acting unit change the %s hold only where class R allows it', async (c) => {
        const changed = await asUnit(app, zone, (tx) =>
            tx.execute(
                sql`update vehicles.vehicle_encumbrances set updated_at = now() where letter_reference = ${`MATRIX-${c}`}`
            )
        );
        expect(changed.rowCount).toBe(WRITABLE.registry.includes(c) ? 1 : 0);
    });

    it('shows nothing without a context, on a connection that has just served one', async () => {
        const one = createDatabase(pg.url('app'), { max: 1, contextKey: TEST_CONTEXT_KEY });
        try {
            await asUnit(one, zone, (tx) => tx.execute(sql`select count(*) from vehicles.vehicle_encumbrances`));
            const seen = await one.scoped({}, (tx) =>
                tx.execute<{ n: string }>(sql`select count(*) as n from vehicles.vehicle_encumbrances`)
            );
            expect(seen.rows[0]?.n).toBe('0');
        } finally {
            await one.close();
        }
    });
});
