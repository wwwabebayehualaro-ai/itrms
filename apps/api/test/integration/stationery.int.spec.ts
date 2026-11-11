/**
 * Controlled stationery (task 1.12a) on a real PostgreSQL 16 with the Wolaita seeds, Test Zone B and Test Region X: a
 * delivery of serial-numbered forms received by the bureau, handed down to the zone and on to Boditi (each level accepts what
 * it was sent), recalled and written off; every unit reconciles with its ledger after each step; an item is used once, for one
 * record, even by two officers at once; a licence print batch back from the printer takes one card blank per licence; the
 * office's closing flags what is missing and what it should not hold; the database refuses a step the machine does not
 * allow, whatever the writer; every change is audited in its command's transaction; the isolation matrix on the four tables.
 * Serials, references and names are generated.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { StationeryStock } from '@itrms/fees/api';
import { importStationeryDemo } from '@itrms/fees/seed';
import type { StationeryKind, StationerySummaryRow } from '@itrms/fees/contracts';
import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import type { OrgUnit } from '@itrms/kernel/org';
import {
    asUnit,
    contextFor,
    ISOLATION_CASES,
    TEST_CONTEXT_KEY,
    VISIBLE,
    WRITABLE,
    type IsolationCase
} from '@itrms/kernel/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    lead: '0199f0a0-d000-7000-8000-00000000c104',
    keeper: '0199f0a0-d000-7000-8000-00000000c105',
    damotKeeper: '0199f0a0-d000-7000-8000-00000000c106'
};

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let stock: StationeryStock;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'boditi' | 'tzb' | 'tzbW1' | 'trx', OrgUnit>;

const ctxOf = (unit: OrgUnit): DbContext => ({ ...contextFor(unit), requestId: `st-${randomUUID()}` });
const run = <T>(unit: OrgUnit, work: (ctx: DbContext) => (tx: Tx) => Promise<T>) => {
    const ctx = ctxOf(unit);
    return app.scoped(ctx, work(ctx));
};
const range = (series: string, from: number, to: number) => ({ series, from, to });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

const countsOf = async (unit: OrgUnit, kind: StationeryKind): Promise<StationerySummaryRow> =>
    (await run(unit, (ctx) => (tx) => stock.summary(tx, ctx, kind))).unit;

async function expectReconciled(kind: StationeryKind, ...of: OrgUnit[]) {
    for (const unit of of) {
        const summary = await run(unit, (ctx) => (tx) => stock.summary(tx, ctx, kind));
        for (const row of [summary.unit, ...summary.children])
            expect(row.reconciled, `${unit.code}: ${row.unit.code} ${JSON.stringify(row)}`).toBe(true);
    }
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

/** Stationery received by the bureau and handed down to Boditi, accepted at each level. */
async function atBoditi(kind: StationeryKind, series: string, from: number, to: number, extra: object = {}) {
    await run(
        units.ser,
        (ctx) => (tx) =>
            stock.receive(tx, ctx, {
                kind,
                reference: `BUREAU-${series}-${from}`,
                receivedOn: today(),
                range: range(series, from, to),
                ...extra
            })
    );
    const toZone = await run(
        units.ser,
        (ctx) => (tx) => stock.allocate(tx, ctx, { kind, toUnitId: units.zone.id, items: range(series, from, to) })
    );
    await run(units.zone, (ctx) => (tx) => stock.accept(tx, ctx, toZone.id, {}));
    const toBoditi = await run(
        units.zone,
        (ctx) => (tx) => stock.allocate(tx, ctx, { kind, toUnitId: units.boditi.id, items: range(series, from, to) })
    );
    await run(units.boditi, (ctx) => (tx) => stock.accept(tx, ctx, toBoditi.id, {}));
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.st.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.st.keeper',
            sub: SUB.keeper,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'plate_keeper']]
        },
        {
            username: 'test.st.damot',
            sub: SUB.damotKeeper,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'unit_head']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    stock = api.http.get(StationeryStock);
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.tzb = await api.unit('SER', 'TZB');
    units.tzbW1 = await api.unit('SER', 'TZB-W1');
    units.trx = await api.unit('TRX', 'TRX-W1');
}, 240_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('the stock from the bureau to the office that uses an item', () => {
    it('receives, hands down level by level, accepts, recalls, writes off, and every unit reconciles after each step', async () => {
        const kind = 'libre_booklet';
        const batch = await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    kind,
                    source: 'ministry',
                    reference: 'MOTL-LB-0001',
                    receivedOn: today(),
                    range: range('LB', 1001, 1100),
                    width: 7,
                    unitCostSantim: '13000'
                })
        );
        expect(batch).toMatchObject({
            quantity: 100,
            firstKey: 'LB0001001',
            lastKey: 'LB0001100',
            source: 'ministry',
            unitCostSantim: '13000'
        });
        const toZone = await run(
            units.ser,
            (ctx) => (tx) => stock.allocate(tx, ctx, { kind, toUnitId: units.zone.id, items: range('LB', 1001, 1060) })
        );
        expect(toZone).toMatchObject({ movement: 'allocate', quantity: 60, awaiting: 60 });
        expect(await countsOf(units.zone, kind)).toMatchObject({ received: 60, inTransit: 60, inStock: 0 });
        await expectReconciled(kind, units.ser, units.zone);

        // the zone takes all but two (torn in transit: they stay waiting until recalled or written off)
        await run(
            units.zone,
            (ctx) => (tx) => stock.accept(tx, ctx, toZone.id, { exceptKeys: ['LB0001059', 'LB 1060'] })
        );
        expect(await countsOf(units.zone, kind)).toMatchObject({ inStock: 58, inTransit: 2 });

        const toBoditi = await run(
            units.zone,
            (ctx) => (tx) =>
                stock.allocate(tx, ctx, { kind, toUnitId: units.boditi.id, items: range('LB', 1001, 1030) })
        );
        await run(units.boditi, (ctx) => (tx) => stock.accept(tx, ctx, toBoditi.id, {}));
        await expectReconciled(kind, units.ser, units.zone, units.boditi);

        await run(
            units.zone,
            (ctx) => (tx) =>
                stock.recall(tx, ctx, {
                    kind,
                    fromUnitId: units.boditi.id,
                    items: range('LB', 1026, 1030),
                    reason: 'Boditi has more than it needs'
                })
        );
        await run(
            units.zone,
            (ctx) => (tx) =>
                stock.writeOff(tx, ctx, {
                    kind,
                    status: 'void',
                    items: { keys: ['LB0001059', 'LB0001060'] },
                    endReason: 'damaged',
                    reason: 'torn in transit from the bureau'
                })
        );
        expect(await countsOf(units.zone, kind)).toMatchObject({
            received: 60,
            inStock: 33,
            void: 2,
            allocatedDown: 25
        });
        expect(await countsOf(units.boditi, kind)).toMatchObject({ received: 25, inStock: 25 });
        await expectReconciled(kind, units.ser, units.zone, units.boditi);
    });

    it('keeps a kind, a variant and a year apart: a bolo sticker of 2018 for taxis is not one for government cars', async () => {
        await atBoditi('bolo_sticker', 'T', 3501, 3510, { variant: 'taxi', validEfy: 2018 });
        await atBoditi('bolo_sticker', 'GV', 251, 260, { variant: 'government', validEfy: 2018 });
        const taxi = await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.use(tx, ctx, {
                    kind: 'bolo_sticker',
                    variant: 'taxi',
                    usedFor: { table: 'test.bolos', id: randomUUID() }
                })
        );
        expect(taxi).toMatchObject({ itemKey: 'T3501', variant: 'taxi', validEfy: 2018 });
        const government = await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.use(tx, ctx, {
                    kind: 'bolo_sticker',
                    variant: 'government',
                    usedFor: { table: 'test.bolos', id: randomUUID() }
                })
        );
        expect(government.itemKey).toBe('GV251');
        // a libre booklet's serial is not a sticker's: the same digits in another kind are another item
        expect(
            await refusal(
                run(
                    units.boditi,
                    (ctx) => (tx) =>
                        stock.use(tx, ctx, {
                            kind: 'licence_blank',
                            key: 'T3502',
                            usedFor: { table: 'test.bolos', id: randomUUID() }
                        })
                )
            )
        ).toMatch(/stationery_not_available/);
    });

    it('refuses a command on items the acting unit does not hold, to a unit not directly below, or by an office without stock', async () => {
        await run(
            units.ser,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    kind: 'receipt_leaf',
                    reference: 'PAD-0001',
                    receivedOn: today(),
                    range: range('RX', 1, 50)
                })
        );
        // Boditi is two levels below the bureau
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) =>
                        stock.allocate(tx, ctx, {
                            kind: 'receipt_leaf',
                            toUnitId: units.boditi.id,
                            items: range('RX', 1, 10)
                        })
                )
            )
        ).toMatch(/not_child_unit|validation_failed/);
        // the zone does not hold what is still at the bureau
        expect(
            await refusal(
                run(
                    units.zone,
                    (ctx) => (tx) =>
                        stock.writeOff(tx, ctx, {
                            kind: 'receipt_leaf',
                            status: 'missing',
                            items: range('RX', 1, 2),
                            endReason: 'lost',
                            reason: 'not ours to write off'
                        })
                )
            )
        ).toMatch(/stationery_not_available/);
        // Damot Gale (a category-2 woreda) keeps no stationery
        expect(
            await refusal(
                run(
                    units.damot,
                    (ctx) => (tx) =>
                        stock.receive(tx, ctx, {
                            kind: 'receipt_leaf',
                            reference: 'DAMOT-1',
                            receivedOn: today(),
                            range: range('RX', 900, 901)
                        })
                )
            )
        ).toMatch(/no_stationery/);
        // a serial received twice
        expect(
            await refusal(
                run(
                    units.ser,
                    (ctx) => (tx) =>
                        stock.receive(tx, ctx, {
                            kind: 'receipt_leaf',
                            reference: 'PAD-0002',
                            receivedOn: today(),
                            range: range('RX', 50, 60)
                        })
                )
            )
        ).toMatch(/duplicate_stationery_serial/);
    });
});

