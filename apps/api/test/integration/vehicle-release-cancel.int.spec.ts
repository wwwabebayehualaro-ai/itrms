/**
 * The cancellation of a vehicle release (task 1.4c2b, DVC-16, ADR-0059), end to end through the API on a real PostgreSQL 16 with the
 * Wolaita seeds: the office that released a vehicle (to the zone, or outside the region) files, an officer checks and a lead
 * approves. The release is cancelled, final; a vehicle released outside the region reads active again with its owners, plate, libre
 * and stock plate as they were; the release's documents read revoked. A release to another region is cancelled only with its
 * transfer document's number (once the document has lapsed, without it unless the region says no). A receiving office's transfer in
 * or another cancellation stops it, and the reviewed trigger holds the status when it is written by hand. Names and chassis are
 * generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daysAfter, VehicleTransferService } from '@itrms/competency/api';
import {
    VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE,
    VEHICLE_TRANSFER_DOCUMENT_COUNTER,
    VEHICLE_TRANSFER_DOCUMENT_PATTERN,
    VEHICLE_TRANSFER_DOCUMENT_TEMPLATE
} from '@itrms/competency/contracts';
import {
    importOwnershipTransferService,
    importReleaseCancelService,
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
    officer: '0199f0a0-d000-7000-8000-00000000f821',
    lead: '0199f0a0-d000-7000-8000-00000000f822',
    zoneOfficer: '0199f0a0-d000-7000-8000-00000000f823',
    zoneLead: '0199f0a0-d000-7000-8000-00000000f824'
};
const OUT = 'DVC-14';
const IN = 'DVC-15';
const CANCEL = 'DVC-16';
const DESTINATION = 'Sample Transport Bureau';
const REGION = 'Sample Region';
const OUTSIDE = { destination: 'outside', destinationName: DESTINATION, destinationRegion: REGION };
const REASON = 'The owner changed their mind';
const UNRETURNED = 'competency.vehicle_release_cancel_unreturned';

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
async function onTheRoad() {
    const ctx: DbContext = { ...contextFor(boditi), requestId: `seed-${randomUUID()}` };
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

const DOCUMENT_ANSWERS = { customsDeclarationNumber: 'CD-1', purchaseValueBirr: 350000 };

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

const handlingOf = async (table: string, where: string, params: unknown[]) =>
    (await query<{ unit: string }>(`select handling_unit_id as unit from ${table} where ${where}`, params)).map(
        (r) => r.unit
    );

const statusOf = async (vehicleId: string) =>
    (await query<{ status: string }>('select status from vehicles.vehicles where id = $1', [vehicleId]))[0]?.status;

const documentsOf = (caseId: string) =>
    query<{ key: string; id: string; number: string; revoked_at: string | null }>(
        `select t.key, d.id, d.number, d.revoked_at::text from documents.issued_documents d
           join documents.document_templates t on t.id = d.template_id
          where d.case_id = $1 and d.superseded_by is null order by t.key`,
        [caseId]
    );

const handoverOf = async (vehicleId: string) =>
    (
        await query<{
            id: string;
            status: string;
            cancel_case_id: string | null;
            cancelled_on: string | null;
            cancelled_by: string | null;
        }>(
            `select id, status, cancel_case_id, cancelled_on::text, cancelled_by from vehicles.vehicle_handovers
              where vehicle_id = $1 order by created_at desc`,
            [vehicleId]
        )
    )[0];

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

/** A release to the zone, standing. */
async function releasedToZone() {
    const v = await onTheRoad();
    let out = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
    out = await moved(out, as.officer, 'submit');
    out = await moved(out, as.officer, 'approve');
    await paid(out, as.boditiCashier);
    out = await moved(await caseOf(out.id, as.officer), as.lead, 'approve');
    out = await moved(out, as.officer, 'release');
    expect(out.state).toBe('released');
    return { v, out };
}

/** A release outside the region, standing, with its transfer document. */
async function releasedOutside() {
    const v = await onTheRoad();
    let out = await file(OUT, { vehicle: v.id, ...OUTSIDE }, as.officer);
    out = await moved(out, as.officer, 'submit');
    out = await moved(out, as.officer, 'approve');
    await paid(out, as.boditiCashier);
    out = await moved(await caseOf(out.id, as.officer), as.lead, 'approve');
    expect(out.state).toBe('document');
    out = await moved(out, as.officer, 'issue_document', { answers: DOCUMENT_ANSWERS });
    expect(out.state).toBe('transferred_out');
    const document = (await documentsOf(out.id)).find((d) => d.key === VEHICLE_TRANSFER_DOCUMENT_TEMPLATE);
    return { v, out, number: document?.number ?? '' };
}

