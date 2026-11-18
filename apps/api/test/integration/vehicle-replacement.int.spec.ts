/**
 * The replacement of a lost, stolen or damaged libre as it is seeded (task 1.5, DVC-06, ADR-0062), run end to end through the API on
 * a real PostgreSQL 16 with the Wolaita seeds: a Boditi vehicle's libre is reported lost with the police letter and a newspaper
 * notice, the case waits out the notice period (15 days), is paid, approved and replaced: the old libre reads lost, the new one
 * points at it and is written in a booklet from the office's stock, and the old certificate reads superseded. A damaged libre skips
 * the notice. The refusals, the holds, the claim against other requests for the vehicle, a step run twice and who sees the row.
 * Names, chassis numbers and plates are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boloValidity, daysAfter, ReplacementService, VehicleRegistrationService } from '@itrms/competency/api';
import {
    importOwnershipTransferService,
    importPlateExchangeService,
    importReplacementService,
    importVehicleServices,
    setUpTransferLetterCounters
} from '@itrms/competency/seed';
import { formatEthiopianLong, toEthiopian } from '@itrms/ethiopian-calendar';
import { DocumentsService } from '@itrms/documents/api';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { StationeryStock } from '@itrms/fees/api';
import { importFeeRules, importStationeryDemo, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { VehicleRegistry } from '@itrms/vehicles/api';
import { vinCheckDigit } from '@itrms/vehicles/contracts';
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
    officer: '0199f0a0-d000-7000-8000-00000000f811',
    lead: '0199f0a0-d000-7000-8000-00000000f813',
    zoneOfficer: '0199f0a0-d000-7000-8000-000000000104'
};
const SERVICE = 'DVC-06';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let documents: DocumentsService;
let replacement: ReplacementService;
let boditi: OrgUnit;
let damot: OrgUnit;
let zone: OrgUnit;
let owner: string;
let buyer: string;
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

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

/** A vehicle of `unit` on an old regional plate with its libre in force, booklet and certificate, as a seed would register it. */
async function onTheRoad(unit: OrgUnit, withBooklet = true, certUnit: OrgUnit = unit) {
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    const plate = `SN 2-${String(randomInt(10000, 99999))}`;
    const chassis = vin();
    const booklet = `OLD-${randomInt(100000, 999999)}`;
    const made = await app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: chassis,
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2010,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5,
            firstRegisteredOn: '2011-03-01',
            owners: [{ kind: 'person', id: owner }]
        });
        await registry.recordPlate(tx, ctx, vehicle.id, { text: plate, source: 'legacy', since: '2011-03-01' });
        await registry.recordLibre(tx, ctx, vehicle.id, {
            issuedOn: '2011-03-01',
            ...(withBooklet ? { number: booklet } : {})
        });
        const [libre] = (
            await tx.execute<{ id: string }>(sql`select id from vehicles.libres where vehicle_id = ${vehicle.id}`)
        ).rows;
        return { id: vehicle.id, libreId: libre?.id ?? '' };
    });
    // the certificate belongs to the office that issued it, which may not be the one that handles the vehicle now
    const certCtx: DbContext = { ...contextFor(certUnit), requestId: `seed-${randomUUID()}` };
    const certificate = await app.scoped(certCtx, (tx) => {
        const number = `${certUnit.code}/RC/9${String(randomInt(10000, 99999))}`;
        return documents.reissue(tx, {
            regionId: certUnit.regionId,
            handlingUnitId: certUnit.id,
            templateKey: 'vehicle-registration-certificate',
            language: 'am',
            number,
            subject: { table: 'vehicles.libres', id: made.libreId },
            data: {
                number,
                issuedOn: '2011-03-01',
                firstRegisteredOn: '2011-03-01',
                plate,
                federalVehicleId: null,
                owners: [{ name: 'Sample Owner', address: null }],
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
                bookletSerial: withBooklet ? booklet : null,
                nationalReference: null
            }
        });
    });
    return { id: made.id, plate, libreId: made.libreId, certificateId: certificate.id };
}

// ---- cases

interface ProblemBody {
    code?: string;
    detail?: string;
    errors?: { path: string; code: string; message: string }[];
}

