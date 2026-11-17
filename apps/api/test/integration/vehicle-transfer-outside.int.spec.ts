/**
 * The transfer of a vehicle out of the region (task 1.4c2, DVC-14 with its destination "outside", ADR-0058), end to end through the
 * API on a real PostgreSQL 16 with the Wolaita seeds: a Boditi vehicle carrying a national plate is filed out to another region,
 * paid and approved, and the officer issues the vehicle data transfer document. Only the status changes: the owners, the plate, the
 * libre and the stock plate stay with Boditi. The document is numbered from its counter and stands for the days the setting gives,
 * a covering letter comes with it, a hold recorded meanwhile stops it, no other service acts on the vehicle after, no office of the
 * region can receive it, and the step run again returns what it issued. Names and chassis are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daysAfter, VehicleTransferService } from '@itrms/competency/api';
import {
    VEHICLE_TRANSFER_DOCUMENT_COUNTER,
    VEHICLE_TRANSFER_DOCUMENT_PATTERN,
    VEHICLE_TRANSFER_DOCUMENT_TEMPLATE,
    VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE
} from '@itrms/competency/contracts';
import {
    importOwnershipTransferService,
    importTransferInService,
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
import { vinCheckDigit } from '@itrms/vehicles/contracts';
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
    officer: '0199f0a0-d000-7000-8000-00000000f811',
    lead: '0199f0a0-d000-7000-8000-00000000f812'
};
const OUT = 'DVC-14';
const DESTINATION = 'Sample Transport Bureau';
const REGION = 'Sample Region';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let stock: PlateStock;
let transfers: VehicleTransferService;
let region: OrgUnit;
let zone: OrgUnit;
let boditi: OrgUnit;
let owner: string;
let bank: { id: string };
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

let serial = 0;
function vin(): string {
    serial += 1;
    const base = `2HGCM82B0${String(randomInt(10, 99))}${String(serial).padStart(6, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}

/** A vehicle of Boditi on an old regional plate with its libre in force and a national plate from the office's stock. */
async function onTheRoad(unit: OrgUnit = boditi) {
    const ctx: DbContext = { ...contextFor(unit), requestId: `seed-${randomUUID()}` };
    return app.scoped(ctx, async (tx) => {
        const vehicle = await registry.register(tx, ctx, {
            chassisNumber: vin(),
            make: 'Toyota',
            model: 'Corolla',
            modelYear: 2012,
            categoryKey: 'automobile',
            use: 'private',
            seats: 5,
            firstRegisteredOn: '2013-03-01',
            owners: [{ kind: 'person', id: owner }]
        });
        await registry.recordPlate(tx, ctx, vehicle.id, {
            text: `SN 2-${String(randomInt(10000, 99999))}`,
            source: 'legacy',
            since: '2013-03-01'
        });
        await registry.recordLibre(tx, ctx, vehicle.id, { issuedOn: '2013-03-01' });
        const plate = await registry.assignStockPlate(tx, ctx, vehicle.id, { since: today() });
        return { id: vehicle.id, plateId: plate.plateId };
    });
}