const cancelAnswers = (vehicleId: string, more: Record<string, unknown> = {}) => ({
    vehicle: vehicleId,
    reason: REASON,
    ...more
});

/** The cancellation, to the end: the officer checks, the lead approves. */
async function cancelled(vehicleId: string, more: Record<string, unknown> = {}): Promise<CaseOut> {
    let c = await file(CANCEL, cancelAnswers(vehicleId, more), as.officer);
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('cancelled');
    return c;
}

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

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.vrc.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.vrc.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.vrc.zoneofficer',
            sub: SUB.zoneOfficer,
            region: 'SER',
            home: 'WOL',
            roles: [
                ['WOL', 'competency.officer'],
                ['WOL', 'records_officer']
            ]
        },
        {
            username: 'test.vrc.zonelead',
            sub: SUB.zoneLead,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.lead']]
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
    as.zoneOfficer = { sub: SUB.zoneOfficer, unit: zone };
    as.zoneLead = { sub: SUB.zoneLead, unit: zone };

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
        expect(await importReleaseCancelService(tx, root)).toBe(1);
        await setUpCounter(tx, {
            key: VEHICLE_TRANSFER_DOCUMENT_COUNTER,
            unitId: boditi.id,
            regionId: root.regionId,
            pattern: VEHICLE_TRANSFER_DOCUMENT_PATTERN
        });
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ስረዛ', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Canceller', grandfather: 'Person' },
        sex: 'female',
        birthYear: 1985,
        acknowledgedDuplicates: []
    });
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
}, 300_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('the cancellation of a release to an office of the region', () => {
    it('ends the release, revokes its letter, leaves the vehicle active at Boditi and lets it be released again', async () => {
        await regionSetting('competency.vehicle_transfer_covering_letter', true, async () => {
            const { v, out } = await releasedToZone();
            const [letter] = await documentsOf(out.id);
            expect(letter?.key).toBe(VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE);
            expect(letter?.revoked_at).toBeNull();

            const c = await cancelled(v.id);
            const handover = await handoverOf(v.id);
            expect(handover).toMatchObject({ status: 'cancelled', cancel_case_id: c.id, cancelled_on: today() });
            expect(handover?.cancelled_by).not.toBeNull();
            expect((await documentsOf(out.id))[0]?.revoked_at).not.toBeNull();
            expect(await statusOf(v.id)).toBe('active');
            expect(await handlingOf('vehicles.vehicles', 'id = $1', [v.id])).toEqual([boditi.id]);
            // the cancellation is on record, in the step's transaction
            expect(
                await query(
                    `select action as line from kernel.audit_log
                      where table_name = 'vehicles.vehicle_handovers' and row_id = $1 order by action`,
                    [handover?.id]
                )
            ).toEqual([{ line: 'insert' }, { line: 'update' }]);

            // the zone's transfer in is refused: nothing is released to it any more
            const inCase = await file(IN, { vehicle: v.id }, as.zoneOfficer);
            const refused = await tried(inCase, as.zoneOfficer, 'submit');
            expect(refused.status).toBe(422);
            expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'not_released' })]);
            // and Boditi may release it again
            const again = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
            expect((await moved(again, as.officer, 'submit')).state).toBe('review');
        });
    }, 300_000);

    it('is refused while the receiving office has filed its transfer in, or another cancellation is open', async () => {
        const { v } = await releasedToZone();
        const inCase = await moved(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
        const stopped = await tried(await file(CANCEL, cancelAnswers(v.id), as.officer), as.officer, 'submit');
        expect(stopped.status).toBe(422);
        expect(stopped.body.code).toBe('not_eligible');
        // the transfer in goes no further than its filing: withdrawn, the cancellation may go ahead
        await moved(await caseOf(inCase.id, as.zoneOfficer), as.zoneOfficer, 'return', { comment: 'a mistake' });
        await moved(await caseOf(inCase.id, as.zoneOfficer), as.zoneOfficer, 'withdraw', { comment: 'a mistake' });

        const first = await moved(await file(CANCEL, cancelAnswers(v.id), as.officer), as.officer, 'submit');
        expect(first.state).toBe('review');
        // another cancellation, and a transfer in, are stopped by the open one
        const second = await tried(await file(CANCEL, cancelAnswers(v.id), as.officer), as.officer, 'submit');
        expect(second.status).toBe(422);
        expect(second.body.code).toBe('not_eligible');
        const late = await tried(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
        expect(late.status).toBe(422);
        expect(late.body.code).toBe('not_eligible');
    }, 300_000);

    it('is not offered to another office, which cannot file it', async () => {
        const { v } = await releasedToZone();
        const [chassis] = await query<{ c: string }>(
            'select chassis_number as c from vehicles.vehicles where id = $1',
            [v.id]
        );
        const [plate] = await query<{ p: string }>(
            'select plate_text as p from vehicles.plate_assignments where vehicle_id = $1 and until is null',
            [v.id]
        );
        const listed = async (who: As, q = chassis?.c ?? '') => {
            const res = await api.call(
                'GET',
                `/api/v1/registry-lookups/released-vehicle?q=${encodeURIComponent(q)}`,
                who
            );
            expect(res.statusCode, res.body).toBe(200);
            return res.json<{ items: { id: string }[] }>().items.map((i) => i.id);
        };
        expect(await listed(as.officer)).toContain(v.id);
        // found by its plate too, as the register's own search reads it
        expect(plate?.p).toBeTruthy();
        expect(await listed(as.officer, plate?.p ?? '')).toContain(v.id);
        expect(await listed(as.officer, 'ZZZZZZ')).not.toContain(v.id);
        // the zone reads the vehicle, but the release is Boditi's to cancel
        expect(await listed(as.zoneOfficer)).not.toContain(v.id);
        const filed = await api.call('POST', '/api/v1/service-requests', as.zoneOfficer, {
            serviceCode: CANCEL,
            answers: cancelAnswers(v.id)
        });
        expect(filed.statusCode, filed.body).toBe(422);
        expect(filed.json<ProblemBody>().errors).toEqual([
            expect.objectContaining({ path: 'vehicle', code: 'invalid_reference' })
        ]);
    }, 300_000);
});