const lost = (vehicle: string, more: Record<string, unknown> = {}) => ({
    vehicle,
    item: 'libre',
    reason: 'lost',
    use: 'private',
    policeReportReference: `PL-${randomInt(1000, 9999)}`,
    policeReportOn: daysAfter(today(), -20),
    noticeNewspaper: 'Sample Daily',
    noticePublishedOn: daysAfter(today(), -15),
    ...more
});
const damaged = (vehicle: string, more: Record<string, unknown> = {}) => ({
    vehicle,
    item: 'libre',
    reason: 'damaged',
    use: 'private',
    oldItemHandedIn: true,
    ...more
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

async function tried(c: CaseOut, who: As, action: string, more: object = {}) {
    const res = await step(c, who, { action, ...more });
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
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Owner' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
}

/** Filed, submitted and approved by the officer: a lost libre waits in its notice, a damaged one in payment. */
async function reviewed(answers: Record<string, unknown>): Promise<CaseOut> {
    const c = await moved(await file(SERVICE, answers), as.officer, 'submit');
    expect(c.state).toBe('review');
    return moved(c, as.officer, 'approve');
}

/** Taken on, paid and approved by the lead: the officer replaces the libre next. */
async function atLibre(answers: Record<string, unknown>): Promise<CaseOut> {
    let c = await reviewed(answers);
    if (c.state === 'notice') c = await moved(c, as.officer, 'notice_over');
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('libre');
    return c;
}

// ---- what the database says

const libresOf = (vehicleId: string) =>
    query<{ id: string; number: string | null; status: string; replaces_id: string | null; case_id: string | null }>(
        `select id, number, status, replaces_id, case_id from vehicles.libres where vehicle_id = $1 order by created_at`,
        [vehicleId]
    );
const certificatesOf = (libreId: string) =>
    query<{ id: string; number: string | null; superseded_by: string | null; revoked_at: string | null }>(
        `select d.id, d.number, d.superseded_by, d.revoked_at from documents.issued_documents d
           join documents.document_templates t on t.id = d.template_id
          where d.subject_id = $1 and t.key = 'vehicle-registration-certificate' order by d.created_at`,
        [libreId]
    );
const rowOf = async (caseId: string) =>
    (
        await query<Record<string, string | null>>(
            `select r.*, r.replaced_on::text as replaced_on, r.police_report_on::text as police_report_on,
                    r.notice_published_on::text as notice_published_on, r.notice_ends_on::text as notice_ends_on
               from competency.replacements r where r.case_id = $1`,
            [caseId]
        )
    )[0];
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

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.rpl.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.rpl.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    documents = api.http.get(DocumentsService);
    replacement = api.http.get(ReplacementService);
    const region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.cashier = { sub: SUB.cashier, unit: boditi };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.zoneOfficer = { sub: SUB.zoneOfficer, unit: zone };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        await importVehicleServices(tx, root);
        await importPlateExchangeService(tx, root);
        await importOwnershipTransferService(tx, root);
        await setUpTransferLetterCounters(tx, root.regionId);
        expect(await importReplacementService(tx, root)).toBe(1);
    });
    // Boditi holds libre booklets handed down from the zone (the demo's stationery)
    expect(await importStationeryDemo(api.installer, 'SER', api.http.get(StationeryStock), today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ምትክ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Replacement', grandfather: 'Person' },
        sex: 'male',
        birthYear: 1980,
        acknowledgedDuplicates: []
    });
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
    const second = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ገዢ', father: 'ምትክ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Buyer', grandfather: 'Person' },
        sex: 'female',
        birthYear: 1985,
        acknowledgedDuplicates: []
    });
    expect(second.statusCode, second.body).toBe(201);
    buyer = second.json<{ id: string }>().id;
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
    it('stays as it is when seeded again, and charges the libre fee (demo amount)', async () => {
        const region = await api.unit('SER', 'SER');
        expect(
            await api.installer.scoped({}, (tx) =>
                importReplacementService(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
        const shown = await api.call('POST', '/api/v1/fees/preview', as.officer, {
            serviceCode: SERVICE,
            answers: { item: 'libre', use: 'private' }
        });
        expect(shown.statusCode, shown.body).toBe(200);
        expect(shown.json<{ totalSantim: string }>().totalSantim).toBe('150000');
    });
});

describe('a lost libre', () => {
    it('waits out the notice, then replaces the libre: the old reads lost, the new points at it, the certificate is superseded', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await atLibre(lost(vehicle.id));
        const before = await rowOf(c.id);
        expect(before).toBeUndefined();

        const [next] = await bookletsAtBoditi();
        const replacing = await step(c, as.officer, { action: 'replace_libre' });
        expect(replacing.statusCode, replacing.body).toBe(200);
        const booklet = replacing.json<CaseOut>();
        expect(booklet.state).toBe('booklet');

        const libres = await libresOf(vehicle.id);
        expect(libres).toHaveLength(2);
        expect(libres.find((l) => l.id === vehicle.libreId)?.status).toBe('lost');
        const fresh = libres.find((l) => l.id !== vehicle.libreId);
        expect(fresh).toMatchObject({ status: 'issued', number: null, replaces_id: vehicle.libreId, case_id: c.id });

        // the old certificate reads superseded (its QR reports it), and a new one stands for the new libre
        const [old] = await certificatesOf(vehicle.libreId);
        const [standing] = await certificatesOf(fresh?.id ?? '');
        expect(old?.superseded_by).toBe(standing?.id);
        expect(old?.revoked_at).toBeNull();
        expect(standing?.superseded_by).toBeNull();
        expect(standing?.number).not.toBe(old?.number);

        expect(await rowOf(c.id)).toMatchObject({
            item: 'libre',
            reason: 'lost',
            old_libre_id: vehicle.libreId,
            new_libre_id: fresh?.id,
            replaced_on: today()
        });
        expect(await auditOf(requestIdOf(replacing))).toMatchObject({
            'vehicles.libres:update': 1,
            'vehicles.libres:insert': 1,
            'competency.replacements:insert': 1,
            'competency.replacements:update': 1,
            'documents.issued_documents:insert': 1,
            'documents.issued_documents:event': 1
        });

        // the booklet: the office's next one is written on the new libre
        const done = await moved(booklet, as.officer, 'issue_booklet', { answers: {} });
        expect(done.state).toBe('replaced');
        expect((await libresOf(vehicle.id)).find((l) => l.id === fresh?.id)?.number).toBe(next);
    }, 300_000);

    it('replaces the libre once when the step is run again', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await atLibre(lost(vehicle.id));
        await moved(c, as.officer, 'replace_libre');
        const ctx: DbContext = { ...contextFor(boditi), requestId: `rpl-${randomUUID()}` };
        const facts =
            (
                await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [
                    c.id
                ])
            )[0]?.facts ?? {};
        const again = await app.scoped(ctx, (tx) =>
            replacement.replaceLibre(
                tx,
                { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                facts,
                undefined
            )
        );
        const libres = await libresOf(vehicle.id);
        expect(libres).toHaveLength(2);
        expect(again.libre.id).toBe(libres.find((l) => l.id !== vehicle.libreId)?.id);
        expect(await certificatesOf(again.libre.id)).toHaveLength(1);
    }, 300_000);

    it('refuses the end of the notice period before the day, and passes it on the day', async () => {
        const vehicle = await onTheRoad(boditi);
        const early = await reviewed(lost(vehicle.id, { noticePublishedOn: daysAfter(today(), -14) }));
        expect(early.state).toBe('notice');
        const refused = await tried(early, as.officer, 'notice_over');
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('invalid_transition');
        // the end day as the person reads it: Ethiopian, in the request's language (never the stored ISO day)
        const [y = 0, m = 1, d = 1] = daysAfter(today(), 1).split('-').map(Number);
        const ethiopian = ['am', 'en'].map((language) =>
            formatEthiopianLong(toEthiopian({ year: y, month: m, day: d }), { language: language as 'am' | 'en' })
        );
        expect(ethiopian.some((text) => refused.body.detail?.includes(text))).toBe(true);
        expect(refused.body.detail).not.toContain(daysAfter(today(), 1));
        expect((await caseOf(early.id)).state).toBe('notice');

        const other = await onTheRoad(boditi);
        const ready = await reviewed(lost(other.id, { noticePublishedOn: daysAfter(today(), -15) }));
        expect((await moved(ready, as.officer, 'notice_over')).state).toBe('payment');
    }, 300_000);

    it('refuses a lost libre without the police letter, the notice, or with a date in the future', async () => {
        const vehicle = await onTheRoad(boditi);
        const refusedAt = async (answers: Record<string, unknown>) => {
            const c = await file(SERVICE, answers);
            return tried(c, as.officer, 'submit');
        };
        const noLetter = await refusedAt(lost(vehicle.id, { policeReportReference: '' }));
        expect(noLetter.status).toBe(422);
        expect(noLetter.body.errors).toEqual([expect.objectContaining({ path: 'policeReportReference' })]);
        const future = await refusedAt(lost(vehicle.id, { policeReportOn: daysAfter(today(), 2) }));
        expect(future.body.errors).toEqual([expect.objectContaining({ path: 'policeReportOn' })]);
        const noNotice = await refusedAt(lost(vehicle.id, { noticePublishedOn: '' }));
        expect(noNotice.body.errors).toEqual([expect.objectContaining({ path: 'noticePublishedOn', code: 'notice' })]);
        const futureNotice = await refusedAt(lost(vehicle.id, { noticePublishedOn: daysAfter(today(), 1) }));
        expect(futureNotice.body.errors).toEqual([
            expect.objectContaining({ path: 'noticePublishedOn', code: 'future' })
        ]);
    }, 300_000);

    it('refuses a libre in force without its booklet', async () => {
        const vehicle = await onTheRoad(boditi, false);
        const c = await file(SERVICE, lost(vehicle.id));
        const refused = await tried(c, as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'no_booklet' })]);
    });
});

