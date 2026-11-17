/**
 * The ownership transfer as it is seeded (task 1.4b, DVC-13), run end to end through the API on a real PostgreSQL 16 with the Wolaita
 * seeds: a Boditi vehicle is sold, filed at the counter with its buyers, checked, valued by an inspector, the letters written to the
 * other offices, the papers recorded, paid at the till, approved by the lead and transferred: the owners change in the register, the
 * old libre is cancelled and its certificate revoked, and the buyers' libre is issued and written in a booklet. The kinds of
 * acquisition, the block a pending transfer puts on the vehicle, the holds that stop it, the maker-checker, an owner change under the
 * case's feet, a step run twice, the numbers' counters and the tenant isolation. Names, chassis numbers and plates are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daysAfter, OwnershipTransferService } from '@itrms/competency/api';
import {
    importOwnershipTransferService,
    importPlateExchangeService,
    importVehicleServices,
    ownershipTransferFlow,
    setUpTransferLetterCounters
} from '@itrms/competency/seed';
import { DocumentsService } from '@itrms/documents/api';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { StationeryStock } from '@itrms/fees/api';
import { importFeeRules, importStationeryDemo, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { VehicleRegistry } from '@itrms/vehicles/api';
import { vinCheckDigit, type Vehicle } from '@itrms/vehicles/contracts';
import { importVehicleCategories, setUpRegistrationCertificateCounters } from '@itrms/vehicles/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    cashier: '0199f0a0-d000-7000-8000-000000000303',
    // the demo's own: the zone's competency officer, and Damot Gale's head
    zoneOfficer: '0199f0a0-d000-7000-8000-000000000104',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    officer: '0199f0a0-d000-7000-8000-00000000f701',
    inspector: '0199f0a0-d000-7000-8000-00000000f702',
    lead: '0199f0a0-d000-7000-8000-00000000f703',
    // an officer who is also the office's inspector and lead: the maker-checker has to keep them off their own work
    solo: '0199f0a0-d000-7000-8000-00000000f704',
    otherRegionClerk: '0199f0a0-d000-7000-8000-00000000f706'
};
const SERVICE = 'DVC-13';
const EXCHANGE = 'DVC-12';
const REGISTRATION = 'DVC-01';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let documents: DocumentsService;
let transfers: OwnershipTransferService;
let boditi: OrgUnit;
let otherRegion: OrgUnit;
let zone: OrgUnit;
let damot: OrgUnit;
let seller: string;
let bank: { id: string };
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

const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');

/** A person on the register, made as an officer would: the names are generated, and Latin letters only in English. */
async function person(who: As = as.officer): Promise<string> {
    serial += 1;
    const res = await api.call('POST', '/api/v1/persons', who, {
        nameAm: { given: 'ባለቤት', father: `ዝውውር${lettersOf(serial, ETHIOPIC)}`, grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: `Transfer${lettersOf(serial, LATIN)}`, grandfather: 'Person' },
        sex: 'male',
        birthYear: 1980,
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

/**
 * A vehicle of `unit` on an old regional plate with its libre in force and the certificate that goes with it, registered straight
 * in the register as a seed would.
 */
async function onTheRoad(unit: OrgUnit, use: 'private' | 'commercial' = 'private', ownerId = seller) {
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    const plate = `SN 2-${String(randomInt(10000, 99999))}`;
    const chassis = vin();
    return app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: chassis,
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2010,
            categoryKey: 'automobile',
            use,
            seats: 5,
            firstRegisteredOn: '2011-03-01',
            owners: [{ kind: 'person', id: ownerId }]
        });
        await registry.recordPlate(tx, ctx, vehicle.id, { text: plate, source: 'legacy', since: '2011-03-01' });
        await registry.recordLibre(tx, ctx, vehicle.id, { issuedOn: '2011-03-01' });
        const [libre] = (
            await tx.execute<{ id: string }>(sql`select id from vehicles.libres where vehicle_id = ${vehicle.id}`)
        ).rows;
        const certificate = await documents.reissue(tx, {
            regionId: unit.regionId,
            handlingUnitId: unit.id,
            templateKey: 'vehicle-registration-certificate',
            language: 'am',
            number: `${unit.code}/RC/9${String(randomInt(10000, 99999))}`,
            subject: { table: 'vehicles.libres', id: libre?.id ?? '' },
            data: {
                number: `${unit.code}/RC/9${String(randomInt(10000, 99999))}`,
                issuedOn: '2011-03-01',
                firstRegisteredOn: '2011-03-01',
                plate,
                federalVehicleId: null,
                owners: [{ name: 'Sample Seller', address: null }],
                category: { am: 'አውቶሞቢል', en: 'Automobile' },
                make: 'Toyota',
                model: 'Corolla',
                modelYear: 2010,
                madeIn: null,
                chassisNumber: chassis,
                engineNumber: null,
                engineCc: null,
                engineHp: null,
                cylinders: null,
                fuel: null,
                colour: null,
                lengthMm: null,
                widthMm: null,
                heightMm: null,
                tyreSize: null,
                tyres: null,
                grossWeightKg: null,
                netWeightKg: null,
                seats: 5,
                loadCapacityKg: null,
                use: { am: 'የግል', en: 'Private' },
                boloNumber: null,
                bookletSerial: null,
                nationalReference: null
            }
        });
        return { id: vehicle.id, plate, chassis, libreId: libre?.id ?? '', certificateId: certificate.id };
    });
}