describe('an item is used once, for one record', () => {
    it('gives the same item to the same record asked twice, and different items to two records at the same moment', async () => {
        await atBoditi('licence_blank', 'LX', 1, 20);
        const record = { table: 'test.records', id: randomUUID() };
        const first = await run(
            units.boditi,
            (ctx) => (tx) => stock.use(tx, ctx, { kind: 'licence_blank', usedFor: record })
        );
        const again = await run(
            units.boditi,
            (ctx) => (tx) => stock.use(tx, ctx, { kind: 'licence_blank', usedFor: record })
        );
        expect(again.id).toBe(first.id);
        const [a, b] = await Promise.all(
            [randomUUID(), randomUUID()].map((id) =>
                run(
                    units.boditi,
                    (ctx) => (tx) =>
                        stock.use(tx, ctx, { kind: 'licence_blank', usedFor: { table: 'test.records', id } })
                )
            )
        );
        expect(new Set([first.id, a?.id, b?.id]).size).toBe(3);
        // a used item is never used again, named or not
        expect(
            await refusal(
                run(
                    units.boditi,
                    (ctx) => (tx) =>
                        stock.use(tx, ctx, {
                            kind: 'licence_blank',
                            key: first.itemKey,
                            usedFor: { table: 'test.records', id: randomUUID() }
                        })
                )
            )
        ).toMatch(/stationery_not_available/);
        // a spoiled one stays on record and is never used
        const spoiled = await run(
            units.boditi,
            (ctx) => (tx) => stock.spoil(tx, ctx, { kind: 'licence_blank', key: 'LX10', reason: 'misprinted photo' })
        );
        expect(spoiled).toMatchObject({ status: 'spoiled', endReason: 'misprinted' });
        expect(await countsOf(units.boditi, 'licence_blank')).toMatchObject({ inStock: 16, used: 3, spoiled: 1 });
        await expectReconciled('licence_blank', units.ser, units.zone, units.boditi);
    });
});

