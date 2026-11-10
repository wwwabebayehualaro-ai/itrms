/**
 * The stock of national plates (task 1.2a) on a real PostgreSQL 16 with the Wolaita seeds, Test Zone B and Test Region X:
 * plates received by the bureau, handed down to the zone and on to Boditi (each level accepts what it was sent), recalled
 * and written off, and assigned to vehicles from an office's own stock; the counts of every unit reconcile with its ledger
 * after each step; no plate is assigned twice, even by two officers at once; the database refuses a step the machine does
 * not allow, whatever the writer; every change is audited in its command's transaction; the isolation matrix on the three
 * tables. Plates and names are generated (series Q.. are never real plates of the demo).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { orgUnits, type OrgUnit } from '@itrms/kernel/org';
import {
    asUnit,
    contextFor,
    ISOLATION_CASES,
    TEST_CONTEXT_KEY,
    VISIBLE,
    WRITABLE,
    type IsolationCase
} from '@itrms/kernel/testing';
import { PlateStock, VehicleRegistry } from '@itrms/vehicles/api';
import type { StockSummaryRow } from '@itrms/vehicles/contracts';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import { isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    damot: '0199f0a0-d000-7000-8000-000000000202',
    boditi: '0199f0a0-d000-7000-8000-000000000302',
    zoneKeeper: '0199f0a0-d000-7000-8000-00000000f601'
};

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let stock: PlateStock;
let registry: VehicleRegistry;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'boditi' | 'tzb' | 'tzbW1' | 'trx', OrgUnit>;
let owner = '';

const ctxOf = (unit: OrgUnit): DbContext => ({ ...contextFor(unit), requestId: `ps-${randomUUID()}` });
const run = <T>(unit: OrgUnit, work: (ctx: DbContext) => (tx: Tx) => Promise<T>) => {
    const ctx = ctxOf(unit);
    return app.scoped(ctx, work(ctx));
};
const range = (series: string, from: number, to: number) => ({ series, from, to });
const key = (series: string, n: number) => `ETH${series}${String(n).padStart(4, '0')}`;

/** A unit's row of its own summary. */
const countsOf = async (unit: OrgUnit): Promise<StockSummaryRow> =>
    (await run(unit, (ctx) => (tx) => stock.summary(tx, ctx))).unit;

/** Every unit's own summary agrees with its ledger. */
async function expectReconciled(...of: OrgUnit[]) {
    for (const unit of of) {
        const summary = await run(unit, (ctx) => (tx) => stock.summary(tx, ctx));
        for (const row of [summary.unit, ...summary.children])
            expect(row.reconciled, `${unit.code}: ${row.unit.code} ${JSON.stringify(row)}`).toBe(true);
    }
}

async function newVehicle(unit: OrgUnit, chassisNumber: string) {
    return run(
        unit,
        (ctx) => (tx) =>
            registry.register(tx, ctx, {
                chassisNumber,
                chassisKind: 'other',
                make: 'Toyota',
                model: 'Hiace',
                modelYear: 2019,
                categoryKey: 'minibus',
                use: 'public_transport',
                seats: 12,
                firstRegisteredOn: '2025-09-01',
                owners: [{ kind: 'person', id: owner }]
            })
    );
}

async function refusal(work: Promise<unknown>): Promise<string> {
    try {
        await work;
    } catch (error) {
        const e = error as { message: string; code?: string; detailKey?: string; cause?: { message?: string } };
        return [e.code, e.detailKey, e.cause?.message ?? e.message].filter(Boolean).join(' ');
    }
    throw new Error('expected a refusal');
}