describe('a damaged libre', () => {
    it('skips the notice, reads replaced, and needs the old libre handed in', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await atLibre(damaged(vehicle.id));
        const done = await moved(c, as.officer, 'replace_libre');
        expect(done.state).toBe('booklet');
        const libres = await libresOf(vehicle.id);
        expect(libres.find((l) => l.id === vehicle.libreId)?.status).toBe('replaced');
        expect(await rowOf(c.id)).toMatchObject({ reason: 'damaged', notice_published_on: null });

        const other = await onTheRoad(boditi);
        const refused = await tried(
            await file(SERVICE, damaged(other.id, { oldItemHandedIn: false })),
            as.officer,
            'submit'
        );
        expect(refused.status).toBe(422);
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'oldItemHandedIn' })]);
    }, 300_000);
});

describe('holds and claims', () => {
    it('stops the case at its approval while a bank loan holds the vehicle', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await moved(await file(SERVICE, damaged(vehicle.id)), as.officer, 'submit');
        const held = await api.call('POST', '/api/v1/encumbrances', as.officer, {
            vehicleId: vehicle.id,
            kind: 'bank_loan',
            holderOrganisationId: bank.id,
            letterReference: `LTR-${randomInt(100000, 999999)}`,
            letterDate: '2026-10-01'
        });
        expect(held.statusCode, held.body).toBe(201);
        const blocked = await tried(c, as.officer, 'approve');
        expect(blocked.status).toBe(422);
        expect(blocked.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
        expect((await caseOf(c.id)).state).toBe('review');
    }, 300_000);

    it('claims the vehicle against a plate exchange and an ownership transfer, both ways', async () => {
        const vehicle = await onTheRoad(boditi);
        const open = await moved(await file(SERVICE, damaged(vehicle.id)), as.officer, 'submit');
        const exchange = await tried(
            await file('DVC-12', { vehicle: vehicle.id, use: 'private' }),
            as.officer,
            'submit'
        );
        expect(exchange.status).toBe(422);
        expect(exchange.body.code).toBe('not_eligible');
        const transfer = await tried(
            await file('DVC-13', { vehicle: vehicle.id, owners: [{ ownerPerson: buyer }], acquiredBy: 'sale' }),
            as.officer,
            'submit'
        );
        expect(transfer.status).toBe(422);
        expect(transfer.body.code).toBe('not_eligible');
        await moved(open, as.officer, 'reject', { comment: 'Test over' });

        const other = await onTheRoad(boditi);
        await moved(await file('DVC-12', { vehicle: other.id, use: 'private' }), as.officer, 'submit');
        const replaced = await tried(await file(SERVICE, damaged(other.id)), as.officer, 'submit');
        expect(replaced.status).toBe(422);
        expect(replaced.body.code).toBe('not_eligible');

        const third = await onTheRoad(boditi);
        await moved(await file(SERVICE, damaged(third.id)), as.officer, 'submit');
        const twice = await tried(await file(SERVICE, damaged(third.id)), as.officer, 'submit');
        expect(twice.status).toBe(422);
        expect(twice.body.code).toBe('not_eligible');
    }, 300_000);
});