// ---- cases

interface ProblemBody {
    code?: string;
    detail?: string;
    errors?: { path: string; code: string; message: string }[];
}

const answersOf = (vehicle: string, buyers: string[], acquiredBy = 'sale') => ({
    vehicle,
    owners: buyers.map((b) => ({ ownerPerson: b })),
    acquiredBy
});

async function file(service: string, answers: Record<string, unknown>, who: As = as.officer): Promise<CaseOut> {
    const shown = await api.call('POST', '/api/v1/fees/preview', who, { serviceCode: service, answers });
    expect(shown.statusCode, shown.body).toBe(200);
    const fee = shown.json<{ feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', who, {
        serviceCode: service,
        answers,
        fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim }
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

/** The status and the problem of a step that is refused (or its case, if it is not). */
async function tried(c: CaseOut, who: As, action: string, answers?: object) {
    const res = await step(c, who, {
        action,
        ...(answers ? { answers } : {}),
        ...(action === 'reject' ? { comment: 'Test over' } : {})
    });
    return { status: res.statusCode, body: res.json<ProblemBody>(), res };
}

async function paid(c: CaseOut): Promise<void> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.cashier);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call(
        'POST',
        `/api/v1/payment-orders/${id}/payments`,
        as.cashier,
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Buyer' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
}

const VALUATION = {
    inspectionMatches: true,
    inspectionNote: 'As the paper form says.',
    purchasePriceBirr: 300000,
    marketValueBirr: 360000,
    contractValueBirr: 320000,
    depreciationPercent: 12.5,
    committeeValueBirr: 350000,
    valuers: 'Sample valuation committee'
};
const LETTERS = { justiceOffice: 'Sample Justice Office', revenueOffice: 'Sample Revenue Office' };
const evidence = (more: object = {}) => ({
    contractReference: 'CT-1234',
    contractAuthenticatedOn: today(),
    stampDutyReceipt: 'SD-1234',
    stampDutyPaidOn: today(),
    ...more
});

const STAGES = [
    'draft',
    'review',
    'valuation',
    'letters',
    'outside',
    'approval',
    'transfer',
    'booklet',
    'transferred'
] as const;
type Stage = (typeof STAGES)[number];

interface Drive {
    vehicle?: Awaited<ReturnType<typeof onTheRoad>>;
    buyers?: string[];
    acquiredBy?: string;
    use?: 'private' | 'commercial';
    letters?: object;
    papers?: object;
    filer?: As;
    reviewer?: As;
}

/** A transfer filed and taken, step by step as its roles do, to `to`: the case there, and the vehicle and buyers it is for. */
async function drive(to: Stage, o: Drive = {}) {
    const vehicle = o.vehicle ?? (await onTheRoad(boditi, o.use ?? 'private'));
    const buyers = o.buyers ?? [await person()];
    const upTo = (stage: Stage) => STAGES.indexOf(to) >= STAGES.indexOf(stage);
    let c = await file(SERVICE, answersOf(vehicle.id, buyers, o.acquiredBy), o.filer ?? as.officer);
    if (upTo('review')) c = await moved(c, o.filer ?? as.officer, 'submit');
    if (upTo('valuation')) c = await moved(c, o.reviewer ?? as.officer, 'approve');
    if (upTo('letters')) c = await moved(c, as.inspector, 'value', { answers: VALUATION });
    if (upTo('outside')) c = await moved(c, as.officer, 'issue_letters', { answers: o.letters ?? LETTERS });
    if (upTo('approval')) {
        c = await moved(c, as.officer, 'approve', { answers: o.papers ?? evidence() });
        expect(c.state).toBe('payment');
        await paid(c);
        c = await caseOf(c.id);
        expect(c.state).toBe('approval');
    }
    if (upTo('transfer')) c = await moved(c, as.lead, 'approve');
    if (upTo('booklet')) c = await moved(c, as.officer, 'transfer');
    if (upTo('transferred')) c = await moved(c, as.officer, 'issue_booklet', { answers: {} });
    expect(c.state).toBe(to);
    return { c, vehicle, buyers };
}

// ---- what the database says

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

const periodsOf = (vehicleId: string) =>
    query<{ id: string; since: string; until: string | null; acquired_by: string; case_id: string | null }>(
        `select id, since::text, until::text, acquired_by, case_id from vehicles.vehicle_ownerships
          where vehicle_id = $1 order by since`,
        [vehicleId]
    );
const holdersOf = async (periodId: string) =>
    (
        await query<{ person_id: string }>(
            'select person_id from vehicles.vehicle_owners where ownership_id = $1 order by ordinal',
            [periodId]
        )
    ).map((r) => r.person_id);