async function auditOf(requestId: string): Promise<Record<string, number>> {
    const { rows } = await api.owner.query<{ line: string; n: number }>(
        `SELECT table_name || ':' || action AS line, count(*)::int AS n FROM kernel.audit_log
          WHERE request_id = $1 GROUP BY 1`,
        [requestId]
    );
    return Object.fromEntries(rows.map((r) => [r.line, r.n]));
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.wol.plates',
            sub: SUB.zoneKeeper,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'plate_keeper']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    stock = api.http.get(PlateStock);
    registry = api.http.get(VehicleRegistry);
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.tzb = await api.unit('SER', 'TZB');
    units.tzbW1 = await api.unit('SER', 'TZB-W1');
    units.trx = await api.unit('TRX', 'TRX-W1');
    await api.installer.scoped({}, async (tx) => {
        for (const root of await tx.select().from(orgUnits).where(isNull(orgUnits.parentId)))
            await importVehicleCategories(tx, { id: root.id, regionId: root.regionId });
    });
    const person = await api.call(
        'POST',
        '/api/v1/persons',
        { sub: SUB.boditi, unit: units.boditi },
        {
            nameAm: { given: 'ሰሌዳ', father: 'ባለቤት' },
            nameEn: { given: 'Plate', father: 'Owner' },
            sex: 'female',
            birthYear: 1985
        }
    );
    expect(person.statusCode, person.body).toBe(201);
    owner = person.json<{ id: string }>().id;
}, 240_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('the stock from the federal delivery to the office that issues a plate', () => {
    it('receives, hands down level by level, accepts, assigns, and every unit reconciles after each step', async () => {
        const batch = await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    reference: 'MOTL-DN-0001',
                    receivedOn: '2026-10-01',
                    plates: range('QSA', 1, 100)
                })
        );
        expect(batch).toMatchObject({ quantity: 100, firstKey: key('QSA', 1), lastKey: key('QSA', 100) });
        expect(await countsOf(units.ser)).toMatchObject({ received: 100, inStock: 100, allocatedDown: 0 });

        const toZone = await run(
            units.ser,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.zone.id, plates: range('QSA', 1, 60) })
        );
        expect(toZone).toMatchObject({ kind: 'allocate', quantity: 60, awaiting: 60 });
        expect(await countsOf(units.zone)).toMatchObject({ received: 60, inTransit: 60, inStock: 0 });
        await expectReconciled(units.ser, units.zone);

        // the zone takes all but two (damaged in transit: they stay with it, waiting, until recalled or written off)
        await run(
            units.zone,
            (ctx) => (tx) => stock.accept(tx, ctx, toZone.id, { exceptKeys: [key('QSA', 59), key('QSA', 60)] })
        );
        expect(await countsOf(units.zone)).toMatchObject({ inStock: 58, inTransit: 2 });
        expect((await run(units.ser, () => (tx) => stock.movement(tx, toZone.id))).awaiting).toBe(2);

        const toBoditi = await run(
            units.zone,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('QSA', 1, 30) })
        );
        await run(units.boditi, (ctx) => (tx) => stock.accept(tx, ctx, toBoditi.id, {}));
        await expectReconciled(units.ser, units.zone, units.boditi);

        // Boditi issues the next free plate of its own stock to a new vehicle
        const vehicle = await newVehicle(units.boditi, 'STOCK-0001');
        const given = await run(
            units.boditi,
            (ctx) => (tx) => registry.assignStockPlate(tx, ctx, vehicle.id, { since: '2025-09-01' })
        );
        expect(given.key).toBe(key('QSA', 1));
        expect(await countsOf(units.boditi)).toMatchObject({ received: 30, inStock: 29, assigned: 1 });
        expect(await countsOf(units.ser)).toMatchObject({ received: 100, inStock: 40, allocatedDown: 60 });
        await expectReconciled(units.ser, units.zone, units.boditi);

        // the zone takes back what it does not need, and writes off the two damaged ones
        await run(
            units.zone,
            (ctx) => (tx) =>
                stock.recall(tx, ctx, {
                    fromUnitId: units.boditi.id,
                    plates: range('QSA', 26, 30),
                    reason: 'Boditi has more than it needs'
                })
        );
        await run(
            units.zone,
            (ctx) => (tx) =>
                stock.writeOff(tx, ctx, {
                    status: 'void',
                    plates: { keys: [key('QSA', 59), key('QSA', 60)] },
                    endReason: 'damaged',
                    reason: 'bent in transit from the bureau'
                })
        );
        expect(await countsOf(units.zone)).toMatchObject({ received: 60, inStock: 33, void: 2, allocatedDown: 25 });
        expect(await countsOf(units.boditi)).toMatchObject({ received: 25, inStock: 24, assigned: 1 });
        await expectReconciled(units.ser, units.zone, units.boditi);
    });

    it('reconciles a unit whose child took a delivery in directly', async () => {
        await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    reference: 'BODITI-PICKUP-1',
                    receivedOn: '2026-10-01',
                    plates: range('QSE', 1, 4)
                })
        );
        expect(await countsOf(units.boditi)).toMatchObject({ received: 29, inStock: 28 });
        await expectReconciled(units.ser, units.zone, units.boditi);
        // and when the zone takes some of them back
        await run(
            units.zone,
            (ctx) => (tx) =>
                stock.recall(tx, ctx, {
                    fromUnitId: units.boditi.id,
                    plates: range('QSE', 1, 2),
                    reason: 'needed at the zone counter'
                })
        );
        await expectReconciled(units.ser, units.zone, units.boditi);
    });

    it('moves stock one level at a time, only to a unit that keeps stock, never up', async () => {
        await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    reference: 'MOTL-DN-0002',
                    receivedOn: '2026-10-02',
                    plates: range('QSB', 1, 20)
                })
        );
        // the bureau to Boditi skips the zone
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('QSB', 1, 2) })
                )
            )
        ).toMatch(/validation_failed|not_child_unit/);
        await run(
            units.ser,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.zone.id, plates: range('QSB', 1, 10) })
        );
        // Damot Gale (a woreda office) keeps no plates
        expect(
            await refusal(
                run(
                    units.zone,
                    (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.damot.id, plates: range('QSB', 1, 2) })
                )
            )
        ).toMatch(/validation_failed/);
        // the zone cannot hand plates up to the bureau (a recall is the bureau's)
        expect(
            await refusal(
                run(
                    units.zone,
                    (ctx) => (tx) =>
                        stock.recall(tx, ctx, {
                            fromUnitId: units.ser.id,
                            plates: range('QSB', 1, 2),
                            reason: 'try to push up'
                        })
                )
            )
        ).toMatch(/validation_failed/);
        // the zone has not accepted them yet: it cannot hand them on
        expect(
            await refusal(
                run(
                    units.zone,
                    (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('QSB', 1, 2) })
                )
            )
        ).toMatch(/invalid_transition .*plate_not_available/);
        // a plate outside the stock, and a run partly in it, are refused whole
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.zone.id, plates: range('QSB', 15, 25) })
                )
            )
        ).toMatch(/plate_not_available/);
        expect((await countsOf(units.ser)).inStock).toBe(40 + 10);
        await expectReconciled(units.ser, units.zone);
    });

    it('refuses a second delivery of the same plates or reference, and plates already on vehicles of the register', async () => {
        await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    reference: 'MOTL-DN-0003',
                    receivedOn: '2026-10-03',
                    plates: range('QSC', 1, 5)
                })
        );
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) =>
                        stock.receive(tx, ctx, {
                            reference: 'MOTL-DN-0004',
                            receivedOn: '2026-10-03',
                            plates: range('QSC', 5, 6)
                        })
                )
            )
        ).toMatch(/duplicate_reference/);
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) =>
                        stock.receive(tx, ctx, {
                            reference: 'MOTL-DN-0003',
                            receivedOn: '2026-10-03',
                            plates: range('QSC', 7, 8)
                        })
                )
            )
        ).toMatch(/duplicate_reference/);
        // a vehicle carrying a back-captured national plate: that plate is not new stock
        const vehicle = await newVehicle(units.boditi, 'BACKCAP-01');
        await run(
            units.boditi,
            (ctx) => (tx) =>
                registry.recordPlate(tx, ctx, vehicle.id, {
                    text: 'ETH QSD 0001',
                    source: 'federal',
                    since: '2025-09-01'
                })
        );
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) =>
                        stock.receive(tx, ctx, {
                            reference: 'MOTL-DN-0005',
                            receivedOn: '2026-10-03',
                            plates: range('QSD', 1, 3)
                        })
                )
            )
        ).toMatch(/duplicate_reference plate_on_register|plate_on_register/);
        // and a plate of the stock is issued from it, never typed in
        const other = await newVehicle(units.boditi, 'BACKCAP-02');
        expect(
            await refusal(
                run(
                    units.boditi,
                    (ctx) => (tx) =>
                        registry.recordPlate(tx, ctx, other.id, {
                            text: 'ETH QSA 0010',
                            source: 'federal',
                            since: '2025-09-01'
                        })
                )
            )
        ).toMatch(/plate_in_stock/);
    });

    it('retires a stock plate when the vehicle exchanges it or leaves the register', async () => {
        const vehicle = await newVehicle(units.boditi, 'RETIRE-0001');
        const first = await run(
            units.boditi,
            (ctx) => (tx) => registry.assignStockPlate(tx, ctx, vehicle.id, { since: '2025-09-01' })
        );
        const second = await run(
            units.boditi,
            (ctx) => (tx) =>
                registry.assignStockPlate(tx, ctx, vehicle.id, { since: '2025-10-01', endedReason: 'exchanged' })
        );
        const status = async (id: string) =>
            (
                await api.owner.query<{ status: string; end_reason: string | null }>(
                    'select status, end_reason from vehicles.plates where id = $1',
                    [id]
                )
            ).rows[0];
        expect(await status(first.plateId)).toEqual({ status: 'retired', end_reason: 'exchanged' });
        const [current] = (
            await api.owner.query<{ row_version: number }>('select row_version from vehicles.vehicles where id = $1', [
                vehicle.id
            ])
        ).rows;
        await run(
            units.boditi,
            (ctx) => (tx) =>
                registry.setStatus(tx, ctx, vehicle.id, current?.row_version ?? 0, {
                    status: 'deregistered',
                    on: '2026-01-01'
                })
        );
        expect(await status(second.plateId)).toEqual({ status: 'retired', end_reason: 'retired' });
        await expectReconciled(units.zone, units.boditi);
    });
});