describe('a licence print batch back from the printer', () => {
    let person = '';
    const licences: string[] = [];
    let batchId = '';

    beforeAll(async () => {
        const res = await api.call(
            'POST',
            '/api/v1/persons',
            { sub: SUB.boditiRecords, unit: units.boditi },
            {
                nameAm: { given: 'ካርድ', father: 'ባለቤት' },
                nameEn: { given: 'Card', father: 'Holder' },
                sex: 'male',
                birthYear: 1990
            }
        );
        expect(res.statusCode, res.body).toBe(201);
        person = res.json<{ id: string }>().id;
        // three licences on a batch sent to the printer, written as the owner (the licence workflow has its own spec)
        const { rows } = await api.owner.query<{ id: string }>(
            `with b as (insert into competency.licence_print_batches (id, region_id, handling_unit_id, status)
                        values (gen_random_uuid(), $1, $2, 'sent') returning id)
             select id from b`,
            [units.boditi.regionId, units.boditi.id]
        );
        batchId = rows[0]?.id ?? '';
        for (let i = 0; i < 3; i += 1) {
            const lic = await api.owner.query<{ id: string }>(
                `insert into competency.driver_licences (id, region_id, handling_unit_id, person_id)
                 values (gen_random_uuid(), $1, $2, $3) returning id`,
                [units.boditi.regionId, units.boditi.id, person]
            );
            const id = lic.rows[0]?.id ?? '';
            licences.push(id);
            await api.owner.query(
                `insert into competency.licence_print_batch_items (id, region_id, handling_unit_id, batch_id, licence_id)
                 values (gen_random_uuid(), $1, $2, $3, $4)`,
                [units.boditi.regionId, units.boditi.id, batchId, id]
            );
        }
        await atBoditi('licence_blank', 'PC', 1, 10, {});
    });

    const printed = (body: object, version = 1) =>
        api.call(
            'POST',
            `/api/v1/competency/print-batches/${batchId}/printing`,
            { sub: SUB.lead, unit: units.boditi },
            body,
            { 'if-match': `"${version}"` }
        );

    it('takes one card blank of the office per licence, skips the spoiled one, and returns the batch', async () => {
        const before = await countsOf(units.boditi, 'licence_blank');
        // a licence of the batch left out: nothing is taken
        const partial = await printed({ cards: [{ licenceId: licences[0], cardKey: 'PC01' }] });
        expect(partial.statusCode, partial.body).toBe(422);
        expect(await countsOf(units.boditi, 'licence_blank')).toMatchObject({ inStock: before.inStock });

        const res = await printed({
            firstCardKey: 'PC01',
            spoiled: [{ cardKey: 'PC02', reason: 'jammed in the printer' }]
        });
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json<{ status: string }>().status).toBe('returned');
        const { rows } = await api.owner.query<{ licence_id: string; card_key: string; status: string }>(
            `select i.licence_id, i.card_key, s.status from competency.licence_print_batch_items i
               join fees.stationery_items s on s.id = i.stationery_item_id where i.batch_id = $1 order by i.card_key`,
            [batchId]
        );
        expect(rows.map((r) => r.card_key)).toEqual(['PC01', 'PC03', 'PC04']);
        expect(rows.every((r) => r.status === 'used')).toBe(true);
        expect(await countsOf(units.boditi, 'licence_blank')).toMatchObject({
            inStock: before.inStock - 4,
            used: before.used + 3,
            spoiled: before.spoiled + 1
        });

        // recorded once: the batch has come back
        expect((await printed({ firstCardKey: 'PC5' }, 2)).statusCode).toBe(409);
    });

    it('refuses one who may not print, at the permission', async () => {
        const res = await api.call(
            'POST',
            `/api/v1/competency/print-batches/${batchId}/printing`,
            { sub: SUB.keeper, unit: units.boditi },
            { firstCardKey: 'PC9' },
            { 'if-match': '"2"' }
        );
        expect(res.statusCode).toBe(403);
    });
});