describe('who sees what (class T at the handling office)', () => {
    it('refuses a vehicle a sibling office handles, shows the row to the zone above and to nobody else', async () => {
        const elsewhere = await onTheRoad(damot);
        const refused = await tried(await file(SERVICE, damaged(elsewhere.id)), as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'other_office' })]);

        const vehicle = await onTheRoad(boditi);
        const c = await atLibre(damaged(vehicle.id));
        await moved(c, as.officer, 'replace_libre');
        const rowsAt = (unit: OrgUnit) =>
            app.scoped(
                contextFor(unit),
                async (tx) =>
                    (
                        await tx.execute<{ n: number }>(
                            sql`select count(*)::int as n from competency.replacements where case_id = ${c.id}`
                        )
                    ).rows[0]?.n
            );
        expect(await rowsAt(boditi)).toBe(1);
        expect(await rowsAt(zone)).toBe(1);
        expect(await rowsAt(damot)).toBe(0);
        expect(
            await app.scoped(
                {},
                async (tx) =>
                    (await tx.execute<{ n: number }>(sql`select count(*)::int as n from competency.replacements`))
                        .rows[0]?.n
            )
        ).toBe(0);
        expect((await api.call('GET', `/api/v1/cases/${c.id}`, as.zoneOfficer)).statusCode).toBe(200);
    }, 300_000);
});

const hold = (vehicleId: string) =>
    api.call('POST', '/api/v1/encumbrances', as.officer, {
        vehicleId,
        kind: 'bank_loan',
        holderOrganisationId: bank.id,
        letterReference: `LTR-${randomInt(100000, 999999)}`,
        letterDate: '2026-10-01'
    });