describe('no plate is assigned or allocated twice, even at the same moment', () => {
    beforeAll(async () => {
        await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    reference: 'MOTL-DN-0100',
                    receivedOn: '2026-10-05',
                    plates: range('QTA', 1, 40)
                })
        );
        const down = await run(
            units.ser,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.zone.id, plates: range('QTA', 1, 40) })
        );
        await run(units.zone, (ctx) => (tx) => stock.accept(tx, ctx, down.id, {}));
    });

    it('lets one of two allocations of the same plates through', async () => {
        const both = await Promise.allSettled([
            run(
                units.zone,
                (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('QTA', 1, 10) })
            ),
            run(
                units.zone,
                (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('QTA', 5, 15) })
            )
        ]);
        expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const [refused] = both.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(refused?.reason).toMatchObject({ status: 409, code: 'invalid_transition' });
        await expectReconciled(units.zone, units.boditi);
    });

    it('gives two offices taking the next free plate at once two different plates, and a named plate once', async () => {
        const down = await run(
            units.zone,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('QTA', 20, 25) })
        );
        await run(units.boditi, (ctx) => (tx) => stock.accept(tx, ctx, down.id, {}));
        const [a, b, c, d] = await Promise.all(
            ['RACE-0001', 'RACE-0002', 'RACE-0003', 'RACE-0004'].map((n) => newVehicle(units.boditi, n))
        );
        if (!a || !b || !c || !d) throw new Error('vehicles');
        const free = await Promise.all([
            run(units.boditi, (ctx) => (tx) => registry.assignStockPlate(tx, ctx, a.id, { since: '2025-09-01' })),
            run(units.boditi, (ctx) => (tx) => registry.assignStockPlate(tx, ctx, b.id, { since: '2025-09-01' }))
        ]);
        expect(new Set(free.map((f) => f.key)).size).toBe(2);
        const named = await Promise.allSettled([
            run(
                units.boditi,
                (ctx) => (tx) => registry.assignStockPlate(tx, ctx, c.id, { key: key('QTA', 25), since: '2025-09-01' })
            ),
            run(
                units.boditi,
                (ctx) => (tx) => registry.assignStockPlate(tx, ctx, d.id, { key: key('QTA', 25), since: '2025-09-01' })
            )
        ]);
        expect(named.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(named.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
        await expectReconciled(units.zone, units.boditi);
    });

    it('does not let an office assign a plate it does not hold', async () => {
        const vehicle = await newVehicle(units.boditi, 'NOTMINE-01');
        // QTA 0030 is the zone's, not Boditi's
        expect(
            await refusal(
                run(
                    units.boditi,
                    (ctx) => (tx) =>
                        registry.assignStockPlate(tx, ctx, vehicle.id, { key: key('QTA', 30), since: '2025-09-01' })
                )
            )
        ).toMatch(/plate_not_available/);
    });
});