describe("the office's closing", () => {
    it('flags what it should hold and did not count, and what it counted and should not hold', async () => {
        await atBoditi('bolo_sticker', 'CL', 1, 10, { variant: 'private', validEfy: 2018 });
        // printed two digits wide (the run ends at 10): CL01 used for a bolo; CL07 and CL08 not on the table at the count; CL99
        // was never received
        await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.use(tx, ctx, {
                    kind: 'bolo_sticker',
                    key: 'CL01',
                    usedFor: { table: 'test.bolos', id: randomUUID() }
                })
        );
        const ctx = ctxOf(units.boditi);
        const closing = await app.scoped(ctx, (tx) =>
            stock.close(tx, ctx, {
                kind: 'bolo_sticker',
                closedOn: today(),
                counted: [range('CL', 1, 6), range('CL', 9, 10), range('CL', 99, 99)]
            })
        );
        // the other stickers Boditi holds in stock (taxi and government runs above) are not on the table either
        expect(closing.missing).toEqual(expect.arrayContaining(['CL07', 'CL08']));
        expect(closing.missing.filter((k) => k.startsWith('CL'))).toEqual(['CL07', 'CL08']);
        expect(closing.unexpected).toEqual(['CL01', 'CL99']);
        expect(closing.unexpectedCount).toBe(2);
        expect(closing.balanced).toBe(false);
        expect(await auditOf(ctx.requestId ?? '')).toEqual({ 'fees.stationery_closings:insert': 1 });
        // a count is of today, and of at most 10 000 serials
        expect(
            await refusal(
                run(
                    units.boditi,
                    (c) => (tx) => stock.close(tx, c, { kind: 'receipt_leaf', closedOn: '2025-01-01', counted: [] })
                )
            )
        ).toMatch(/validation_failed/);
        expect(
            await refusal(
                run(
                    units.boditi,
                    (c) => (tx) =>
                        stock.close(tx, c, {
                            kind: 'receipt_leaf',
                            closedOn: today(),
                            counted: [range('ZZ', 1, 10_000), range('ZY', 1, 2)]
                        })
                )
            )
        ).toMatch(/validation_failed/);
        // one count a day per kind
        expect(
            await refusal(
                run(
                    units.boditi,
                    (c) => (tx) => stock.close(tx, c, { kind: 'bolo_sticker', closedOn: today(), counted: [] })
                )
            )
        ).toMatch(/stationery_closed_today/);
        const summary = await run(units.zone, (c) => (tx) => stock.summary(tx, c, 'bolo_sticker'));
        expect(summary.children.find((r) => r.unit.id === units.boditi.id)?.lastClosing).toEqual({
            closedOn: today(),
            balanced: false
        });
    });

    it('is balanced when the count is exactly what the office holds', async () => {
        await atBoditi('receipt_leaf', 'BAL', 1, 5);
        const held = await run(
            units.boditi,
            (ctx) => (tx) => stock.list(tx, ctx, { kind: 'receipt_leaf', status: 'in_stock', limit: 100 })
        );
        expect(held.items.map((i) => i.key)).toEqual(['BAL1', 'BAL2', 'BAL3', 'BAL4', 'BAL5']);
        const closing = await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.close(tx, ctx, { kind: 'receipt_leaf', closedOn: today(), counted: [range('BAL', 1, 5)] })
        );
        expect(closing).toMatchObject({ expected: 5, counted: 5, missingCount: 0, unexpectedCount: 0, balanced: true });
    });
});