describe('holds at filing and before the booklet', () => {
    it('refuses a vehicle with a bank-loan hold at filing', async () => {
        const vehicle = await onTheRoad(boditi);
        expect((await hold(vehicle.id)).statusCode).toBe(201);
        const refused = await tried(await file(SERVICE, damaged(vehicle.id)), as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
    }, 300_000);

    it('stops the booklet when a hold is recorded after the libre was replaced', async () => {
        const vehicle = await onTheRoad(boditi);
        const booklet = await moved(await atLibre(damaged(vehicle.id)), as.officer, 'replace_libre');
        expect(booklet.state).toBe('booklet');
        expect((await hold(vehicle.id)).statusCode).toBe(201);
        const refused = await tried(booklet, as.officer, 'issue_booklet', { answers: {} });
        expect(refused.status).toBe(422);
        expect(refused.body.errors?.[0]).toMatchObject({ path: 'vehicle', code: 'encumbered' });
        expect((await caseOf(booklet.id)).state).toBe('booklet');
    }, 300_000);
});

/** What the reviewed command answers, or why it refused (the database's message, down the cause chain). */
async function retire(ctx: DbContext, args: { libre: string; document: string | null; reason?: string | null }) {
    try {
        const rows = await app.scoped({ ...ctx, requestId: `rtr-${randomUUID()}` }, async (tx) =>
            tx.execute<{ id: string | null }>(
                sql`select vehicles.retire_libre_certificate(${args.libre}::uuid, 'vehicle-registration-certificate',
                        ${args.document}::uuid, ${args.reason ?? null}) as id`
            )
        );
        return { id: rows.rows[0]?.id ?? null, refused: '' };
    } catch (error) {
        const messages: string[] = [];
        for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
            messages.push(String((e as Error).message));
        return { id: null, refused: messages.join(' | ') };
    }
}

describe('a certificate another office issued (a vehicle moved to the replacing office by a transfer)', () => {
    it('is superseded by the new certificate although the replacing office cannot see it, and the change is audited', async () => {
        // the first office (Damot Gale) issued the certificate; Boditi handles the vehicle now
        const vehicle = await onTheRoad(boditi, true, damot);
        const c = await atLibre(damaged(vehicle.id));
        await moved(c, as.officer, 'replace_libre');
        const fresh = (await libresOf(vehicle.id)).find((l) => l.id !== vehicle.libreId);
        const [old] = await certificatesOf(vehicle.libreId);
        const [standing] = await certificatesOf(fresh?.id ?? '');
        expect(standing).toBeDefined();
        expect(old?.superseded_by).toBe(standing?.id);
        expect(standing?.superseded_by).toBeNull();
        expect(
            (
                await query<{ n: number }>(
                    `select count(*)::int as n from kernel.audit_log where event_type = 'documents.superseded_across' and row_id = $1`,
                    [old?.id]
                )
            )[0]?.n
        ).toBe(1);
    }, 300_000);

    it('is refused by the command with no context, for a new libre out of reach, one that replaces nothing, and another libre’s document', async () => {
        const vehicle = await onTheRoad(boditi);
        const done = await moved(await atLibre(damaged(vehicle.id)), as.officer, 'replace_libre');
        expect(done.state).toBe('booklet');
        const fresh = (await libresOf(vehicle.id)).find((l) => l.id !== vehicle.libreId);
        const boditiCtx = contextFor(boditi);

        expect((await retire({}, { libre: fresh?.id ?? '', document: null, reason: 'x' })).refused).toMatch(
            /retired by a person/
        );
        expect(
            (await retire(contextFor(damot), { libre: fresh?.id ?? '', document: null, reason: 'x' })).refused
        ).toMatch(/not one of an office of the caller/);
        const alone = await onTheRoad(boditi);
        expect((await retire(boditiCtx, { libre: alone.libreId, document: null, reason: 'x' })).refused).toMatch(
            /replaces no libre/
        );

        // a new libre made straight in the register, its predecessor's certificate still standing: another libre's document is refused
        const other = await onTheRoad(boditi);
        const handmade = await onTheRoad(boditi);
        const ctx: DbContext = { ...boditiCtx, requestId: `rtr-${randomUUID()}` };
        const successor = await app.scoped(ctx, async (tx) => {
            const made = await registry.replaceLibre(tx, ctx, handmade.id, {
                issuedOn: today(),
                caseId: done.id,
                outgoing: 'lost'
            });
            return made.libre;
        });
        const refusedDoc = await retire(boditiCtx, { libre: successor.id, document: other.certificateId });
        expect(refusedDoc.refused).toMatch(/is not the certificate of libre/);
    }, 300_000);
});

describe('the zone acting for the office', () => {
    it('files the new certificate under the case’s office, which then takes the booklet', async () => {
        const vehicle = await onTheRoad(boditi);
        const c = await atLibre(damaged(vehicle.id));
        const facts =
            (
                await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [
                    c.id
                ])
            )[0]?.facts ?? {};
        const zoneCtx: DbContext = { ...contextFor(zone), requestId: `rpl-${randomUUID()}` };
        const place = { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id };
        const made = await app.scoped(zoneCtx, (tx) =>
            replacement.replaceLibre(tx, { ...place, ctx: zoneCtx }, facts, undefined)
        );
        const fresh = (await libresOf(vehicle.id)).find((l) => l.id !== vehicle.libreId);
        const [standing] = await query<{ handling_unit_id: string }>(
            `select handling_unit_id from documents.issued_documents where subject_id = $1 and superseded_by is null`,
            [fresh?.id]
        );
        expect(standing?.handling_unit_id).toBe(boditi.id);
        // the office’s own officer takes the booklet: nothing is "already issued" under another office
        const officerCtx: DbContext = { ...contextFor(boditi), requestId: `rpl-${randomUUID()}` };
        const booklet = await app.scoped(officerCtx, (tx) =>
            api.http
                .get(VehicleRegistrationService)
                .issueBooklet(tx, { ...place, ctx: officerCtx }, { ...facts, ...made }, {})
        );
        expect(booklet.libre.booklet).toBeTruthy();
    }, 300_000);
});