const libresOf = (vehicleId: string) =>
    query<{
        id: string;
        number: string | null;
        status: string;
        replaces_id: string | null;
        ownership_id: string;
        case_id: string | null;
    }>(
        `select id, number, status, replaces_id, ownership_id, case_id from vehicles.libres
          where vehicle_id = $1 order by issued_on, created_at`,
        [vehicleId]
    );
const lettersOf2 = (caseId: string) =>
    query<{
        key: string;
        number: string;
        valid_until: string;
        revoked_at: string | null;
        revoke_reason: string | null;
        data: Record<string, unknown>;
    }>(
        `select t.key, d.number, d.valid_until::text, d.revoked_at, d.revoke_reason, d.data
           from documents.issued_documents d join documents.document_templates t on t.id = d.template_id
          where d.case_id = $1 and t.key like 'vehicle-transfer-%' and d.superseded_by is null order by t.key`,
        [caseId]
    );
const documentsOfLibre = (libreId: string) =>
    query<{
        id: string;
        key: string;
        revoked_at: string | null;
        revoke_reason: string | null;
        superseded_by: string | null;
        data: { owners: { name: string }[]; bookletSerial: string | null };
    }>(
        `select d.id, t.key, d.revoked_at, d.revoke_reason, d.superseded_by, d.data
           from documents.issued_documents d join documents.document_templates t on t.id = d.template_id
          where d.subject_id = $1 order by d.created_at`,
        [libreId]
    );
const transferOf = async (caseId: string) =>
    (
        await query<Record<string, string | boolean | null>>(
            // the dates as the day they are (pg gives a date column as a Date at local midnight)
            `select t.*, t.valued_on::text as valued_on, t.letters_issued_on::text as letters_issued_on,
                    t.contract_authenticated_on::text as contract_authenticated_on,
                    t.stamp_duty_paid_on::text as stamp_duty_paid_on, t.transferred_on::text as transferred_on
               from competency.ownership_transfers t where t.case_id = $1`,
            [caseId]
        )
    )[0];
const factsOf = async (id: string) =>
    (await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [id]))[0]
        ?.facts ?? {};
const bookletsAtBoditi = async () =>
    (
        await query<{ item_key: string }>(
            `select item_key from fees.stationery_items
              where holder_unit_id = $1 and kind = 'libre_booklet' and status = 'in_stock' order by series, serial`,
            [boditi.id]
        )
    ).map((r) => r.item_key);