describe('the database is the last word', () => {
    const itemOf = async (key: string) =>
        (await api.owner.query<{ id: string }>('select id from fees.stationery_items where item_key = $1', [key]))
            .rows[0]?.id ?? '';

    it('refuses a step the machine does not allow, whatever the writer', async () => {
        await atBoditi('receipt_leaf', 'DB', 1, 3);
        const id = await itemOf('DB1');
        await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.use(tx, ctx, {
                    kind: 'receipt_leaf',
                    key: 'DB1',
                    usedFor: { table: 'test.receipts', id: randomUUID() }
                })
        );
        for (const statement of [
            // a used item back in stock
            sql`update fees.stationery_items set status = 'in_stock', used_for_id = null, used_for_table = null where id = ${id}`,
            // what used it changed
            sql`update fees.stationery_items set used_for_id = gen_random_uuid() where id = ${id}`,
            // used without a record
            sql`update fees.stationery_items set status = 'used' where item_key = 'DB2'`,
            // moved sideways to a sibling (out of sight from Boditi: the scope trigger finds no such unit)
            sql`update fees.stationery_items set holder_unit_id = ${units.damot.id} where item_key = 'DB3'`,
            // a serial rewritten (not even granted: the column is not the writer's)
            sql`update fees.stationery_items set serial = 4, item_key = 'DB4' where item_key = 'DB3'`
        ])
            expect(await refusal(asUnit(app, units.boditi, (tx) => tx.execute(statement)))).toMatch(
                /cannot go|keeps its serial|unit not found|permission denied|stationery_items_\w+_check/
            );
    });

    it('keeps the ledger, the batches and the closings as written: no update, no delete for anyone', async () => {
        for (const statement of [
            sql`update fees.stationery_movements set quantity = quantity`,
            sql`update fees.stationery_batches set quantity = quantity`,
            sql`update fees.stationery_closings set counted = counted`,
            sql`delete from fees.stationery_items`,
            sql`delete from fees.stationery_movements`
        ])
            expect(await refusal(asUnit(app, units.ser, (tx) => tx.execute(statement)))).toMatch(/permission denied/);
    });
});