// ---- the bolo sticker (task 1.5b)

/** A bolo in force for the vehicle, as its inspection would have left it: the row, its sticker and its document. */
async function withBolo(
    unit: OrgUnit,
    vehicleId: string,
    more: { status?: string; validUntil?: string; fiscalYear?: number } = {}
) {
    const validity = boloValidity(today());
    const status = more.status ?? 'valid';
    // well ahead of the 7-day margin a replacement needs, whatever the day of the fiscal year (the year stays the real one:
    // the stock's stickers are printed for it)
    const validUntil = more.validUntil ?? daysAfter(today(), 60);
    const fiscalYear = more.fiscalYear ?? validity.fiscalYear;
    const sticker = `OLD-${randomInt(100000, 999999)}`;
    const id = randomUUID();
    await api.owner.query(
        `insert into competency.bolos (id, region_id, handling_unit_id, vehicle_id, case_id, status, use, checklist_serial,
                inspected_on, fiscal_year, valid_until, insurance_certificate, insurer, insured_from, insured_until,
                sticker_key, temporary_until)
         values ($1, $2, $3, $4, $5, $6, 'private', 'LV-1', $7, $8, $9, 'INS-1', 'Sample Insurance S.C.', $7, $9, $10, $11)`,
        [
            id,
            unit.regionId,
            unit.id,
            vehicleId,
            randomUUID(),
            status,
            daysAfter(today(), -30),
            fiscalYear,
            validUntil,
            status === 'valid' ? sticker : null,
            status === 'temporary' ? validUntil : null
        ]
    );
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    const document = await app.scoped(ctx, (tx) =>
        documents.reissue(tx, {
            regionId: unit.regionId,
            handlingUnitId: unit.id,
            templateKey: 'vehicle-bolo',
            language: 'am',
            number: sticker,
            subject: { table: 'competency.bolos', id },
            data: {
                number: sticker,
                plate: 'SN 2-00000',
                chassisNumber: 'CHASSIS0000000001',
                make: 'Toyota',
                model: 'Corolla',
                category: { am: 'አውቶሞቢል', en: 'Automobile' },
                use: { am: 'የግል', en: 'Private' },
                checklistSerial: 'LV-1',
                inspectedOn: daysAfter(today(), -30),
                fiscalYear,
                validUntil,
                temporaryUntil: null,
                insurance: { certificate: 'INS-1', insurer: 'Sample Insurance S.C.', until: validUntil }
            }
        })
    );
    return { id, sticker, documentId: document.id, fiscalYear, validUntil };
}

const lostBolo = (vehicle: string, more: Record<string, unknown> = {}) => ({
    vehicle,
    item: 'bolo',
    reason: 'lost',
    use: 'private',
    policeReportReference: `PL-${randomInt(1000, 9999)}`,
    policeReportOn: daysAfter(today(), -3),
    ...more
});