describe('a plate reserved for a case (task 1.2b)', () => {
    const on = '2026-10-10';
    beforeAll(async () => {
        await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    reference: 'MOTL-DN-0200',
                    receivedOn: '2026-10-08',
                    plates: range('RSV', 1, 4)
                })
        );
        const down = await run(
            units.ser,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.zone.id, plates: range('RSV', 1, 4) })
        );
        await run(units.zone, (ctx) => (tx) => stock.accept(tx, ctx, down.id, {}));
        const toBoditi = await run(
            units.zone,
            (ctx) => (tx) => stock.allocate(tx, ctx, { toUnitId: units.boditi.id, plates: range('RSV', 1, 4) })
        );
        await run(units.boditi, (ctx) => (tx) => stock.accept(tx, ctx, toBoditi.id, {}));
    });

    const reserve = (caseId: string) =>
        run(units.boditi, (ctx) => (tx) => stock.reserve(tx, ctx, { holderUnitId: units.boditi.id, caseId, on }));
    const release = (caseId: string) => run(units.boditi, (ctx) => (tx) => stock.release(tx, ctx, { caseId, on }));

    it('returns the same plate for the same case, and different plates for two cases at once', async () => {
        const one = randomUUID();
        const first = await reserve(one);
        const again = await reserve(one);
        expect(again.id).toBe(first.id);
        expect(first).toMatchObject({ status: 'reserved', caseId: one, holderUnitId: units.boditi.id });
        const others = [randomUUID(), randomUUID()];
        const [a, b] = await Promise.all(others.map((c) => reserve(c)));
        expect(new Set([first.id, a?.id, b?.id]).size).toBe(3);
        for (const c of [one, ...others]) await release(c);
        await expectReconciled(units.zone, units.boditi);
    });

    it('refuses with no_free_plate when none is free, and from a unit outside the scope or without stock', async () => {
        const free = await run(
            units.boditi,
            (ctx) => (tx) => stock.list(tx, ctx, { holderUnitId: units.boditi.id, status: 'in_stock', limit: 100 })
        );
        const cases = free.items.map(() => randomUUID());
        for (const c of cases) await reserve(c);
        expect(await refusal(reserve(randomUUID()))).toMatch(/invalid_transition.*no_free_plate/);
        // Damot Gale is outside Boditi's subtree; Boditi is not within Damot Gale's, and the zone's own stock is not Boditi's to reserve
        await expect(
            run(
                units.damot,
                (ctx) => (tx) => stock.reserve(tx, ctx, { holderUnitId: units.boditi.id, caseId: randomUUID(), on })
            )
        ).rejects.toMatchObject({ status: 403 });
        await expect(
            run(
                units.boditi,
                (ctx) => (tx) => stock.reserve(tx, ctx, { holderUnitId: units.zone.id, caseId: randomUUID(), on })
            )
        ).rejects.toMatchObject({ status: 403 });
        for (const c of cases) await release(c);
    });

    it('releases the plate of a case to the free stock, and answers 0 when it has none', async () => {
        const caseId = randomUUID();
        const plate = await reserve(caseId);
        const reserved = await run(units.boditi, (ctx) => (tx) => stock.list(tx, ctx, { caseId }));
        expect(reserved.items.map((p) => p.key)).toEqual([plate.plateKey]);
        expect(await release(caseId)).toBe(1);
        expect(await release(caseId)).toBe(0);
        const after = await run(units.boditi, (ctx) => (tx) => stock.list(tx, ctx, { q: plate.plateKey }));
        expect(after.items[0]).toMatchObject({ status: 'in_stock', caseId: null });
    });

    it('is taken by the same case only', async () => {
        const caseId = randomUUID();
        const plate = await reserve(caseId);
        const vehicle = await newVehicle(units.boditi, 'RESERVED-01');
        await expect(
            run(
                units.boditi,
                (ctx) => (tx) =>
                    registry.assignStockPlate(tx, ctx, vehicle.id, {
                        key: plate.plateKey,
                        caseId: randomUUID(),
                        since: '2025-09-01'
                    })
            )
        ).rejects.toMatchObject({ status: 409 });
        const taken = await run(
            units.boditi,
            (ctx) => (tx) =>
                registry.assignStockPlate(tx, ctx, vehicle.id, { key: plate.plateKey, caseId, since: '2025-09-01' })
        );
        expect(taken.key).toBe(plate.plateKey);
    });

    it('marks in the summary the units that keep plate stock', async () => {
        const summary = await run(units.zone, (ctx) => (tx) => stock.summary(tx, ctx));
        expect(summary.unit.holdsPlateStock).toBe(true);
        const byCode = new Map(summary.children.map((c) => [c.unit.code, c.holdsPlateStock]));
        expect(byCode.get('WOL-BODITI')).toBe(true);
        if (byCode.has('WOL-DAMOT-GALE')) expect(byCode.get('WOL-DAMOT-GALE')).toBe(false);
    });
});