describe('the audit trail', () => {
    it('has a row for every item a command moves and one for its movement, in its own transaction, none after a rollback', async () => {
        const ctx = ctxOf(units.ser);
        await app.scoped(ctx, (tx) =>
            stock.receive(tx, ctx, {
                kind: 'bolo_sticker',
                reference: 'AUDIT-1',
                receivedOn: today(),
                range: range('AU', 1, 40),
                variant: 'commercial',
                validEfy: 2018
            })
        );
        expect(await auditOf(ctx.requestId ?? '')).toEqual({
            'fees.stationery_batches:insert': 1,
            'fees.stationery_movements:insert': 1,
            'fees.stationery_items:insert': 40
        });
        const down = ctxOf(units.ser);
        await app.scoped(down, (tx) =>
            stock.allocate(tx, down, { kind: 'bolo_sticker', toUnitId: units.zone.id, items: range('AU', 1, 15) })
        );
        expect(await auditOf(down.requestId ?? '')).toEqual({
            'fees.stationery_movements:insert': 1,
            'fees.stationery_items:update': 15
        });
        const rolledBack = ctxOf(units.ser);
        await expect(
            app.scoped(rolledBack, async (tx) => {
                await stock.allocate(tx, rolledBack, {
                    kind: 'bolo_sticker',
                    toUnitId: units.zone.id,
                    items: range('AU', 16, 20)
                });
                throw new Error('stop');
            })
        ).rejects.toThrow('stop');
        expect(await auditOf(rolledBack.requestId ?? '')).toEqual({});
    });
});

describe("the demo's stationery", () => {
    it('is handed down to Boditi and reconciles, and a second run adds nothing', async () => {
        const made = await importStationeryDemo(api.installer, 'SER', stock, today());
        expect(made).toMatchObject({ deliveries: 7 });
        expect(await importStationeryDemo(api.installer, 'SER', stock, today())).toBeNull();
        for (const kind of ['libre_booklet', 'bolo_sticker'] as const)
            await expectReconciled(kind, units.ser, units.zone);
        const boditi = await run(
            units.boditi,
            (ctx) => (tx) =>
                stock.list(tx, ctx, { kind: 'bolo_sticker', variant: 'taxi', status: 'in_stock', limit: 5 })
        );
        expect(boditi.items[0]).toMatchObject({ key: '0003501', variant: 'taxi', validEfy: 2018 });
    });
});

describe('the HTTP side', () => {
    it("shows a unit's whole stock only within the acting unit's scope; a serial anywhere in the region", async () => {
        const sibling = { sub: SUB.damotKeeper, unit: units.damot };
        const whole = await api.call('GET', `/api/v1/stationery/items?holderUnitId=${units.boditi.id}`, sibling);
        expect(whole.statusCode).toBe(404);
        const one = await api.call('GET', '/api/v1/stationery/items?q=LB0001001', sibling);
        expect(one.statusCode, one.body).toBe(200);
        expect(one.json<{ items: { key: string }[] }>().items.map((i) => i.key)).toEqual(['LB0001001']);
    });

    it('lets a keeper read and receive, and refuses an office head the keeper commands', async () => {
        const keeper = { sub: SUB.keeper, unit: units.boditi };
        const read = await api.call('GET', '/api/v1/stationery/summary?kind=licence_blank', keeper);
        expect(read.statusCode, read.body).toBe(200);
        const received = await api.call('POST', '/api/v1/stationery/batches', keeper, {
            kind: 'receipt_leaf',
            reference: 'HTTP-PAD-1',
            receivedOn: today(),
            range: { series: 'H', from: 1, to: 5 }
        });
        expect(received.statusCode, received.body).toBe(201);
        const head = { sub: SUB.damotKeeper, unit: units.damot };
        expect((await api.call('GET', '/api/v1/stationery/summary?kind=licence_blank', head)).statusCode).toBe(200);
        expect(
            (
                await api.call('POST', '/api/v1/stationery/batches', head, {
                    kind: 'receipt_leaf',
                    reference: 'HTTP-PAD-2',
                    receivedOn: today(),
                    range: { series: 'H', from: 10, to: 12 }
                })
            ).statusCode
        ).toBe(403);
    });
});