async function auditOf(requestId: string): Promise<Record<string, number>> {
    const rows = await query<{ line: string; n: number }>(
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

const letter = () => `LTR-${randomInt(100000, 999999)}`;
const hold = (vehicleId: string, who = as.officer) =>
    api.call('POST', '/api/v1/encumbrances', who, {
        vehicleId,
        kind: 'bank_loan',
        holderOrganisationId: bank.id,
        letterReference: letter(),
        letterDate: '2026-10-01'
    });

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.otr.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.otr.inspector',
            sub: SUB.inspector,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.inspector']]
        },
        {
            username: 'test.otr.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.otr.solo',
            sub: SUB.solo,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'competency.inspector'],
                ['WOL-BODITI', 'competency.lead'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.otr.other',
            sub: SUB.otherRegionClerk,
            region: 'TRX',
            home: 'TRX-W1',
            roles: [['TRX-W1', 'records_officer']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    documents = api.http.get(DocumentsService);
    transfers = api.http.get(OwnershipTransferService);
    const region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    otherRegion = await api.unit('TRX', 'TRX-W1');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.cashier = { sub: SUB.cashier, unit: boditi };
    as.zoneOfficer = { sub: SUB.zoneOfficer, unit: zone };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.inspector = { sub: SUB.inspector, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.solo = { sub: SUB.solo, unit: boditi };
    as.otherRegionClerk = { sub: SUB.otherRegionClerk, unit: otherRegion };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        await importVehicleServices(tx, root);
        await importPlateExchangeService(tx, root);
        expect(await importOwnershipTransferService(tx, root)).toBe(1);
        expect(await setUpTransferLetterCounters(tx, root.regionId)).toBeGreaterThan(0);
    });
    // Boditi holds libre booklets handed down from the zone (the demo's stationery)
    expect(await importStationeryDemo(api.installer, 'SER', api.http.get(StationeryStock), today())).not.toBeNull();
    seller = await person();
    const organisation = await api.call('POST', '/api/v1/organisations', as.officer, {
        kind: 'bank',
        name: { am: 'የናሙና ባንክ', en: 'Sample Bank' }
    });
    expect(organisation.statusCode, organisation.body).toBe(201);
    bank = organisation.json<{ id: string }>();
}, 300_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('what is seeded', () => {
    it('stays as it is when seeded again, with the letters’ counters at the offices that offer it', async () => {
        const region = await api.unit('SER', 'SER');
        expect(
            await api.installer.scoped({}, (tx) =>
                importOwnershipTransferService(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
        const counters = await query<{ unit_id: string; pattern: string }>(
            `select unit_id, pattern from kernel.number_counters where key = 'competency.transfer-letter'`
        );
        expect(counters.map((c) => c.unit_id)).toContain(boditi.id);
        expect(counters.every((c) => c.pattern === '{unit}/OT/{seq:05}/{efy}')).toBe(true);
    });

    it('passes the checks a bureau’s own versions would meet', async () => {
        const [current] = await query<{ form: string; flow: string; fee: string }>(
            `select v.form_version_id as form, v.workflow_version_id as flow, v.fee_rule_version_id as fee
               from services.service_definitions d join services.service_versions v on v.id = d.current_version_id
              where d.code = 'DVC-13'`
        );
        const published = await api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, {
            workflowVersionId: current?.flow,
            formVersionId: current?.form,
            feeRuleVersionId: current?.fee,
            defaults: { approval_unit: 'handling' },
            overridePolicy: { approval_unit: ['region', 'unit'], sla: ['region', 'unit'] }
        });
        expect(published.statusCode, published.body).toBe(201);
        const flow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'checked-ownership-transfer',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: ownershipTransferFlow(
                'vehicle-transfer-valuation@1',
                'vehicle-transfer-letters@1',
                'vehicle-transfer-evidence@1',
                'vehicle-libre-booklet@1'
            )
        });
        expect(flow.statusCode, flow.body).toBe(201);
    });

    it('charges the zone’s fee sheet: the name change and the new libre, in santim (demo amounts)', async () => {
        const vehicle = await onTheRoad(boditi);
        const shown = await api.call('POST', '/api/v1/fees/preview', as.officer, {
            serviceCode: SERVICE,
            answers: answersOf(vehicle.id, [seller])
        });
        expect(shown.statusCode, shown.body).toBe(200);
        expect(shown.json<{ totalSantim: string; lines: { key: string; amountSantim: string }[] }>()).toMatchObject({
            totalSantim: '300000',
            lines: [
                { key: 'transfer', amountSantim: '100000' },
                { key: 'libre', amountSantim: '200000' }
            ]
        });
    });
});

describe('a vehicle sold, through the booklet', () => {
    it('moves the owners, cancels the old libre and revokes its certificate, and issues the new libre and certificate', async () => {
        const buyer = await person();
        const { c: atTransfer, vehicle } = await drive('transfer', { buyers: [buyer] });
        const [sellerPeriod] = await periodsOf(vehicle.id);
        const before = await transferOf(atTransfer.id);
        // the valuation and the papers, in whole santim; nothing computed from them
        expect(before).toMatchObject({
            acquired_by: 'sale',
            code3: false,
            purchase_price_santim: '30000000',
            market_value_santim: '36000000',
            contract_value_santim: '32000000',
            committee_value_santim: '35000000',
            depreciation_percent: '12.50',
            stamp_duty_receipt: 'SD-1234',
            contract_reference: 'CT-1234',
            seller_ownership_id: sellerPeriod?.id,
            transferred_on: null
        });

        const transferring = await step(atTransfer, as.officer, { action: 'transfer' });
        expect(transferring.statusCode, transferring.body).toBe(200);
        const booklet = transferring.json<CaseOut>();
        expect(booklet.state).toBe('booklet');

        // the owners: the sellers' period ends today, the buyers' begins today and names the case
        const periods = await periodsOf(vehicle.id);
        expect(periods).toHaveLength(2);
        expect(periods[0]).toMatchObject({ until: today() });
        expect(periods[1]).toMatchObject({ since: today(), until: null, acquired_by: 'sale', case_id: atTransfer.id });
        expect(await holdersOf(periods[1]?.id ?? '')).toEqual([buyer]);
        const record = (await api.call('GET', `/api/v1/vehicles/${vehicle.id}`, as.officer)).json<Vehicle>();
        expect(record.owners.map((o) => o.id)).toEqual([buyer]);

        // the libre: the old one cancelled, the new one for the buyers' period with no number yet, pointing at the old
        const libres = await libresOf(vehicle.id);
        expect(libres.find((l) => l.id === vehicle.libreId)?.status).toBe('cancelled');
        const fresh = libres.find((l) => l.id !== vehicle.libreId);
        expect(fresh).toMatchObject({
            status: 'issued',
            number: null,
            replaces_id: vehicle.libreId,
            ownership_id: periods[1]?.id,
            case_id: atTransfer.id
        });

        // the old certificate says it no longer holds; a new one names the buyers
        const [old] = await documentsOfLibre(vehicle.libreId);
        expect(old).toMatchObject({ revoke_reason: 'libre_ownership_transferred' });
        expect(old?.revoked_at).not.toBeNull();
        const [certificate] = await documentsOfLibre(fresh?.id ?? '');
        expect(certificate?.revoked_at).toBeNull();
        expect(certificate?.data.owners).toHaveLength(1);
        expect(certificate?.data.bookletSerial).toBeNull();

        const after = await transferOf(atTransfer.id);
        expect(after).toMatchObject({
            transferred_on: today(),
            buyer_ownership_id: periods[1]?.id,
            cancelled_libre_id: vehicle.libreId,
            new_libre_id: fresh?.id
        });
        expect(await auditOf(requestIdOf(transferring))).toMatchObject({
            'vehicles.vehicle_ownerships:update': 1,
            'vehicles.vehicle_ownerships:insert': 1,
            'vehicles.vehicle_owners:insert': 1,
            'vehicles.libres:update': 1,
            'vehicles.libres:insert': 1,
            'documents.issued_documents:insert': 1,
            'documents.issued_documents:update': 1,
            'competency.ownership_transfers:update': 1
        });

        // the booklet: the office's next one, written on the new libre; the certificate names it
        const [next] = await bookletsAtBoditi();
        const done = await step(booklet, as.officer, { action: 'issue_booklet', answers: {} });
        expect(done.statusCode, done.body).toBe(200);
        expect(done.json<CaseOut>().state).toBe('transferred');
        expect((await libresOf(vehicle.id)).find((l) => l.id === fresh?.id)?.number).toBe(next);
        const [first, current] = await documentsOfLibre(fresh?.id ?? '');
        expect(first?.superseded_by).toBe(current?.id);
        expect(current?.data.bookletSerial).toBe(next);
    }, 300_000);

    it('writes the revenue and the justice letters, numbered from the office’s counter, with the committee’s value in santim', async () => {
        const { c, buyers } = await drive('outside');
        const letters = await lettersOf2(c.id);
        expect(letters.map((l) => l.key)).toEqual([
            'vehicle-transfer-justice-letter',
            'vehicle-transfer-revenue-letter'
        ]);
        for (const l of letters) {
            expect(l.number).toMatch(/\/OT\/\d{5}\/\d{4}$/);
            expect(l.valid_until).toBe(daysAfter(today(), 30));
            expect(l.revoked_at).toBeNull();
            expect(l.data).toMatchObject({ caseNumber: c.number });
            expect(l.data.buyers).toHaveLength(1);
        }
        const [justice, revenue] = letters;
        expect(justice?.data).toMatchObject({ kind: 'justice', addressee: 'Sample Justice Office', valuation: null });
        expect(revenue?.data).toMatchObject({
            kind: 'revenue',
            addressee: 'Sample Revenue Office',
            valuation: {
                committeeValueSantim: '35000000',
                purchasePriceSantim: '30000000',
                marketValueSantim: '36000000',
                contractValueSantim: '32000000',
                depreciationPercent: '12.50'
            }
        });
        expect(buyers).toHaveLength(1);
        expect((await transferOf(c.id))?.letters_issued_on).toBe(today());
    }, 240_000);

    it('gives one libre and one certificate when its step runs twice', async () => {
        const { c, vehicle } = await drive('booklet');
        const facts = await factsOf(c.id);
        const ctx: DbContext = { ...contextFor(boditi), requestId: `otr-${randomUUID()}` };
        const place = { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx };
        const again = await app.scoped(ctx, (tx) =>
            transfers.transfer(tx, place, facts, 'vehicle-registration-certificate')
        );
        const libres = await libresOf(vehicle.id);
        expect(libres.filter((l) => l.case_id === c.id)).toHaveLength(1);
        expect(again.libre.id).toBe(libres.find((l) => l.case_id === c.id)?.id);
        expect(await documentsOfLibre(again.libre.id)).toHaveLength(1);
        expect(await periodsOf(vehicle.id)).toHaveLength(2);
        // the letters step run again returns its letters; the valuation run again keeps one row
        const letters = await app.scoped(ctx, (tx) => transfers.issueLetters(tx, place, facts, LETTERS, c.number));
        expect(Object.keys(letters.documents).length).toBeGreaterThanOrEqual(2);
        expect(await lettersOf2(c.id)).toHaveLength(2);
        expect(
            (
                await query<{ n: number }>(
                    'select count(*)::int as n from competency.ownership_transfers where case_id = $1',
                    [c.id]
                )
            )[0]?.n
        ).toBe(1);
    }, 300_000);
});

describe('the kinds of acquisition and the offices’ letters', () => {
    it('writes three letters for a commercial vehicle (code 3), and asks for the tax office and its registration', async () => {
        const { c } = await drive('letters', { use: 'commercial' });
        const noTax = await tried(c, as.officer, 'issue_letters', LETTERS);
        expect(noTax.status).toBe(422);
        expect(noTax.body.errors).toEqual([expect.objectContaining({ path: 'taxOffice' })]);
        const lettered = await moved(c, as.officer, 'issue_letters', {
            answers: { ...LETTERS, taxOffice: 'Sample Tax Office' }
        });
        expect((await lettersOf2(c.id)).map((l) => l.key)).toEqual([
            'vehicle-transfer-justice-letter',
            'vehicle-transfer-revenue-letter',
            'vehicle-transfer-tax-letter'
        ]);
        const noRegistration = await tried(lettered, as.officer, 'approve', evidence());
        expect(noRegistration.status).toBe(422);
        expect(noRegistration.body.errors).toEqual([expect.objectContaining({ path: 'taxRegistrationReference' })]);
        const recorded = await moved(lettered, as.officer, 'approve', {
            answers: evidence({ taxRegistrationReference: 'TIN-REG-1' })
        });
        expect(recorded.state).toBe('payment');
        expect(await transferOf(c.id)).toMatchObject({ code3: true, tax_registration_reference: 'TIN-REG-1' });
    }, 240_000);

    it('writes no justice letter for an inheritance, and asks for the court’s reference', async () => {
        const { c } = await drive('outside', {
            acquiredBy: 'inheritance',
            letters: { revenueOffice: 'Sample Revenue Office' }
        });
        expect((await lettersOf2(c.id)).map((l) => l.key)).toEqual(['vehicle-transfer-revenue-letter']);
        const none = await tried(c, as.officer, 'approve', evidence());
        expect(none.status).toBe(422);
        expect(none.body.errors).toEqual([expect.objectContaining({ path: 'courtReference' })]);
        const recorded = await moved(c, as.officer, 'approve', { answers: evidence({ courtReference: 'COURT-77' }) });
        expect(recorded.state).toBe('payment');
        expect(await transferOf(c.id)).toMatchObject({ acquired_by: 'inheritance', court_reference: 'COURT-77' });
    }, 240_000);

    it('asks a sale for its justice office and its authenticated contract, and refuses a day that cannot be', async () => {
        const { c } = await drive('letters');
        const noJustice = await tried(c, as.officer, 'issue_letters', { revenueOffice: 'Sample Revenue Office' });
        expect(noJustice.status).toBe(422);
        expect(noJustice.body.errors).toEqual([expect.objectContaining({ path: 'justiceOffice' })]);
        const lettered = await moved(c, as.officer, 'issue_letters', { answers: LETTERS });
        const noContract = await tried(lettered, as.officer, 'approve', evidence({ contractReference: undefined }));
        expect(noContract.status).toBe(422);
        expect(noContract.body.errors).toEqual([expect.objectContaining({ path: 'contractReference' })]);
        for (const [path, day] of [
            ['stampDutyPaidOn', '2999-01-01'],
            ['contractAuthenticatedOn', '2020-01-01']
        ] as const) {
            const refused = await tried(lettered, as.officer, 'approve', evidence({ [path]: day }));
            expect(refused.status, `${path} ${day}`).toBe(422);
            expect(refused.body.errors).toEqual([expect.objectContaining({ path })]);
        }
        expect((await caseOf(c.id)).state).toBe('outside');
    }, 240_000);

    it('refuses a valuation of a vehicle that is not as its paper inspection says, and a value that is no whole Birr in range', async () => {
        const { c } = await drive('valuation');
        const notMatching = await tried(c, as.inspector, 'value', { ...VALUATION, inspectionMatches: false });
        expect(notMatching.status).toBe(422);
        for (const committeeValueBirr of [0, 10_000_000_001, 350000.5]) {
            const refused = await tried(c, as.inspector, 'value', { ...VALUATION, committeeValueBirr });
            expect(refused.status, `${committeeValueBirr}`).toBe(422);
        }
        // the figures are the committee’s: a fraction of a Birr is not kept
        const fraction = await tried(c, as.inspector, 'value', { ...VALUATION, purchasePriceBirr: 300000.25 });
        expect(fraction.status).toBe(422);
        expect(fraction.body.errors).toEqual([expect.objectContaining({ path: 'purchasePriceBirr' })]);
        expect((await caseOf(c.id)).state).toBe('valuation');
    }, 240_000);
});

describe('the block a pending transfer puts on its vehicle', () => {
    it('refuses a plate exchange and a second transfer while it is open, and lets both through once it is rejected', async () => {
        const vehicle = await onTheRoad(boditi);
        const buyer = await person();
        const first = await moved(await file(SERVICE, answersOf(vehicle.id, [buyer])), as.officer, 'submit');
        expect(await factsOf(first.id)).toMatchObject({ transfer: { vehicleId: vehicle.id } });

        const exchange = await file(EXCHANGE, { vehicle: vehicle.id, use: 'private' });
        const exchangeRefused = await tried(exchange, as.officer, 'submit');
        expect(exchangeRefused.status).toBe(422);
        expect(exchangeRefused.body.code).toBe('not_eligible');
        const second = await file(SERVICE, answersOf(vehicle.id, [await person()]));
        const secondRefused = await tried(second, as.officer, 'submit');
        expect(secondRefused.status).toBe(422);
        expect(secondRefused.body.code).toBe('not_eligible');

        // a rejection closes it: the vehicle is free again, and the letters written for it no longer stand
        const rejected = await moved(first, as.officer, 'reject', { comment: 'The buyers did not come.' });
        expect(rejected.state).toBe('rejected');
        expect((await moved(second, as.officer, 'submit')).state).toBe('review');
    }, 240_000);

    it('refuses a transfer while a plate exchange of the vehicle is open, and lets a hold be recorded on a vehicle with a pending transfer', async () => {
        const vehicle = await onTheRoad(boditi);
        const exchange = await moved(
            await file(EXCHANGE, { vehicle: vehicle.id, use: 'private' }),
            as.officer,
            'submit'
        );
        const refused = await tried(await file(SERVICE, answersOf(vehicle.id, [await person()])), as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.code).toBe('not_eligible');
        await moved(exchange, as.officer, 'reject', { comment: 'Test over' });
        // a hold may be recorded on a vehicle with a pending transfer: the check before each step is what stops the case
        const other = await onTheRoad(boditi);
        const pending = await moved(await file(SERVICE, answersOf(other.id, [await person()])), as.officer, 'submit');
        expect((await hold(other.id)).statusCode).toBe(201);
        expect(pending.state).toBe('review');
    }, 240_000);

    it('revokes the letters of a rejected case', async () => {
        const { c } = await drive('outside');
        const rejected = await moved(c, as.officer, 'reject', { comment: 'The buyers did not come.' });
        expect(rejected.state).toBe('rejected');
        const letters = await lettersOf2(c.id);
        expect(letters).toHaveLength(2);
        for (const l of letters) expect(l).toMatchObject({ revoke_reason: 'transfer_case_rejected' });
    }, 240_000);
});

describe('the holds that stop a transfer', () => {
    it('refuses the filing while a hold is open, naming the holder', async () => {
        const vehicle = await onTheRoad(boditi);
        expect((await hold(vehicle.id)).statusCode).toBe(201);
        const c = await file(SERVICE, answersOf(vehicle.id, [await person()]));
        const blocked = await tried(c, as.officer, 'submit');
        expect(blocked.status).toBe(422);
        expect(blocked.body.code).toBe('not_eligible');
        expect(blocked.body.detail).toMatch(/Sample Bank|የናሙና ባንክ/);
        expect(blocked.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
    }, 120_000);

    it('stops the payment order when a hold is recorded after the letters, and keeps the case at its step', async () => {
        const { c, vehicle } = await drive('outside');
        expect((await hold(vehicle.id)).statusCode).toBe(201);
        const blocked = await tried(c, as.officer, 'approve', evidence());
        expect(blocked.status).toBe(422);
        expect(blocked.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
        expect((await caseOf(c.id)).state).toBe('outside');
        // nothing of the papers was kept: the step is one transaction
        expect((await transferOf(c.id))?.stamp_duty_receipt).toBeNull();
    }, 240_000);

    it('stops the transfer when a hold is recorded after the payment, and changes nothing', async () => {
        const { c, vehicle } = await drive('transfer');
        const [sellerPeriod] = await periodsOf(vehicle.id);
        expect((await hold(vehicle.id)).statusCode).toBe(201);
        const blocked = await tried(c, as.officer, 'transfer');
        expect(blocked.status).toBe(422);
        expect(blocked.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
        expect((await caseOf(c.id)).state).toBe('transfer');
        expect(await periodsOf(vehicle.id)).toEqual([expect.objectContaining({ id: sellerPeriod?.id, until: null })]);
        expect((await libresOf(vehicle.id)).map((l) => l.status)).toEqual(['issued']);
        expect((await transferOf(c.id))?.transferred_on).toBeNull();
        expect((await documentsOfLibre(vehicle.libreId))[0]?.revoked_at).toBeNull();
    }, 240_000);
});

describe('the maker-checker', () => {
    it('keeps whoever filed a case off its valuation', async () => {
        const vehicle = await onTheRoad(boditi);
        let c = await file(SERVICE, answersOf(vehicle.id, [await person()]), as.solo);
        c = await moved(c, as.solo, 'submit');
        c = await moved(c, as.solo, 'approve');
        expect(c.state).toBe('valuation');
        expect((await tried(c, as.solo, 'value', VALUATION)).status).toBe(403);
        expect((await moved(c, as.inspector, 'value', { answers: VALUATION })).state).toBe('letters');
    }, 240_000);

    it('keeps whoever reviewed a case off its approval', async () => {
        const { c } = await drive('approval', { reviewer: as.solo });
        expect((await tried(c, as.solo, 'approve')).status).toBe(403);
        expect((await moved(c, as.lead, 'approve')).state).toBe('transfer');
    }, 240_000);

    it('keeps the approver off the transfer step', async () => {
        const { c } = await drive('approval');
        const approved = await moved(c, as.solo, 'approve');
        expect(approved.state).toBe('transfer');
        expect((await tried(approved, as.solo, 'transfer')).status).toBe(403);
        expect((await moved(approved, as.officer, 'transfer')).state).toBe('booklet');
    }, 240_000);
});

describe('owners changed under the case, and the numbers', () => {
    it('refuses the transfer when the owners changed directly after the request was filed, and changes nothing', async () => {
        const { c, vehicle } = await drive('transfer');
        const ctx: DbContext = { ...contextFor(boditi), requestId: `otr-${randomUUID()}` };
        const [row] = await query<{ row_version: number }>('select row_version from vehicles.vehicles where id = $1', [
            vehicle.id
        ]);
        const intruder = await person();
        await app.scoped(ctx, (tx) =>
            registry.transferOwnership(tx, ctx, vehicle.id, row?.row_version ?? 1, {
                since: today(),
                owners: [{ kind: 'person', id: intruder }],
                acquiredBy: 'sale'
            })
        );
        const refused = await tried(c, as.officer, 'transfer');
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('invalid_transition');
        expect((await caseOf(c.id)).state).toBe('transfer');
        const periods = await periodsOf(vehicle.id);
        expect(periods).toHaveLength(2);
        expect(await holdersOf(periods[1]?.id ?? '')).toEqual([intruder]);
        expect((await transferOf(c.id))?.transferred_on).toBeNull();
    }, 240_000);

    it('refuses buyers who already hold the vehicle', async () => {
        const vehicle = await onTheRoad(boditi);
        const same = await tried(await file(SERVICE, answersOf(vehicle.id, [seller])), as.officer, 'submit');
        expect(same.status).toBe(422);
        expect(same.body.errors).toEqual([expect.objectContaining({ path: 'owners', code: 'same_owners' })]);
    }, 120_000);

    it('refuses a buyer listed twice at the filing, not first at the transfer step after the fee is paid', async () => {
        const vehicle = await onTheRoad(boditi);
        const buyer = await person();
        const twice = await tried(await file(SERVICE, answersOf(vehicle.id, [buyer, buyer])), as.officer, 'submit');
        expect(twice.status).toBe(422);
        expect(twice.body.errors).toEqual([expect.objectContaining({ path: 'owners', code: 'owner_listed_twice' })]);
    }, 120_000);

    it('tells an office with no number series at the filing, of the transfer and of a new registration', async () => {
        const away = async (key: string, work: () => Promise<void>) => {
            await api.owner.query('update kernel.number_counters set key = key || $3 where unit_id = $1 and key = $2', [
                boditi.id,
                key,
                '.away'
            ]);
            try {
                await work();
            } finally {
                await api.owner.query('update kernel.number_counters set key = $2 where unit_id = $1 and key = $3', [
                    boditi.id,
                    key,
                    `${key}.away`
                ]);
            }
        };
        const vehicle = await onTheRoad(boditi);
        const transfer = await file(SERVICE, answersOf(vehicle.id, [await person()]));
        const registration = await file(REGISTRATION, {
            owners: [{ ownerPerson: await person() }],
            chassisNumber: vin(),
            make: 'Toyota',
            model: 'Vitz',
            modelYear: 2018,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5
        });
        await away('vehicles.registration-certificate', async () => {
            for (const c of [transfer, registration]) {
                const refused = await tried(c, as.officer, 'submit');
                expect(refused.status).toBe(409);
                expect(refused.body.code).toBe('not_configured');
            }
        });
        await away('competency.transfer-letter', async () => {
            const refused = await tried(transfer, as.officer, 'submit');
            expect(refused.status).toBe(409);
            expect(refused.body.code).toBe('not_configured');
        });
        expect((await moved(transfer, as.officer, 'submit')).state).toBe('review');
        expect((await moved(registration, as.officer, 'submit')).state).toBe('review');
    }, 240_000);
});

describe('who sees what (class T at the handling office, class R for the register)', () => {
    it('keeps a sibling office off the case and off a vehicle it does not handle, and shows the zone the case', async () => {
        const buyer = await person();
        const { c, vehicle } = await drive('booklet', { buyers: [buyer] });
        // Boditi cannot file for a vehicle a sibling office (Damot Gale) handles
        const elsewhere = await onTheRoad(damot);
        const filed = await file(SERVICE, answersOf(elsewhere.id, [await person()]));
        const refused = await tried(filed, as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'other_office' })]);
        // and the sibling cannot see Boditi’s case
        expect((await api.call('GET', `/api/v1/cases/${c.id}`, as.damotHead)).statusCode).toBe(404);
        // the zone above sees it; another region sees nothing
        expect((await api.call('GET', `/api/v1/cases/${c.id}`, as.zoneOfficer)).statusCode).toBe(200);
        expect((await api.call('GET', `/api/v1/cases/${c.id}`, as.otherRegionClerk)).statusCode).toBe(404);

        const rowsAt = (unit: OrgUnit) =>
            app.scoped(
                contextFor(unit),
                async (tx: Tx) =>
                    (
                        await tx.execute<{ n: number }>(
                            sql`select count(*)::int as n from competency.ownership_transfers where case_id = ${c.id}`
                        )
                    ).rows[0]?.n
            );
        expect(await rowsAt(boditi)).toBe(1);
        expect(await rowsAt(zone)).toBe(1);
        expect(await rowsAt(damot)).toBe(0);
        expect(await rowsAt(otherRegion)).toBe(0);
        expect(
            await app.scoped(
                {},
                async (tx) =>
                    (
                        await tx.execute<{ n: number }>(
                            sql`select count(*)::int as n from competency.ownership_transfers`
                        )
                    ).rows[0]?.n
            )
        ).toBe(0);

        // the register is the region’s: Damot, which handles none of it, still reads the new owners
        const seen = (await api.call('GET', `/api/v1/vehicles/${vehicle.id}`, as.damotHead)).json<Vehicle>();
        expect(seen.owners.map((o) => o.id)).toEqual([buyer]);
    }, 300_000);
});