describe('the database is the last word', () => {
    const plateOf = async (k: string) =>
        (await api.owner.query<{ id: string }>('select id from vehicles.plates where plate_key = $1', [k])).rows[0]
            ?.id ?? '';

    it('refuses a step the machine does not allow, and a new holder outside an allocation or a recall', async () => {
        const id = await plateOf(key('QTA', 35));
        expect(
            await refusal(
                asUnit(app, units.zone, (tx) =>
                    tx.execute(
                        sql`update vehicles.plates set status = 'retired', end_reason = 'retired' where id = ${id}`
                    )
                )
            )
        ).toMatch(/plate_transition|cannot go from/);
        expect(
            await refusal(
                asUnit(app, units.zone, (tx) =>
                    tx.execute(
                        sql`update vehicles.plates set holder_unit_id = ${units.boditi.id}, status = 'void', end_reason = 'damaged' where id = ${id}`
                    )
                )
            )
        ).toMatch(/plate_transition|cannot go from/);
    });

    it('refuses at commit a plate assigned with no vehicle carrying it, and a second assignment of a plate', async () => {
        const id = await plateOf(key('QTA', 36));
        const vehicle = await newVehicle(units.zone, 'LASTWORD-1');
        expect(
            await refusal(
                asUnit(app, units.zone, (tx) =>
                    tx.execute(
                        sql`update vehicles.plates set status = 'assigned', vehicle_id = ${vehicle.id} where id = ${id}`
                    )
                )
            )
        ).toMatch(/plate_match|carry it/);
        const taken = await plateOf(key('QSA', 1));
        expect(
            await refusal(
                asUnit(app, units.zone, (tx) =>
                    tx.execute(sql`insert into vehicles.plate_assignments (id, vehicle_id, plate_text, plate_key, format, source, since, plate_id)
                        values (gen_random_uuid(), ${vehicle.id}, 'ETH QSA 0001', 'ETHQSA0001', 'national', 'federal', '2025-09-01', ${taken})`)
                )
            )
        ).toMatch(/plate_assignments_plate_uq|plate_assignments_open_plate_uq/);
    });

    it('lets an org-unit move rewrite the scope of every plate, a final one too', async () => {
        // what kernel.org_units_move_subtree does to every registered table under a moved unit
        const moved = await api.owner.query(
            `update vehicles.plates set holder_org_path = holder_org_path where status in ('retired', 'void', 'assigned', 'in_stock')`
        );
        expect(moved.rowCount).toBeGreaterThan(0);
    });

    it('refuses an open assignment of a plate that the stock does not say is assigned', async () => {
        const id = await plateOf(key('QTA', 37));
        const vehicle = await newVehicle(units.zone, 'LASTWORD-2');
        expect(
            await refusal(
                asUnit(app, units.zone, (tx) =>
                    tx.execute(sql`insert into vehicles.plate_assignments (id, vehicle_id, plate_text, plate_key, format, source, since, plate_id)
                        values (gen_random_uuid(), ${vehicle.id}, 'ETH QTA 0037', 'ETHQTA0037', 'national', 'federal', '2025-09-01', ${id})`)
                )
            )
        ).toMatch(/plate_match|carry it/);
    });

    it('keeps the ledger and the batches as written: no update, no delete for anyone', async () => {
        for (const statement of [
            sql`update vehicles.plate_movements set quantity = quantity`,
            sql`update vehicles.plate_batches set quantity = quantity`,
            sql`delete from vehicles.plates`,
            sql`delete from vehicles.plate_movements`
        ])
            expect(await refusal(asUnit(app, units.ser, (tx) => tx.execute(statement)))).toMatch(/permission denied/);
    });
});