describe('the isolation matrix (class R for the items, class T for the batches, the ledger and the closings)', () => {
    const CASE_UNITS: Record<IsolationCase, () => OrgUnit> = {
        own: () => units.zone,
        child: () => units.boditi,
        parent: () => units.ser,
        sibling: () => units.tzb,
        otherZone: () => units.tzbW1,
        otherRegion: () => units.trx
    };
    const series = (c: IsolationCase) => `MX${'ABCDEF'[ISOLATION_CASES.indexOf(c)] ?? 'Z'}`;

    beforeAll(async () => {
        // one batch, item, receipt and closing held by each case's unit, written as the owner (most of them keep no stock)
        for (const c of ISOLATION_CASES) {
            const unit = CASE_UNITS[c]();
            const s = series(c);
            await api.owner.query(
                `with b as (insert into fees.stationery_batches (id, region_id, receiving_unit_id, kind, source, reference, received_on, quantity, first_key, last_key)
                   values (gen_random_uuid(), $1, $2, 'receipt_leaf', 'regional_bureau', $3, '2026-10-01', 1, $4, $4) returning id),
                 m as (insert into fees.stationery_movements (id, region_id, unit_id, kind, movement, batch_id, quantity, first_key, last_key, occurred_on)
                   select gen_random_uuid(), $1, $2, 'receipt_leaf', 'receive', b.id, 1, $4, $4, '2026-10-01' from b returning id)
                 insert into fees.stationery_items (id, region_id, holder_unit_id, batch_id, kind, series, serial, item_key, width, status, status_on)
                   select gen_random_uuid(), $1, $2, b.id, 'receipt_leaf', $5, 1, $4, 1, 'in_stock', '2026-10-01' from b`,
                [unit.regionId, unit.id, `MATRIX-${c}`, `${s}1`, s]
            );
            await api.owner.query(
                `insert into fees.stationery_closings (id, region_id, unit_id, kind, closed_on, expected, counted, missing_keys, missing_count, unexpected_keys, unexpected_count, note)
                 values (gen_random_uuid(), $1, $2, 'receipt_leaf', '2026-10-01', 0, 0, '{}', 0, '{}', 0, $3)`,
                [unit.regionId, unit.id, s]
            );
        }
    }, 120_000);

    const caseOfSeries = (s: string) => ISOLATION_CASES.find((c) => series(c) === s);

    it.each([
        [
            'fees.stationery_items',
            `select series as s from fees.stationery_items where series like 'MX%'`,
            VISIBLE.registry
        ],
        [
            'fees.stationery_batches',
            `select left(first_key, 3) as s from fees.stationery_batches where reference like 'MATRIX-%'`,
            VISIBLE.transaction
        ],
        [
            'fees.stationery_movements',
            `select left(first_key, 3) as s from fees.stationery_movements where first_key like 'MX%'`,
            VISIBLE.transaction
        ],
        [
            'fees.stationery_closings',
            `select note as s from fees.stationery_closings where note like 'MX%'`,
            VISIBLE.transaction
        ]
    ] as const)('shows the acting unit exactly the rows of %s its class allows', async (_table, query, visible) => {
        const seen = await asUnit(app, units.zone, async (tx) =>
            (await tx.execute<{ s: string }>(sql.raw(query))).rows.map((r) => caseOfSeries(r.s))
        );
        expect([...new Set(seen)].sort()).toEqual([...visible].sort());
    });

    it.each(ISOLATION_CASES)('lets the acting unit change the %s item only where class R allows it', async (c) => {
        const changed = await asUnit(app, units.zone, (tx) =>
            tx.execute(sql`update fees.stationery_items set note = 'matrix' where item_key = ${`${series(c)}1`}`)
        );
        expect(changed.rowCount).toBe(WRITABLE.registry.includes(c) ? 1 : 0);
    });

    it.each([
        'fees.stationery_items',
        'fees.stationery_batches',
        'fees.stationery_movements',
        'fees.stationery_closings'
    ])('shows nothing of %s without a context, on a connection that has just served one', async (table) => {
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
    });
});