describe('the cancellation of a release outside the region', () => {
    it('with the number of its document, written as the owner reads it, makes the vehicle active as it was', async () => {
        const { v, out, number } = await releasedOutside();
        expect(await statusOf(v.id)).toBe('transferred_out');
        await cancelled(v.id, { documentNumber: `  ${number.toLowerCase().replace(/\//g, ' / ')} ` });

        expect(await statusOf(v.id)).toBe('active');
        expect((await handoverOf(v.id))?.status).toBe('cancelled');
        expect(await handlingOf('vehicles.vehicle_ownerships', 'vehicle_id = $1 and until is null', [v.id])).toEqual([
            boditi.id
        ]);
        expect(await handlingOf('vehicles.plate_assignments', 'vehicle_id = $1 and until is null', [v.id])).toEqual([
            boditi.id
        ]);
        expect(await handlingOf('vehicles.libres', "vehicle_id = $1 and status = 'issued'", [v.id])).toEqual([
            boditi.id
        ]);
        expect(
            await query('select holder_unit_id as holder, status from vehicles.plates where id = $1', [v.plateId])
        ).toEqual([{ holder: boditi.id, status: 'assigned' }]);
        const documents = await documentsOf(out.id);
        expect(documents.map((d) => d.key).sort()).toEqual([
            VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE,
            VEHICLE_TRANSFER_DOCUMENT_TEMPLATE
        ]);
        for (const d of documents) expect(d.revoked_at, d.key).not.toBeNull();
        // another service may act on it again
        const again = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
        expect((await moved(again, as.officer, 'submit')).state).toBe('review');
    }, 300_000);

    it('is refused a wrong number, no number while the document is valid, and no reason', async () => {
        const { v } = await releasedOutside();
        const wrong = await tried(
            await file(CANCEL, cancelAnswers(v.id, { documentNumber: 'XX/VT/99999/2019' }), as.officer),
            as.officer,
            'submit'
        );
        expect(wrong.status).toBe(422);
        expect(wrong.body.errors).toEqual([expect.objectContaining({ path: 'documentNumber', code: 'not_matching' })]);
        const missing = await tried(await file(CANCEL, cancelAnswers(v.id), as.officer), as.officer, 'submit');
        expect(missing.status).toBe(422);
        expect(missing.body.errors).toEqual([expect.objectContaining({ path: 'documentNumber', code: 'required' })]);
        const noReason = await api.call('POST', '/api/v1/service-requests', as.officer, {
            serviceCode: CANCEL,
            answers: { vehicle: v.id }
        });
        expect(noReason.statusCode, noReason.body).toBe(422);
        expect(noReason.json<ProblemBody>().errors?.map((e) => e.path)).toContain('reason');
        expect(await statusOf(v.id)).toBe('transferred_out');
    }, 300_000);

    it('is checked afresh when a returned request is corrected to name another vehicle', async () => {
        const a = await releasedOutside();
        const b = await releasedOutside();
        let c = await file(CANCEL, cancelAnswers(a.v.id, { documentNumber: a.number }), as.officer);
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'return', { comment: 'Wrong vehicle' });
        c = await moved(c, as.officer, 'correct', {
            answers: cancelAnswers(b.v.id, { documentNumber: b.number })
        });
        expect(c.state).toBe('review');
        c = await moved(c, as.officer, 'approve');
        c = await moved(c, as.lead, 'approve');
        expect(c.state).toBe('cancelled');
        expect((await handoverOf(b.v.id))?.status).toBe('cancelled');
        expect((await handoverOf(a.v.id))?.status).toBe('released');
    }, 300_000);

    it('once its document has lapsed, goes ahead without it, unless the region says no', async () => {
        const { v, out } = await releasedOutside();
        // the trigger refuses a day moved by hand: this is the passing of time
        try {
            await api.owner.query('alter table vehicles.vehicle_handovers disable trigger user');
            await api.owner.query('alter table documents.issued_documents disable trigger user');
            await api.owner.query(
                `update vehicles.vehicle_handovers set released_on = $2::date - 3, valid_until = $2::date - 1
                  where vehicle_id = $1`,
                [v.id, today()]
            );
            await api.owner.query(
                'update documents.issued_documents set valid_until = $2::date - 1 where case_id = $1',
                [out.id, today()]
            );
        } finally {
            await api.owner.query('alter table documents.issued_documents enable trigger user');
            await api.owner.query('alter table vehicles.vehicle_handovers enable trigger user');
        }
        expect(daysAfter(today(), -1) < today()).toBe(true);
        await regionSetting(UNRETURNED, false, async () => {
            const off = await tried(await file(CANCEL, cancelAnswers(v.id), as.officer), as.officer, 'submit');
            expect(off.status).toBe(422);
            expect(off.body.errors).toEqual([expect.objectContaining({ path: 'documentNumber', code: 'required' })]);
        });
        await cancelled(v.id);
        expect(await statusOf(v.id)).toBe('active');
        expect((await handoverOf(v.id))?.status).toBe('cancelled');
    }, 300_000);
});