describe('the audit trail', () => {
    it('has a row for every plate a command moves and one for its movement, in its own transaction', async () => {
        const ctx = ctxOf(units.ser);
        await app.scoped(ctx, (tx) =>
            stock.receive(tx, ctx, { reference: 'MOTL-DN-0200', receivedOn: '2026-10-06', plates: range('QUA', 1, 50) })
        );
        expect(await auditOf(ctx.requestId ?? '')).toEqual({
            'vehicles.plate_batches:insert': 1,
            'vehicles.plate_movements:insert': 1,
            'vehicles.plates:insert': 50
        });
        const down = ctxOf(units.ser);
        await app.scoped(down, (tx) =>
            stock.allocate(tx, down, { toUnitId: units.zone.id, plates: range('QUA', 1, 30) })
        );
        expect(await auditOf(down.requestId ?? '')).toEqual({
            'vehicles.plate_movements:insert': 1,
            'vehicles.plates:update': 30
        });
        const rolledBack = ctxOf(units.ser);
        await expect(
            app.scoped(rolledBack, async (tx) => {
                await stock.allocate(tx, rolledBack, { toUnitId: units.zone.id, plates: range('QUA', 31, 40) });
                throw new Error('stop');
            })
        ).rejects.toThrow('stop');
        expect(await auditOf(rolledBack.requestId ?? '')).toEqual({});
    });
});