interface ProblemBody {
    code?: string;
    detail?: string;
    errors?: { path: string; code: string; message: string }[];
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

const OUTSIDE = { destination: 'outside', destinationName: DESTINATION, destinationRegion: REGION };

/** A transfer out of the region, filed, paid and approved: at the document step. */
async function atTheDocument(vehicleId: string): Promise<CaseOut> {
    let out = await file(OUT, { vehicle: vehicleId, ...OUTSIDE }, as.officer);
    out = await moved(out, as.officer, 'submit');
    out = await moved(out, as.officer, 'approve');
    expect(out.state).toBe('payment');
    await paid(out, as.boditiCashier);
    out = await caseOf(out.id, as.officer);
    expect(out.state).toBe('approval');
    out = await moved(out, as.lead, 'approve');
    expect(out.state).toBe('document');
    return out;
}

const DOCUMENT_ANSWERS = {
    customsDeclarationNumber: 'CD-1',
    purchaseValueBirr: 350000,
    earlierPlates: [{ plate: 'AA 2-12345', year: 2010, place: 'Addis Ababa' }]
};

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

const handlingOf = async (table: string, where: string, params: unknown[]) =>
    (await query<{ unit: string }>(`select handling_unit_id as unit from ${table} where ${where}`, params)).map(
        (r) => r.unit
    );

const documentsOf = (caseId: string) =>
    query<{ key: string; id: string; number: string; valid_until: string | null; data: Record<string, unknown> }>(
        `select t.key, d.id, d.number, d.valid_until::text, d.data from documents.issued_documents d
           join documents.document_templates t on t.id = d.template_id
          where d.case_id = $1 and d.superseded_by is null order by t.key`,
        [caseId]
    );

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
            username: 'test.vto.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.vto.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    stock = api.http.get(PlateStock);
    transfers = api.http.get(VehicleTransferService);
    region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };

    const root = { id: region.id, regionId: region.regionId };
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importVehicleCategories(tx, root);
        await setUpRegistrationCertificateCounters(tx, root.regionId);
        await importDocumentTemplates(tx, root);
        await importVehicleServices(tx, root);
        await importOwnershipTransferService(tx, root);
        expect(await importTransferOutService(tx, root)).toBe(1);
        expect(await importTransferInService(tx, root)).toBe(1);
        // Boditi numbers the transfer document and its covering letter from one counter
        await setUpCounter(tx, {
            key: VEHICLE_TRANSFER_DOCUMENT_COUNTER,
            unitId: boditi.id,
            regionId: root.regionId,
            pattern: VEHICLE_TRANSFER_DOCUMENT_PATTERN
        });
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ዝውውር', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Leaver', grandfather: 'Person' },
        sex: 'female',
        birthYear: 1985,
        acknowledgedDuplicates: []
    });
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
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

