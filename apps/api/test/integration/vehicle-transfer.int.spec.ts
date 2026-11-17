/**
 * The transfer of a vehicle between two offices of the region (task 1.4c, DVC-14 and DVC-15, ADR-0057), end to end through the API
 * on a real PostgreSQL 16 with the Wolaita seeds: a Boditi vehicle carrying a national plate from Boditi's stock is transferred out
 * to the zone (filed, paid, approved, released) and received there (filed, approved, received). After the receipt the zone handles
 * the vehicle and its live records, the stock plate is the zone's with a ledger row at each office and both stocks reconcile, and
 * Boditi keeps its own cases and closed history. And the claims, the release's days, a hold recorded in transit, the inspection
 * the region may ask for, and the reviewed command refusing whoever is not the receiving office. Names and chassis are generated.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daysAfter } from '@itrms/competency/api';
import {
    importOwnershipTransferService,
    importTransferInService,
    importTransferOutService,
    importVehicleServices
} from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database, type DbContext } from '@itrms/kernel/db';
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
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    // the demo's own: Boditi's cashier and Damot Gale's head
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    zoneOfficer: '0199f0a0-d000-7000-8000-00000000f806',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    officer: '0199f0a0-d000-7000-8000-00000000f801',
    lead: '0199f0a0-d000-7000-8000-00000000f802',
    zoneLead: '0199f0a0-d000-7000-8000-00000000f803',
    zoneInspector: '0199f0a0-d000-7000-8000-00000000f804',
    zoneCashier: '0199f0a0-d000-7000-8000-00000000f805'
};
const OUT = 'DVC-14';
const IN = 'DVC-15';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let stock: PlateStock;
let region: OrgUnit;
let zone: OrgUnit;
let boditi: OrgUnit;
let damot: OrgUnit;
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

/** A vehicle of Boditi on an old regional plate with its libre in force, registered straight in the register as a seed would. */
async function onTheRoad(unit: OrgUnit = boditi, national = false) {
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
        // the national plate from the office's stock, the old one ended as exchanged
        const plate = national ? await registry.assignStockPlate(tx, ctx, vehicle.id, { since: today() }) : null;
        return { id: vehicle.id, plateId: plate?.plateId ?? null };
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

/** A Boditi vehicle transferred out to the zone, as far as `to` (the release done at 'released'). */
async function releasedToZone(vehicle?: { id: string }) {
    const v = vehicle ?? (await onTheRoad());
    let out = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
    out = await moved(out, as.officer, 'submit');
    out = await moved(out, as.officer, 'approve');
    expect(out.state).toBe('payment');
    await paid(out, as.boditiCashier);
    out = await caseOf(out.id, as.officer);
    expect(out.state).toBe('approval');
    out = await moved(out, as.lead, 'approve');
    out = await moved(out, as.officer, 'release');
    expect(out.state).toBe('released');
    return { v, out };
}

/** The zone's transfer in of a vehicle released to it, to the end. */
async function receivedAtZone(vehicleId: string) {
    let inCase = await file(IN, { vehicle: vehicleId }, as.zoneOfficer);
    inCase = await moved(inCase, as.zoneOfficer, 'submit');
    inCase = await moved(inCase, as.zoneOfficer, 'approve');
    // no fee: the payment wait is passed at once
    inCase = await caseOf(inCase.id, as.zoneOfficer);
    expect(inCase.state).toBe('approval');
    inCase = await moved(inCase, as.zoneLead, 'approve');
    inCase = await moved(inCase, as.zoneOfficer, 'receive');
    expect(inCase.state).toBe('received');
    return inCase;
}

const query = async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await api.owner.query<T>(text, params)).rows;

const handlingOf = async (table: string, where: string, params: unknown[]) =>
    (await query<{ unit: string }>(`select handling_unit_id as unit from ${table} where ${where}`, params)).map(
        (r) => r.unit
    );