describe('the isolation matrix of the stock (class R for the plates, class T for the batches and the ledger)', () => {
    const CASE_UNITS: Record<IsolationCase, () => OrgUnit> = {
        own: () => units.zone,
        child: () => units.boditi,
        parent: () => units.ser,
        sibling: () => units.tzb,
        otherZone: () => units.tzbW1,
        otherRegion: () => units.trx
    };
    const series = (c: IsolationCase) => `QX${'ABCDEF'[ISOLATION_CASES.indexOf(c)] ?? 'Z'}`;

    beforeAll(async () => {
        // one batch, one plate and one receipt held by each case's unit, written as the owner (most of them keep no stock)
        for (const c of ISOLATION_CASES) {
            const unit = CASE_UNITS[c]();
            const s = series(c);
            await api.owner.query(
                `with b as (insert into vehicles.plate_batches (id, region_id, receiving_unit_id, reference, received_on, quantity, first_key, last_key)
                   values (gen_random_uuid(), $1, $2, $3, '2026-10-01', 1, $4, $4) returning id),
                 m as (insert into vehicles.plate_movements (id, region_id, unit_id, kind, batch_id, quantity, first_key, last_key, occurred_on)
                   select gen_random_uuid(), $1, $2, 'receive', b.id, 1, $4, $4, '2026-10-01' from b returning id)
                 insert into vehicles.plates (id, region_id, holder_unit_id, batch_id, plate_key, series, serial, status, status_on)
                   select gen_random_uuid(), $1, $2, b.id, $4, $5, 1, 'in_stock', '2026-10-01' from b`,
                [unit.regionId, unit.id, `MATRIX-${c}`, `ETH${s}0001`, s]
            );
        }
    }, 120_000);

    const caseOfSeries = (s: string) => ISOLATION_CASES.find((c) => series(c) === s);

    it.each([
        ['vehicles.plates', `select series as s from vehicles.plates where series like 'QX%'`, VISIBLE.registry],
        [
            'vehicles.plate_batches',
            `select substr(first_key, 4, 3) as s from vehicles.plate_batches where reference like 'MATRIX-%'`,
            VISIBLE.transaction
        ],
        [
            'vehicles.plate_movements',
            `select substr(first_key, 4, 3) as s from vehicles.plate_movements where first_key like 'ETHQX%'`,
            VISIBLE.transaction
        ]
    ] as const)('shows the acting unit exactly the rows of %s its class allows', async (_table, query, visible) => {
        const seen = await asUnit(app, units.zone, async (tx) =>
            (await tx.execute<{ s: string }>(sql.raw(query))).rows.map((r) => caseOfSeries(r.s))
        );
        expect([...new Set(seen)].sort()).toEqual([...visible].sort());
    });

    it.each(ISOLATION_CASES)('lets the acting unit change the %s plate only where class R allows it', async (c) => {
        const changed = await asUnit(app, units.zone, (tx) =>
            tx.execute(sql`update vehicles.plates set note = 'matrix' where plate_key = ${`ETH${series(c)}0001`}`)
        );
        expect(changed.rowCount).toBe(WRITABLE.registry.includes(c) ? 1 : 0);
    });

    it.each(['vehicles.plates', 'vehicles.plate_batches', 'vehicles.plate_movements'])(
        'shows nothing of %s without a context, on a connection that has just served one',
        async (table) => {
            const one = createDatabase(pg.url('app'), { max: 1, contextKey: TEST_CONTEXT_KEY });
            try {
                await asUnit(one, units.zone, (tx) => tx.execute(sql.raw(`select count(*) from ${table}`)));
                const seen = await one.scoped({}, (tx) =>
                    tx.execute<{ n: string }>(sql.raw(`select count(*) as n from ${table}`))
                );
                expect(seen.rows[0]?.n).toBe('0');
            } finally {
                await one.close();
            }
        }
    );
});