/** Filed, checked, paid and approved: the officer replaces the sticker next. */
async function atBolo(answers: Record<string, unknown>): Promise<CaseOut> {
    let c = await moved(await file(SERVICE, answers), as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('bolo');
    return c;
}

const boloRow = async (id: string) =>
    (
        await query<{ sticker_key: string; valid_until: string; fiscal_year: number; status: string }>(
            `select sticker_key, valid_until::text as valid_until, fiscal_year, status from competency.bolos where id = $1`,
            [id]
        )
    )[0];
const boloDocuments = (boloId: string) =>
    query<{ id: string; number: string | null; superseded_by: string | null }>(
        `select d.id, d.number, d.superseded_by from documents.issued_documents d
           join documents.document_templates t on t.id = d.template_id
          where d.subject_id = $1 and t.key = 'vehicle-bolo' order by d.created_at`,
        [boloId]
    );

describe('a lost bolo sticker', () => {
    it('charges the bolo fee (demo amount)', async () => {
        const shown = await api.call('POST', '/api/v1/fees/preview', as.officer, {
            serviceCode: SERVICE,
            answers: { item: 'bolo', use: 'private' }
        });
        expect(shown.statusCode, shown.body).toBe(200);
        expect(shown.json<{ totalSantim: string }>().totalSantim).toBe('150000');
    });

    it('is replaced from the stock: same year and last day, the old sticker kept, the old document superseded', async () => {
        const vehicle = await onTheRoad(boditi);
        const bolo = await withBolo(boditi, vehicle.id);
        const c = await atBolo(lostBolo(vehicle.id));
        const replacing = await step(c, as.officer, { action: 'replace_sticker', answers: {} });
        expect(replacing.statusCode, replacing.body).toBe(200);
        expect(replacing.json<CaseOut>().state).toBe('replaced');

        const now = await boloRow(bolo.id);
        expect(now?.sticker_key).not.toBe(bolo.sticker);
        expect(now).toMatchObject({ valid_until: bolo.validUntil, fiscal_year: bolo.fiscalYear, status: 'valid' });
        const row = await rowOf(c.id);
        expect(row).toMatchObject({
            item: 'bolo',
            reason: 'lost',
            bolo_id: bolo.id,
            old_sticker_key: bolo.sticker,
            new_sticker_key: now?.sticker_key,
            replaced_on: today()
        });
        // the new sticker was used for the replacement, not for the bolo
        const [item] = await query<{ status: string; used_for_table: string; used_for_id: string }>(
            'select status, used_for_table, used_for_id from fees.stationery_items where item_key = $1 and kind = $2',
            [now?.sticker_key, 'bolo_sticker']
        );
        expect(item).toMatchObject({ status: 'used', used_for_table: 'competency.replacements', used_for_id: row?.id });

        const [old, standing] = await boloDocuments(bolo.id);
        expect(old?.superseded_by).toBe(standing?.id);
        expect(standing?.superseded_by).toBeNull();
        expect(standing?.number).toBe(now?.sticker_key);
        expect(await auditOf(requestIdOf(replacing))).toMatchObject({
            'competency.bolos:update': 1,
            'competency.replacements:insert': 1,
            'competency.replacements:update': 1,
            'documents.issued_documents:insert': 1
        });
    }, 300_000);

    it('gives the same sticker when the step is run again', async () => {
        const vehicle = await onTheRoad(boditi);
        const bolo = await withBolo(boditi, vehicle.id);
        const c = await atBolo(lostBolo(vehicle.id));
        await moved(c, as.officer, 'replace_sticker', { answers: {} });
        const first = await boloRow(bolo.id);
        const ctx: DbContext = { ...contextFor(boditi), requestId: `rpl-${randomUUID()}` };
        const facts =
            (
                await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [
                    c.id
                ])
            )[0]?.facts ?? {};
        const again = await app.scoped(ctx, (tx) =>
            replacement.replaceBoloSticker(
                tx,
                { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                facts,
                {}
            )
        );
        expect(again.bolo.sticker).toBe(first?.sticker_key);
        expect(await boloDocuments(bolo.id)).toHaveLength(2);
    }, 300_000);

    it('waits for stickers when the office has none of the bolo’s year: the step is refused and nothing is written', async () => {
        const vehicle = await onTheRoad(boditi);
        const next = boloValidity(daysAfter(today(), 800));
        await withBolo(boditi, vehicle.id, { fiscalYear: next.fiscalYear, validUntil: next.validUntil });
        const c = await atBolo(lostBolo(vehicle.id));
        const refused = await tried(c, as.officer, 'replace_sticker', { answers: {} });
        expect(refused.status).toBeGreaterThanOrEqual(400);
        expect((await caseOf(c.id)).state).toBe('bolo');
        expect(await rowOf(c.id)).toBeUndefined();
    }, 300_000);

    it('is not stopped by a hold on the vehicle', async () => {
        const vehicle = await onTheRoad(boditi);
        await withBolo(boditi, vehicle.id);
        expect((await hold(vehicle.id)).statusCode).toBe(201);
        const c = await atBolo(lostBolo(vehicle.id));
        expect((await moved(c, as.officer, 'replace_sticker', { answers: {} })).state).toBe('replaced');
    }, 300_000);

    it('needs a bolo in force on its sticker, issued by this office', async () => {
        const refusedAt = (vehicleId: string) =>
            file(SERVICE, lostBolo(vehicleId)).then((c) => tried(c, as.officer, 'submit'));

        const expired = await onTheRoad(boditi);
        await withBolo(boditi, expired.id, { validUntil: daysAfter(today(), -1) });
        const noBolo = await refusedAt(expired.id);
        expect(noBolo.status).toBe(422);
        expect(noBolo.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'no_bolo' })]);

        const none = await onTheRoad(boditi);
        expect((await refusedAt(none.id)).body.errors).toEqual([expect.objectContaining({ code: 'no_bolo' })]);

        const temporary = await onTheRoad(boditi);
        await withBolo(boditi, temporary.id, { status: 'temporary' });
        expect((await refusedAt(temporary.id)).body.errors).toEqual([expect.objectContaining({ code: 'no_sticker' })]);

        // the vehicle moved to Boditi since Damot Gale gave its bolo: the sticker is replaced where the bolo was issued
        const away = await onTheRoad(boditi);
        await withBolo(damot, away.id);
        expect((await refusedAt(away.id)).body.errors).toEqual([
            expect.objectContaining({ code: 'bolo_other_office' })
        ]);
    }, 300_000);

    it('needs the police letter when lost, and a damaged sticker handed in', async () => {
        const vehicle = await onTheRoad(boditi);
        await withBolo(boditi, vehicle.id);
        const noLetter = await tried(
            await file(SERVICE, lostBolo(vehicle.id, { policeReportReference: '' })),
            as.officer,
            'submit'
        );
        expect(noLetter.status).toBe(422);
        expect(noLetter.body.errors).toEqual([expect.objectContaining({ path: 'policeReportReference' })]);
        const notHandedIn = await tried(
            await file(SERVICE, {
                vehicle: vehicle.id,
                item: 'bolo',
                reason: 'damaged',
                use: 'private',
                oldItemHandedIn: false
            }),
            as.officer,
            'submit'
        );
        expect(notHandedIn.body.errors).toEqual([expect.objectContaining({ path: 'oldItemHandedIn' })]);
    }, 300_000);
});