describe('a vehicle transferred out of the region', () => {
    it('is given its transfer document and reads transferred out; nothing else about it changes', async () => {
        const v = await onTheRoad();
        let out = await atTheDocument(v.id);
        out = await moved(out, as.officer, 'issue_document', { answers: DOCUMENT_ANSWERS });
        expect(out.state).toBe('transferred_out');

        expect(await query('select status from vehicles.vehicles where id = $1', [v.id])).toEqual([
            { status: 'transferred_out' }
        ]);
        // the release and the status change are on record, in the step's transaction
        const [handover] = await query<{ id: string }>(
            'select id from vehicles.vehicle_handovers where vehicle_id = $1',
            [v.id]
        );
        expect(
            await query(
                `select table_name || ':' || action as line from kernel.audit_log
                  where (table_name = 'vehicles.vehicle_handovers' and row_id = $1)
                     or (table_name = 'vehicles.vehicles' and row_id = $2 and diff::text like '%transferred_out%')
                  order by 1`,
                [handover?.id, v.id]
            )
        ).toEqual([{ line: 'vehicles.vehicle_handovers:insert' }, { line: 'vehicles.vehicles:update' }]);
        expect(
            await query(
                `select status, destination_kind, to_unit_id, destination_name, destination_region
                   from vehicles.vehicle_handovers where vehicle_id = $1`,
                [v.id]
            )
        ).toEqual([
            {
                status: 'released',
                destination_kind: 'outside',
                to_unit_id: null,
                destination_name: DESTINATION,
                destination_region: REGION
            }
        ]);
        // the open ownership, the plate, the libre in force and the stock plate stay as they were, with Boditi
        expect(await handlingOf('vehicles.vehicle_ownerships', 'vehicle_id = $1 and until is null', [v.id])).toEqual([
            boditi.id
        ]);
        expect(await handlingOf('vehicles.plate_assignments', 'vehicle_id = $1 and until is null', [v.id])).toEqual([
            boditi.id
        ]);
        expect(await handlingOf('vehicles.libres', "vehicle_id = $1 and status = 'issued'", [v.id])).toEqual([
            boditi.id
        ]);
        expect(await handlingOf('vehicles.vehicles', 'id = $1', [v.id])).toEqual([boditi.id]);
        expect(
            await query('select holder_unit_id as holder, status from vehicles.plates where id = $1', [v.plateId])
        ).toEqual([{ holder: boditi.id, status: 'assigned' }]);

        // the document: numbered from the counter, standing for the days the setting gives; and the covering letter
        const documents = await documentsOf(out.id);
        const document = documents.find((d) => d.key === VEHICLE_TRANSFER_DOCUMENT_TEMPLATE);
        expect(document?.number).toMatch(/\/VT\/00001\//);
        expect(document?.valid_until).toBe(daysAfter(today(), 15));
        expect(document?.data).toMatchObject({
            destination: { name: DESTINATION, region: REGION },
            customsDeclarationNumber: 'CD-1',
            purchaseValueSantim: '35000000',
            taxReceiptNumber: null
        });
        const plates = (document?.data.plates ?? []) as { plate: string; year: number | null }[];
        expect(plates.some((p) => p.plate === 'AA 2-12345' && p.year === 2010)).toBe(true);
        const letter = documents.find((d) => d.key === VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE);
        expect(letter?.number).toMatch(/\/VT\/00002\//);
        expect(letter?.data).toMatchObject({ addressee: DESTINATION, documentNumber: document?.number });
    }, 300_000);

    it('is refused at the filing without the name or the region it goes to', async () => {
        const v = await onTheRoad();
        // the form asks for both once the destination is outside: the request is refused before any check runs
        for (const [answers, missing] of [
            [{ vehicle: v.id, destination: 'outside', destinationRegion: REGION }, 'destinationName'],
            [{ vehicle: v.id, destination: 'outside', destinationName: DESTINATION }, 'destinationRegion']
        ] as const) {
            const filed = await api.call('POST', '/api/v1/service-requests', as.officer, { serviceCode: OUT, answers });
            expect(filed.statusCode, filed.body).toBe(422);
            expect(filed.json<{ errors?: { path: string }[] }>().errors?.map((e) => e.path)).toContain(missing);
        }
    }, 300_000);

    it('is stopped by a hold recorded before the document is issued', async () => {
        const v = await onTheRoad();
        const out = await atTheDocument(v.id);
        const held = await api.call('POST', '/api/v1/encumbrances', as.officer, {
            vehicleId: v.id,
            kind: 'bank_loan',
            holderOrganisationId: bank.id,
            letterReference: `LTR-${randomInt(100000, 999999)}`,
            letterDate: '2026-10-01'
        });
        expect(held.statusCode, held.body).toBe(201);
        const stopped = await tried(out, as.officer, 'issue_document', { answers: DOCUMENT_ANSWERS });
        expect(stopped.status).toBe(422);
        expect(stopped.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'encumbered' })]);
        expect(await query('select status from vehicles.vehicles where id = $1', [v.id])).toEqual([
            { status: 'active' }
        ]);
    }, 300_000);

    it('is refused a figure that is no whole Birr, and a year that is no Ethiopian year', async () => {
        const v = await onTheRoad();
        const out = await atTheDocument(v.id);
        const amount = await tried(out, as.officer, 'issue_document', { answers: { purchaseValueBirr: 0 } });
        expect(amount.status).toBe(422);
        const year = await tried(out, as.officer, 'issue_document', {
            answers: { earlierPlates: [{ plate: 'AA 2-1', year: 12, place: 'Addis Ababa' }] }
        });
        expect(year.status).toBe(422);
        expect(await query('select status from vehicles.vehicles where id = $1', [v.id])).toEqual([
            { status: 'active' }
        ]);
    }, 300_000);

    it('is acted on by no other service, and no office of the region can receive it', async () => {
        const v = await onTheRoad();
        const out = await atTheDocument(v.id);
        await moved(out, as.officer, 'issue_document', { answers: DOCUMENT_ANSWERS });
        // another request for it is refused at the filing: the form's vehicle list holds only vehicles on the register
        const again = await api.call('POST', '/api/v1/service-requests', as.officer, {
            serviceCode: OUT,
            answers: { vehicle: v.id, ...OUTSIDE }
        });
        expect(again.statusCode, again.body).toBe(422);
        expect(again.json<{ errors?: { path: string; code: string }[] }>().errors).toEqual([
            expect.objectContaining({ path: 'vehicle', code: 'invalid_reference' })
        ]);
        // the zone, which could receive a release to an office of the region, is refused this one
        const [release] = await query<{ id: string }>(
            'select id from vehicles.vehicle_handovers where vehicle_id = $1',
            [v.id]
        );
        const refused: unknown = await app
            .scoped(contextFor(zone), (tx) =>
                tx.execute(sql`select * from vehicles.accept_handover(${release?.id}::uuid, ${randomUUID()}::uuid)`)
            )
            .then(
                () => undefined,
                (e: unknown) => e
            );
        // refused for having no office of the region to go to, not for any other reason
        expect((refused as { cause?: { code?: string; message?: string } } | undefined)?.cause).toMatchObject({
            code: '42501',
            message: 'vehicles: the handover is not to an office of the caller'
        });
        expect(await query('select status from vehicles.vehicles where id = $1', [v.id])).toEqual([
            { status: 'transferred_out' }
        ]);
    }, 300_000);

    it('run again for the same case, returns the documents it issued', async () => {
        const v = await onTheRoad();
        let out = await atTheDocument(v.id);
        out = await moved(out, as.officer, 'issue_document', { answers: DOCUMENT_ANSWERS });
        const [row] = await query<{ facts: Record<string, unknown> }>(
            'select facts from workflow.cases where id = $1',
            [out.id]
        );
        const facts = row?.facts ?? {};
        const ctx: DbContext = { ...contextFor(boditi), requestId: `again-${randomUUID()}` };
        const second = await app.scoped(ctx, (tx) =>
            transfers.releaseOut(
                tx,
                { caseId: out.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                facts,
                DOCUMENT_ANSWERS,
                1
            )
        );
        const documents = await documentsOf(out.id);
        expect(second.documents).toEqual(Object.fromEntries(documents.map((d) => [d.key, d.id])));
        expect(Object.keys(second.documents).sort()).toEqual([
            VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE,
            VEHICLE_TRANSFER_DOCUMENT_TEMPLATE
        ]);
        expect(await query('select id from vehicles.vehicle_handovers where vehicle_id = $1', [v.id])).toHaveLength(1);
    }, 300_000);
});

describe('a covering letter for an office of the region', () => {
    it('is sent with the release when the region asks for it, addressed to the receiving office', async () => {
        await regionSetting('competency.vehicle_transfer_covering_letter', true, async () => {
            const v = await onTheRoad();
            let out = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
            out = await moved(out, as.officer, 'submit');
            out = await moved(out, as.officer, 'approve');
            await paid(out, as.boditiCashier);
            out = await moved(await caseOf(out.id, as.officer), as.lead, 'approve');
            expect(out.state).toBe('release');
            out = await moved(out, as.officer, 'release');
            expect(out.state).toBe('released');
            const letter = (await documentsOf(out.id)).find((d) => d.key === VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE);
            expect(letter?.data.documentNumber).toBeNull();
            expect(String(letter?.data.addressee)).not.toBe('');
            // the office path is not a transfer out of the region
            expect(await query('select status from vehicles.vehicles where id = $1', [v.id])).toEqual([
                { status: 'active' }
            ]);
        });
    }, 300_000);
});