describe('over HTTP', () => {
    const keeper = (): As => ({ sub: SUB.zoneKeeper, unit: units.zone });

    it('lets a plate keeper read and move the stock, and nobody else change it', async () => {
        const summary = await api.call('GET', '/api/v1/plate-stock/summary', keeper());
        expect(summary.statusCode, summary.body).toBe(200);
        expect(summary.json<{ unit: StockSummaryRow }>().unit.reconciled).toBe(true);
        const receipt = await api.call(
            'POST',
            '/api/v1/plate-stock/batches',
            keeper(),
            {
                reference: 'ZONE-PICKUP-01',
                receivedOn: '2026-10-07',
                plates: { series: 'QVA', from: 1, to: 3 }
            },
            { 'idempotency-key': randomUUID() }
        );
        expect(receipt.statusCode, receipt.body).toBe(201);
        // a records officer of Damot Gale may not receive plates
        const refused = await api.call(
            'POST',
            '/api/v1/plate-stock/batches',
            { sub: SUB.damot, unit: units.damot },
            {
                reference: 'DAMOT-01',
                receivedOn: '2026-10-07',
                plates: { series: 'QVB', from: 1, to: 3 }
            },
            { 'idempotency-key': randomUUID() }
        );
        expect(refused.statusCode).toBe(403);
        const list = await api.call('GET', '/api/v1/plate-stock/plates?q=ETH%20QVA%200002', keeper());
        expect(list.json<{ items: { key: string; status: string }[] }>().items).toMatchObject([
            { key: 'ETHQVA0002', status: 'in_stock' }
        ]);
    });
});