describe('a bolo sticker replacement, after review', () => {
    const factsOf = async (caseId: string) =>
        (await query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [caseId]))[0]
            ?.facts ?? {};
    const placeOf = (caseId: string) => {
        const ctx: DbContext = { ...contextFor(boditi), requestId: `rpl-${randomUUID()}` };
        return { ctx, place: { caseId, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx } };
    };
    const stickersInStock = async () =>
        (
            await query<{ n: number }>(
                `select count(*)::int as n from fees.stationery_items
                  where holder_unit_id = $1 and kind = 'bolo_sticker' and status = 'in_stock'`,
                [boditi.id]
            )
        )[0]?.n;

    it('is refused once the vehicle has left the register, and no sticker leaves the stock', async () => {
        const vehicle = await onTheRoad(boditi);
        await withBolo(boditi, vehicle.id);
        const c = await atBolo(lostBolo(vehicle.id));
        const before = await stickersInStock();
        await query(`update vehicles.vehicles set status = 'stolen' where id = $1`, [vehicle.id]);
        const refused = await tried(c, as.officer, 'replace_sticker', { answers: {} });
        expect(refused.status).toBe(409);
        expect((await caseOf(c.id)).state).toBe('bolo');
        expect(await stickersInStock()).toBe(before);
        expect(await rowOf(c.id)).toBeUndefined();
    }, 300_000);

    it('says the case is to be rejected when the bolo ended while it waited', async () => {
        const vehicle = await onTheRoad(boditi);
        const bolo = await withBolo(boditi, vehicle.id, { validUntil: daysAfter(today(), 8) });
        const c = await atBolo(lostBolo(vehicle.id));
        await query(`update competency.bolos set valid_until = $2 where id = $1`, [bolo.id, daysAfter(today(), -1)]);
        const refused = await tried(c, as.officer, 'replace_sticker', { answers: {} });
        expect(refused.status).toBe(409);
        expect(refused.res.body).toMatch(/replacementBoloExpiredOnStep|reject|ውድቅ/);
        expect((await caseOf(c.id)).state).toBe('bolo');
    }, 300_000);

    it('refuses at filing a bolo that ends within a week', async () => {
        const vehicle = await onTheRoad(boditi);
        await withBolo(boditi, vehicle.id, { validUntil: daysAfter(today(), 3) });
        const refused = await tried(await file(SERVICE, lostBolo(vehicle.id)), as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'bolo_expiring' })]);
    }, 300_000);

    it('only reads when a finished case’s step is run again: a later replacement of the bolo stays', async () => {
        const vehicle = await onTheRoad(boditi);
        const bolo = await withBolo(boditi, vehicle.id);
        const a = await atBolo(lostBolo(vehicle.id));
        await moved(a, as.officer, 'replace_sticker', { answers: {} });
        const first = (await boloRow(bolo.id))?.sticker_key;
        const b = await atBolo(lostBolo(vehicle.id));
        await moved(b, as.officer, 'replace_sticker', { answers: {} });
        const second = (await boloRow(bolo.id))?.sticker_key;
        expect(second).not.toBe(first);

        const { ctx, place } = placeOf(a.id);
        const again = await app.scoped(ctx, async (tx) =>
            replacement.replaceBoloSticker(tx, place, await factsOf(a.id), {})
        );
        expect(again.bolo.sticker).toBe(first);
        expect((await boloRow(bolo.id))?.sticker_key).toBe(second);
        const standing = (await boloDocuments(bolo.id)).filter((d) => d.superseded_by === null);
        expect(standing).toHaveLength(1);
        expect(standing[0]?.number).toBe(second);
    }, 300_000);

    it('keeps the libre step off a bolo case and the sticker step off a libre case', async () => {
        const vehicle = await onTheRoad(boditi);
        await withBolo(boditi, vehicle.id);
        const bolo = await atBolo(lostBolo(vehicle.id));
        const onBolo = placeOf(bolo.id);
        await expect(
            app.scoped(onBolo.ctx, async (tx) =>
                replacement.replaceLibre(tx, onBolo.place, await factsOf(bolo.id), undefined)
            )
        ).rejects.toThrow();

        const other = await onTheRoad(boditi);
        const libre = await atLibre(damaged(other.id));
        const onLibre = placeOf(libre.id);
        await expect(
            app.scoped(onLibre.ctx, async (tx) =>
                replacement.replaceBoloSticker(tx, onLibre.place, await factsOf(libre.id), {})
            )
        ).rejects.toThrow();
        expect(await libresOf(other.id)).toHaveLength(1);
        expect(await rowOf(libre.id)).toBeUndefined();
    }, 300_000);
});