const handoversOf = (vehicleId: string) =>
    query<{ id: string; status: string; to_unit_id: string; valid_until: string; in_case_id: string | null }>(
        `select id, status, to_unit_id, valid_until::text, in_case_id from vehicles.vehicle_handovers
          where vehicle_id = $1 order by created_at`,
        [vehicleId]
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
            username: 'test.vt.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.vt.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            // files and acts: competency.officer acts on a case, records_officer files it (case:create)
            username: 'test.vt.zoneofficer',
            sub: SUB.zoneOfficer,
            region: 'SER',
            home: 'WOL',
            roles: [
                ['WOL', 'competency.officer'],
                ['WOL', 'records_officer']
            ]
        },
        {
            username: 'test.vt.zonelead',
            sub: SUB.zoneLead,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.lead']]
        },
        {
            username: 'test.vt.zonecashier',
            sub: SUB.zoneCashier,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'cashier']]
        },
        {
            username: 'test.vt.zoneinspector',
            sub: SUB.zoneInspector,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.inspector']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    registry = api.http.get(VehicleRegistry);
    stock = api.http.get(PlateStock);
    region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.zoneOfficer = { sub: SUB.zoneOfficer, unit: zone };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.zoneLead = { sub: SUB.zoneLead, unit: zone };
    as.zoneInspector = { sub: SUB.zoneInspector, unit: zone };
    as.zoneCashier = { sub: SUB.zoneCashier, unit: zone };

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
    });
    expect(await importPlateStockDemo(api.installer, 'SER', stock, today())).not.toBeNull();
    const person = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ባለቤት', father: 'ዝውውር', grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: 'Mover', grandfather: 'Person' },
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