describe('the cancelled status', () => {
    it('is written only by the case that names the release; and is final', async () => {
        const { v, number } = await releasedOutside();
        const handover = await handoverOf(v.id);
        // no case of the office names this release: refused by the trigger, whoever writes it
        expect(
            await refusedAs(
                boditi,
                sql`update vehicles.vehicle_handovers set status = 'cancelled', cancel_case_id = ${randomUUID()}::uuid,
                        cancelled_on = ${today()}::date, cancelled_by = ${randomUUID()}::uuid where id = ${handover?.id}::uuid`
            )
        ).toMatchObject({ code: '23514', constraint: 'handover_transition' });
        expect((await handoverOf(v.id))?.status).toBe('released');

        await cancelled(v.id, { documentNumber: number });
        expect(
            await refusedAs(
                boditi,
                sql`update vehicles.vehicle_handovers set status = 'released' where id = ${handover?.id}::uuid`
            )
        ).toMatchObject({ code: '23514', constraint: 'handover_transition' });
        expect((await handoverOf(v.id))?.status).toBe('cancelled');
    }, 300_000);

    it('is not written by a case that is closed, or that is no DVC-16 case', async () => {
        const write = (handoverId: string | undefined, caseId: string) =>
            refusedAs(
                boditi,
                sql`update vehicles.vehicle_handovers set status = 'cancelled', cancel_case_id = ${caseId}::uuid,
                        cancelled_on = (now() at time zone 'Africa/Addis_Ababa')::date, cancelled_by = kernel.ctx_user()
                    where id = ${handoverId}::uuid`
            );
        const trigger = { code: '23514', constraint: 'handover_transition' };
        // a cancellation filed and checked, then rejected: its facts still name the release, but the case is closed
        const { v, out, number } = await releasedOutside();
        const handover = await handoverOf(v.id);
        let rejected = await file(CANCEL, cancelAnswers(v.id, { documentNumber: number }), as.officer);
        rejected = await moved(rejected, as.officer, 'submit');
        rejected = await moved(rejected, as.officer, 'reject', { comment: 'The owner withdrew' });
        expect(rejected.state).toBe('rejected');
        expect(await write(handover?.id, rejected.id)).toMatchObject(trigger);
        // the same for one that was returned and withdrawn
        const other = await releasedOutside();
        const otherHandover = await handoverOf(other.v.id);
        let withdrawn = await file(CANCEL, cancelAnswers(other.v.id, { documentNumber: other.number }), as.officer);
        withdrawn = await moved(withdrawn, as.officer, 'submit');
        withdrawn = await moved(withdrawn, as.officer, 'return', { comment: 'Not yet' });
        withdrawn = await moved(withdrawn, as.officer, 'withdraw', { comment: 'The owner withdrew' });
        expect(await write(otherHandover?.id, withdrawn.id)).toMatchObject(trigger);
        // a DVC-16 case that is open at review cannot be stood in for by a case of another service, the release's own included
        const third = await releasedOutside();
        const thirdHandover = await handoverOf(third.v.id);
        const open = await moved(
            await file(CANCEL, cancelAnswers(third.v.id, { documentNumber: third.number }), as.officer),
            as.officer,
            'submit'
        );
        expect(await write(thirdHandover?.id, third.out.id)).toMatchObject(trigger);
        expect(await write(thirdHandover?.id, out.id)).toMatchObject(trigger);
        // and the case itself is held to its service: made another one's, it names the release and is still refused
        await api.owner.query(
            `update workflow.cases set config = config || '{"serviceCode":"DVC-99"}'::jsonb where id = $1`,
            [open.id]
        );
        expect(await write(thirdHandover?.id, open.id)).toMatchObject(trigger);
        expect((await handoverOf(v.id))?.status).toBe('released');
    }, 300_000);

    it('is never written over a release that was received', async () => {
        const { v } = await releasedToZone();
        let inCase = await file(IN, { vehicle: v.id }, as.zoneOfficer);
        inCase = await moved(inCase, as.zoneOfficer, 'submit');
        inCase = await moved(inCase, as.zoneOfficer, 'approve');
        inCase = await moved(await caseOf(inCase.id, as.zoneOfficer), as.zoneLead, 'approve');
        inCase = await moved(inCase, as.zoneOfficer, 'receive');
        expect(inCase.state).toBe('received');
        const handover = await handoverOf(v.id);
        expect(
            await refusedAs(
                zone,
                sql`update vehicles.vehicle_handovers set status = 'cancelled', cancel_case_id = ${randomUUID()}::uuid,
                        cancelled_on = ${today()}::date, cancelled_by = ${randomUUID()}::uuid where id = ${handover?.id}::uuid`
            )
        ).toBeDefined();
        expect((await handoverOf(v.id))?.status).toBe('received');
    }, 300_000);

    it('run again for the same case, writes nothing more', async () => {
        const { v } = await releasedToZone();
        const c = await cancelled(v.id);
        const before = await query('select id from kernel.audit_log where table_name = $1 and row_id = $2', [
            'vehicles.vehicle_handovers',
            (await handoverOf(v.id))?.id
        ]);
        const [row] = await query<{ facts: Record<string, unknown> }>(
            'select facts from workflow.cases where id = $1',
            [c.id]
        );
        const ctx: DbContext = { ...contextFor(boditi), requestId: `again-${randomUUID()}` };
        const second = await app.scoped(ctx, (tx) =>
            transfers.cancelRelease(
                tx,
                { caseId: c.id, regionId: boditi.regionId, handlingUnitId: boditi.id, ctx },
                row?.facts ?? {}
            )
        );
        expect(second).toMatchObject({ cancelled: { vehicleActive: false, revoked: [] } });
        expect(
            await query('select id from kernel.audit_log where table_name = $1 and row_id = $2', [
                'vehicles.vehicle_handovers',
                (await handoverOf(v.id))?.id
            ])
        ).toHaveLength(before.length);
    }, 300_000);
});

describe('the reviewed question of an open case', () => {
    it('answers yes with no context, as the register does', async () => {
        expect(
            await query('select competency.release_in_open_case(gen_random_uuid(), gen_random_uuid(), null) as taken')
        ).toEqual([{ taken: true }]);
    });
});