describe('a vehicle moved from Boditi to the zone', () => {
    it('is released by Boditi, then handled by the zone with its live records and its stock plate', async () => {
        const v = await onTheRoad(boditi, true);
        const { out } = await releasedToZone(v);
        // released, not moved: Boditi still handles it until the zone receives it
        expect(await handlingOf('vehicles.vehicles', 'id = $1', [v.id])).toEqual([boditi.id]);
        const [release] = await handoversOf(v.id);
        expect(release).toMatchObject({ status: 'released', to_unit_id: zone.id, valid_until: daysAfter(today(), 15) });

        const inCase = await receivedAtZone(v.id);
        expect(await handlingOf('vehicles.vehicles', 'id = $1', [v.id])).toEqual([zone.id]);
        // the live records moved; the closed history stayed where it was made
        expect(await handlingOf('vehicles.vehicle_ownerships', 'vehicle_id = $1 and until is null', [v.id])).toEqual([
            zone.id
        ]);
        expect(
            await handlingOf(
                'vehicles.vehicle_owners',
                'ownership_id in (select id from vehicles.vehicle_ownerships where vehicle_id = $1)',
                [v.id]
            )
        ).toEqual([zone.id]);
        expect(await handlingOf('vehicles.plate_assignments', 'vehicle_id = $1 and until is null', [v.id])).toEqual([
            zone.id
        ]);
        expect(await handlingOf('vehicles.plate_assignments', 'vehicle_id = $1 and until is not null', [v.id])).toEqual(
            [boditi.id]
        );
        expect(await handlingOf('vehicles.libres', "vehicle_id = $1 and status = 'issued'", [v.id])).toEqual([zone.id]);
        // the stock plate is the zone's, with a ledger row at each office
        expect(
            await query<{ holder: string; status: string }>(
                'select holder_unit_id as holder, status from vehicles.plates where id = $1',
                [v.plateId]
            )
        ).toEqual([{ holder: zone.id, status: 'assigned' }]);
        expect(
            await query<{ kind: string; unit: string }>(
                `select kind, unit_id as unit from vehicles.plate_movements
                  where plate_id = $1 and kind like 'hand_over_%' order by kind`,
                [v.plateId]
            )
        ).toEqual([
            { kind: 'hand_over_in', unit: zone.id },
            { kind: 'hand_over_out', unit: boditi.id }
        ]);
        expect(await handoversOf(v.id)).toEqual([
            expect.objectContaining({ status: 'received', in_case_id: inCase.id })
        ]);
        // each row the command moved is on record in the receipt's transaction
        const [events] = await query<{ n: number }>(
            `select count(*)::int as n from kernel.audit_log
              where event_type = 'vehicles.handover_moved' and diff->>'caseId' = $1`,
            [inCase.id]
        );
        expect(events?.n).toBe(9);
        // both stocks reconcile, and the zone's with Boditi below it
        for (const unit of [boditi, zone]) {
            const summary = await app.scoped(contextFor(unit), (tx) => stock.summary(tx, contextFor(unit)));
            expect(summary.unit.reconciled, unit.code).toBe(true);
            for (const child of summary.children) expect(child.reconciled, child.unit.code).toBe(true);
        }
        expect(out.state).toBe('released');
    }, 300_000);

    it('leaves Boditi only its own cases and no hand on the vehicle; the zone acts on it', async () => {
        const { v, out } = await releasedToZone();
        const inCase = await receivedAtZone(v.id);
        // Boditi reads its transfer out, not the zone's transfer in; a sibling reads neither
        expect((await api.call('GET', `/api/v1/cases/${out.id}`, as.officer)).statusCode).toBe(200);
        expect((await api.call('GET', `/api/v1/cases/${inCase.id}`, as.officer)).statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/cases/${out.id}`, as.damotHead)).statusCode).toBe(404);
        // Boditi can no longer file for it
        const again = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
        const refused = await tried(again, as.officer, 'submit');
        expect(refused.status).toBe(422);
        expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'other_office' })]);
        // nor write it; the zone can
        const touch = (unit: OrgUnit) =>
            app.scoped(contextFor(unit), async (tx) => {
                const r = await tx.execute(sql`update vehicles.vehicles set colour = colour where id = ${v.id}`);
                return r.rowCount;
            });
        expect(await touch(boditi)).toBe(0);
        expect(await touch(zone)).toBe(1);
        // both read the vehicle
        for (const who of [as.officer, as.zoneOfficer])
            expect((await api.call('GET', `/api/v1/vehicles/${v.id}`, who)).statusCode).toBe(200);
    }, 300_000);
});

describe('the claims on a vehicle on its way', () => {
    it('refuses another request while the transfer out is open, and while the release stands except the receiving office’s', async () => {
        const v = await onTheRoad();
        let out = await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer);
        out = await moved(out, as.officer, 'submit');
        // a second transfer out of the same vehicle
        const second = await tried(
            await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer),
            as.officer,
            'submit'
        );
        expect(second.status).toBe(422);
        expect(second.body.code).toBe('not_eligible');
        // finish the release
        out = await moved(out, as.officer, 'approve');
        await paid(out, as.boditiCashier);
        out = await moved(await caseOf(out.id, as.officer), as.lead, 'approve');
        expect((await moved(out, as.officer, 'release')).state).toBe('released');
        // released: Boditi may not file another transfer out
        const third = await tried(
            await file(OUT, { vehicle: v.id, toOffice: zone.id }, as.officer),
            as.officer,
            'submit'
        );
        expect(third.status).toBe(422);
        // the zone's transfer in passes; a second one of the zone is refused while the first is open
        const first = await moved(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
        expect(first.state).toBe('review');
        const twice = await tried(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
        expect(twice.status).toBe(422);
    }, 300_000);

    it('refuses a transfer in for a vehicle not released to that office', async () => {
        const v = await onTheRoad();
        const notReleased = await tried(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
        expect(notReleased.status).toBe(422);
        expect(notReleased.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'not_released' })]);
        const here = await tried(await file(IN, { vehicle: v.id }, as.officer), as.officer, 'submit');
        expect(here.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'handled_here' })]);
        // nor out to an office that takes no vehicles in (a woreda), or to itself
        const toWoreda = await tried(
            await file(OUT, { vehicle: v.id, toOffice: damot.id }, as.officer),
            as.officer,
            'submit'
        );
        expect(toWoreda.body.errors).toEqual([expect.objectContaining({ path: 'toOffice', code: 'not_offered' })]);
        const toItself = await tried(
            await file(OUT, { vehicle: v.id, toOffice: boditi.id }, as.officer),
            as.officer,
            'submit'
        );
        expect(toItself.body.errors).toEqual([expect.objectContaining({ path: 'toOffice', code: 'same_office' })]);
    }, 300_000);
});

describe('the release’s days', () => {
    it('stand as the region sets them, and a lapsed release is refused and expired by the next', async () => {
        await regionSetting('competency.vehicle_transfer_valid_days', 3, async () => {
            const { v } = await releasedToZone();
            const [release] = await handoversOf(v.id);
            expect(release?.valid_until).toBe(daysAfter(today(), 3));
            // the zone filed its transfer in while the release stood: once it lapses, that case claims the vehicle no more
            const early = await moved(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
            expect(early.state).toBe('review');
            // the release lapsed (the days set back: the guard on its days is lifted for this one write)
            await api.owner.query('alter table vehicles.vehicle_handovers disable trigger handover_transition');
            try {
                await api.owner.query(
                    `update vehicles.vehicle_handovers set released_on = $2::date, valid_until = $3::date where id = $1`,
                    [release?.id, daysAfter(today(), -10), daysAfter(today(), -1)]
                );
            } finally {
                await api.owner.query('alter table vehicles.vehicle_handovers enable trigger handover_transition');
            }
            const lapsed = await tried(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
            expect(lapsed.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'release_lapsed' })]);
            // the lapsed release no longer claims the vehicle: Boditi releases it again, and the old one is expired
            await releasedToZone(v);
            expect((await handoversOf(v.id)).map((h) => h.status)).toEqual(['expired', 'released']);
        });
    }, 300_000);
});

describe('a hold recorded while the vehicle is on its way', () => {
    it('stops the receipt, naming the holder', async () => {
        const { v } = await releasedToZone();
        let inCase = await moved(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
        inCase = await moved(inCase, as.zoneOfficer, 'approve');
        inCase = await moved(await caseOf(inCase.id, as.zoneOfficer), as.zoneLead, 'approve');
        // Boditi still handles it: Boditi records the bank's hold
        const held = await api.call('POST', '/api/v1/encumbrances', as.officer, {
            vehicleId: v.id,
            kind: 'bank_loan',
            holderOrganisationId: bank.id,
            letterReference: `LTR-${randomInt(100000, 999999)}`,
            letterDate: '2026-10-01'
        });
        expect(held.statusCode, held.body).toBe(201);
        const stopped = await tried(inCase, as.zoneOfficer, 'receive');
        expect(stopped.status).toBe(422);
        expect(stopped.body.errors).toEqual([expect.objectContaining({ path: 'vehicle', code: 'encumbered' })]);
        expect(await handlingOf('vehicles.vehicles', 'id = $1', [v.id])).toEqual([boditi.id]);
    }, 300_000);
});

describe('the inspection the region may ask for', () => {
    it('is a step of the transfer in when the setting is on at the filing, and none when it is off', async () => {
        await regionSetting('competency.vehicle_transfer_reinspect', true, async () => {
            const { v } = await releasedToZone();
            let inCase = await moved(await file(IN, { vehicle: v.id }, as.zoneOfficer), as.zoneOfficer, 'submit');
            inCase = await moved(inCase, as.zoneOfficer, 'approve');
            expect(inCase.state).toBe('inspection');
            const notMatching = await tried(inCase, as.zoneInspector, 'inspect', {
                answers: { inspectionMatches: false }
            });
            expect(notMatching.status).toBe(422);
            inCase = await moved(inCase, as.zoneInspector, 'inspect', { answers: { inspectionMatches: true } });
            expect((await caseOf(inCase.id, as.zoneOfficer)).state).toBe('approval');
        });
    }, 300_000);
});

describe('the reviewed command that moves the vehicle', () => {
    it('refuses anyone but the receiving office, and a second receipt moves nothing', async () => {
        const { v } = await releasedToZone();
        const [release] = await handoversOf(v.id);
        const accept = (unit: OrgUnit, caseId: string) =>
            app.scoped(contextFor(unit), (tx) =>
                tx.execute(sql`select * from vehicles.accept_handover(${release?.id}::uuid, ${caseId}::uuid)`)
            );
        // the releasing office, a sibling: not offices of the receipt
        await expect(accept(boditi, randomUUID())).rejects.toMatchObject({ cause: { code: '42501' } });
        await expect(accept(damot, randomUUID())).rejects.toMatchObject({ cause: { code: '42501' } });
        // nobody: no context
        await expect(
            app.scoped({}, (tx) =>
                tx.execute(sql`select * from vehicles.accept_handover(${release?.id}::uuid, ${randomUUID()}::uuid)`)
            )
        ).rejects.toMatchObject({ cause: { code: '42501' } });
        // the receiving office, but with a case that is not this release's transfer in
        await expect(accept(zone, randomUUID())).rejects.toMatchObject({ cause: { code: '23514' } });
        // the app may not write a receipt itself
        await expect(
            app.scoped(contextFor(boditi), (tx) =>
                tx.execute(
                    sql`update vehicles.vehicle_handovers set in_case_id = ${randomUUID()} where id = ${release?.id}`
                )
            )
        ).rejects.toMatchObject({ cause: { code: '42501' } });
        // the zone receives it through its case; the command run again for that case moves nothing
        const inCase = await receivedAtZone(v.id);
        const again = await accept(zone, inCase.id);
        expect(again.rows).toEqual([]);
    }, 300_000);
});

describe('a vehicle moved down the tree, from the zone to Boditi', () => {
    it('is received by an office that cannot reach the zone’s records itself: only the reviewed command moves them', async () => {
        const v = await onTheRoad(zone);
        let out = await file(OUT, { vehicle: v.id, toOffice: boditi.id }, as.zoneOfficer);
        out = await moved(out, as.zoneOfficer, 'submit');
        out = await moved(out, as.zoneOfficer, 'approve');
        await paid(out, as.zoneCashier);
        out = await moved(await caseOf(out.id, as.zoneOfficer), as.zoneLead, 'approve');
        expect((await moved(out, as.zoneOfficer, 'release')).state).toBe('released');
        // Boditi cannot write the zone's vehicle before the receipt
        const touch = (unit: OrgUnit) =>
            app.scoped(contextFor(unit), async (tx) => {
                const r = await tx.execute(sql`update vehicles.vehicles set colour = colour where id = ${v.id}`);
                return r.rowCount;
            });
        expect(await touch(boditi)).toBe(0);
        let inCase = await moved(await file(IN, { vehicle: v.id }, as.officer), as.officer, 'submit');
        inCase = await moved(inCase, as.officer, 'approve');
        inCase = await moved(await caseOf(inCase.id, as.officer), as.lead, 'approve');
        expect((await moved(inCase, as.officer, 'receive')).state).toBe('received');
        expect(await handlingOf('vehicles.vehicles', 'id = $1', [v.id])).toEqual([boditi.id]);
        expect(await handlingOf('vehicles.libres', "vehicle_id = $1 and status = 'issued'", [v.id])).toEqual([
            boditi.id
        ]);
        expect(await touch(boditi)).toBe(1);
    }, 300_000);
});

describe('the tree changed after a receipt', () => {
    it('moves an office above a received handover, and back', async () => {
        const { v } = await releasedToZone();
        await receivedAtZone(v.id);
        const other = await api.unit('SER', 'TZB');
        const moveTo = async (parentId: string) => {
            const unit = (await api.call('GET', `/api/v1/org-units/${boditi.id}`, as.bureau)).json<{
                version: number;
            }>();
            const res = await api.call(
                'POST',
                `/api/v1/org-units/${boditi.id}/moves`,
                as.bureau,
                { parentId },
                ifMatch(unit.version)
            );
            expect(res.statusCode, res.body).toBe(200);
        };
        await moveTo(other.id);
        await moveTo(zone.id);
        expect((await handoversOf(v.id)).map((h) => h.status)).toEqual(['received']);
    }, 300_000);
});
