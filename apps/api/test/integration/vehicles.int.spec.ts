/**
 * The vehicle register (task 1.1a), over HTTP and through the register's commands on a real PostgreSQL 16 with the Wolaita
 * seeds, Test Zone B and Test Region X: a vehicle is found by plate (current or old), chassis number or federal id from any
 * unit of its region and from no other; the registry tables follow RLS class R (the isolation matrix on vehicles and
 * their ownership periods); the ownership history is whole at commit (no gap, no overlap, a holder in each period, one
 * open while active); every write is audited in its own transaction; the lookup provider shows what a form needs.
 * Names, plates and numbers are generated (never a real person's).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { orgUnits, type OrgUnit } from '@itrms/kernel/org';
import { asUnit, contextFor, ISOLATION_CASES, VISIBLE, WRITABLE, type IsolationCase } from '@itrms/kernel/testing';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import { VehicleRegistry, VehiclesService } from '@itrms/vehicles/api';
import type { VehicleRegister } from '@itrms/vehicles/contracts';
import { isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    damot: '0199f0a0-d000-7000-8000-000000000202',
    boditi: '0199f0a0-d000-7000-8000-000000000302',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    tzbHead: '0199f0a0-d000-7000-8000-00000000f502',
    trx: '0199f0a0-d000-7000-8000-00000000f503'
};

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let registry: VehicleRegistry;
let reads: VehiclesService;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'boditi' | 'tzb' | 'tzbW1' | 'trx', OrgUnit>;
const as = {
    damot: (): As => ({ sub: SUB.damot, unit: units.damot }),
    boditi: (): As => ({ sub: SUB.boditi, unit: units.boditi }),
    zone: (): As => ({ sub: SUB.zoneHead, unit: units.zone }),
    bureau: (): As => ({ sub: SUB.bureau, unit: units.ser }),
    tzb: (): As => ({ sub: SUB.tzbHead, unit: units.tzb }),
    trx: (): As => ({ sub: SUB.trx, unit: units.trx }),
    // a real user, but with no role in this unit
    damotWithoutRole: (): As => ({ sub: SUB.boditi, unit: units.damot })
};

interface Item {
    id: string;
    label: string;
    active: boolean;
    facts: { key: string; label: string; value: string | null }[];
}
interface Summary {
    id: string;
    version: number;
    matched: string | null;
    currentPlate: { text: string } | null;
    owners: { kind: string; id: string; name: { am: string; en: string } }[];
}
interface Detail extends Summary {
    ownerships: { id: string; since: string; until: string | null; holders: { id: string }[] }[];
    plates: { text: string; until: string | null; endedReason: string | null }[];
    libres: { status: string; number: string | null }[];
}

const people: Record<'ayana' | 'bekele' | 'chaltu' | 'trxOwner', string> = {
    ayana: '',
    bekele: '',
    chaltu: '',
    trxOwner: ''
};
let association = '';

/** A command's context: the unit's person, and a request id of its own (the audit rows of one command). */
const ctxOf = (unit: OrgUnit): DbContext => ({ ...contextFor(unit), requestId: `vh-${randomUUID()}` });

async function registerPerson(who: As, n: number, given: string, father: string): Promise<string> {
    const res = await api.call('POST', '/api/v1/persons', who, {
        nameAm: { given, father },
        nameEn: { given: 'Vehicle', father: `Owner${'ABCDEFGH'[n]}` },
        sex: n % 2 ? 'male' : 'female',
        birthYear: 1980 + n
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

/** A vehicle, registered by the register's command in the unit's own transaction. */
async function newVehicle(unit: OrgUnit, input: Partial<VehicleRegister> & Pick<VehicleRegister, 'chassisNumber'>) {
    const ctx = ctxOf(unit);
    const row = await app.scoped(ctx, (tx) =>
        registry.register(tx, ctx, {
            chassisKind: 'other',
            make: 'Toyota',
            model: 'Hilux',
            modelYear: 2018,
            categoryKey: 'light_truck',
            use: 'commercial',
            loadCapacityKg: 1500,
            axles: 2,
            firstRegisteredOn: '2020-03-01',
            owners: [{ kind: 'person', id: people.ayana }],
            acquiredBy: 'first_registration',
            ...input
        })
    );
    return row;
}

const get = async <T>(who: As, url: string): Promise<{ status: number; body: T }> => {
    const res = await api.call('GET', url, who);
    return { status: res.statusCode, body: res.json<T>() };
};
const find = async (who: As, q: string, extra = ''): Promise<Summary[]> => {
    const res = await get<{ items: Summary[] }>(who, `/api/v1/vehicles?q=${encodeURIComponent(q)}${extra}`);
    expect(res.status).toBe(200);
    return res.body.items;
};

/** The audit rows one request wrote, as `table:action`. */
async function auditOf(requestId: string): Promise<string[]> {
    const { rows } = await api.owner.query<{ line: string }>(
        `SELECT table_name || ':' || action AS line FROM kernel.audit_log
          WHERE request_id = $1 AND table_name LIKE 'vehicles.%' ORDER BY at, id`,
        [requestId]
    );
    return rows.map((r) => r.line).sort();
}

const ids = { v1: '', v2: '', trxVehicle: '' };

/** The database's own message: the query builder wraps it as the cause of "Failed query: …". */
async function refusal(work: Promise<unknown>): Promise<string> {
    try {
        await work;
    } catch (error) {
        const e = error as { message: string; cause?: { message?: string } };
        return e.cause?.message ?? e.message;
    }
    throw new Error('expected the database to refuse');
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        { username: 'test.tzb.head', sub: SUB.tzbHead, region: 'SER', home: 'TZB', roles: [['TZB', 'unit_head']] },
        {
            username: 'test.trx.records',
            sub: SUB.trx,
            region: 'TRX',
            home: 'TRX-W1',
            roles: [['TRX-W1', 'records_officer']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex') });
    registry = api.http.get(VehicleRegistry);
    reads = api.http.get(VehiclesService);
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.tzb = await api.unit('SER', 'TZB');
    units.tzbW1 = await api.unit('SER', 'TZB-W1');
    units.trx = await api.unit('TRX', 'TRX-W1');

    // the catalogue of categories in every region
    await api.installer.scoped({}, async (tx) => {
        for (const root of await tx.select().from(orgUnits).where(isNull(orgUnits.parentId)))
            await importVehicleCategories(tx, { id: root.id, regionId: root.regionId });
    });

    people.ayana = await registerPerson(as.damot(), 1, 'አያና', 'ተሰማ');
    people.bekele = await registerPerson(as.boditi(), 2, 'በቀለ', 'ዱባለ');
    people.chaltu = await registerPerson(as.damot(), 3, 'ጫልቱ', 'ገመቹ');
    people.trxOwner = await registerPerson(as.trx(), 4, 'ሳባ', 'ወልደ');
    const org = await api.call('POST', '/api/v1/organisations', as.boditi(), {
        kind: 'association',
        name: { am: 'የሞዴል ትራንስፖርት ማህበር', en: 'Model Transport Association' }
    });
    expect(org.statusCode, org.body).toBe(201);
    association = org.json<{ id: string }>().id;

    // V1: handled by Damot Gale, a VIN with a valid check digit, a federal id, the national plate and an engine number
    const v1 = await newVehicle(units.damot, {
        chassisNumber: '1M8GDM9AXKP042788',
        chassisKind: undefined,
        federalVehicleId: 'ETH-VEH-000001',
        federalIdSource: 'national',
        engineNumber: 'ENG-77012-K',
        categoryKey: 'automobile',
        loadCapacityKg: undefined,
        axles: undefined,
        seats: 4
    });
    ids.v1 = v1.id;
    const ctx1 = ctxOf(units.damot);
    await app.scoped(ctx1, (tx) =>
        registry.recordPlate(tx, ctx1, ids.v1, {
            text: 'ኢት abc-1234',
            source: 'federal',
            since: '2025-01-15',
            endedReason: 'exchanged'
        })
    );
    // V2: handled by Boditi, held by an association; an old regional plate, exchanged for a national one
    const v2 = await newVehicle(units.boditi, {
        chassisNumber: 'JHMCM56557C404453',
        chassisKind: undefined,
        categoryKey: 'pickup',
        owners: [{ kind: 'organisation', id: association }]
    });
    ids.v2 = v2.id;
    const ctx2 = ctxOf(units.boditi);
    await app.scoped(ctx2, async (tx) => {
        await registry.recordPlate(tx, ctx2, ids.v2, {
            text: 'OR 3-A12345',
            source: 'legacy',
            since: '2020-03-01',
            endedReason: 'exchanged'
        });
        await registry.recordPlate(tx, ctx2, ids.v2, {
            text: 'ETH XYZ 9999',
            source: 'federal',
            since: '2025-02-01',
            endedReason: 'exchanged'
        });
    });
    // another region's vehicle, with the same engine number as V1 and a plate of its own
    const trxCtx = ctxOf(units.trx);
    const trxVehicle = await app.scoped(trxCtx, (tx) =>
        registry.register(tx, trxCtx, {
            chassisNumber: 'TRX-CHASSIS-1',
            chassisKind: 'other',
            make: 'Isuzu',
            model: 'NPR',
            modelYear: 2019,
            categoryKey: 'light_truck',
            use: 'commercial',
            loadCapacityKg: 3000,
            axles: 2,
            firstRegisteredOn: '2021-01-01',
            owners: [{ kind: 'person', id: people.trxOwner }],
            acquiredBy: 'first_registration'
        })
    );
    ids.trxVehicle = trxVehicle.id;
    await app.scoped(trxCtx, (tx) =>
        registry.recordPlate(tx, trxCtx, ids.trxVehicle, {
            text: 'ETH TRX 0001',
            source: 'federal',
            since: '2025-03-01',
            endedReason: 'exchanged'
        })
    );
}, 360_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('finding a vehicle', () => {
    const FROM: Record<string, () => As> = {
        'Boditi (its own unit)': as.boditi,
        'Damot Gale (a sibling)': as.damot,
        'Wolaita Zone (the parent)': as.zone,
        'the bureau (the root)': as.bureau,
        'Test Zone B (another zone of the region)': as.tzb
    };

    it.each(Object.keys(FROM))('finds V1 by VIN, plate and federal id from %s', async (from) => {
        const who = FROM[from]?.();
        if (!who) throw new Error(from);
        // the full VIN, and the same typed lower case with spaces and an O for a 0
        expect((await find(who, '1M8GDM9AXKP042788')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'vin']]);
        expect((await find(who, '1m8g dm9a xkp O42788')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'vin']]);
        // the last 6 characters
        expect((await find(who, 'O42788')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'vin_part']]);
        // the current plate, in Ethiopic letters and as written
        expect((await find(who, 'ኢት abc-1234')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'plate']]);
        expect((await find(who, 'ETH ABC 1234')).map((v) => v.id)).toEqual([ids.v1]);
        // a part of the plate
        expect((await find(who, 'abc1234')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'plate_part']]);
        // the federal id
        expect((await find(who, 'eth-veh-000001')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'federal_id']]);
        // the engine number
        expect((await find(who, 'eng-77012-k')).map((v) => [v.id, v.matched])).toEqual([[ids.v1, 'engine']]);
    });

    it('finds a vehicle by the plate it carried before, and says so', async () => {
        const hits = await find(as.damot(), 'or 3 a 12345');
        expect(hits.map((v) => [v.id, v.matched])).toEqual([[ids.v2, 'old_plate']]);
        expect(hits[0]?.currentPlate?.text).toBe('ETH XYZ 9999');
        expect((await find(as.damot(), 'ኦሮ-3-A12345')).map((v) => v.id)).toEqual([ids.v2]);
        expect((await find(as.damot(), 'ETH XYZ 9999')).map((v) => [v.id, v.matched])).toEqual([[ids.v2, 'plate']]);
    });

    it('lists the vehicles of an owner and filters by status', async () => {
        const mine = await get<{ items: Summary[]; nextCursor: string | null }>(
            as.boditi(),
            `/api/v1/vehicles?ownerId=${association}`
        );
        expect(mine.body.items.map((v) => v.id)).toEqual([ids.v2]);
        expect(mine.body.items[0]?.owners[0]).toMatchObject({ kind: 'organisation', id: association });
        const all = await get<{ items: Summary[]; nextCursor: string | null }>(as.boditi(), '/api/v1/vehicles?limit=1');
        expect(all.body.items).toHaveLength(1);
        expect(all.body.nextCursor).toBe(all.body.items[0]?.id);
        const next = await get<{ items: Summary[] }>(
            as.boditi(),
            `/api/v1/vehicles?limit=5&after=${all.body.nextCursor}`
        );
        expect(next.body.items.map((v) => v.id)).not.toContain(all.body.items[0]?.id);
        const stolen = await get<{ items: Summary[] }>(as.boditi(), '/api/v1/vehicles?status=stolen');
        expect(stolen.body.items).toEqual([]);
    });

    it('shows the detail with its plates, owners and no other region', async () => {
        const detail = await get<Detail>(as.tzb(), `/api/v1/vehicles/${ids.v2}`);
        expect(detail.status).toBe(200);
        expect(detail.body.plates.map((p) => [p.text, p.endedReason])).toEqual([
            ['ETH XYZ 9999', null],
            ['OR 3-A12345', 'exchanged']
        ]);
        expect(detail.body.ownerships).toHaveLength(1);
        expect(detail.body.owners[0]?.name.en).toBe('Model Transport Association');
        const person = await get<Detail>(as.tzb(), `/api/v1/vehicles/${ids.v1}`);
        expect(person.body.owners[0]?.name.am).toBe('አያና ተሰማ');
    });

    it('finds nothing in another region, and a vehicle there is a 404', async () => {
        expect(await find(as.trx(), '1M8GDM9AXKP042788')).toEqual([]);
        expect(await find(as.trx(), 'ETH ABC 1234')).toEqual([]);
        expect((await get(as.trx(), `/api/v1/vehicles/${ids.v1}`)).status).toBe(404);
        // and the other way round
        expect(await find(as.damot(), 'ETH TRX 0001')).toEqual([]);
        expect(await find(as.damot(), 'TRX-CHASSIS-1')).toEqual([]);
        expect((await get(as.damot(), `/api/v1/vehicles/${ids.trxVehicle}`)).status).toBe(404);
        expect((await find(as.trx(), 'ETH TRX 0001')).map((v) => v.id)).toEqual([ids.trxVehicle]);
    });

    it('finds nothing without a context, on a connection that has just served one', async () => {
        const one = createDatabase(pg.url('app'), { max: 1 });
        try {
            await asUnit(one, units.damot, (tx) => tx.execute(sql`select 1`));
            const rows = await one.scoped(
                {},
                async (tx) =>
                    (
                        await tx.execute(
                            sql`select * from vehicles.search_vehicles('1M8GDM9AXKP042788', 'ETHABC1234', 10)`
                        )
                    ).rows
            );
            expect(rows).toEqual([]);
        } finally {
            await one.close();
        }
    });

    it('needs the permission to read, and a unit the person has a role in', async () => {
        expect((await get(as.damotWithoutRole(), '/api/v1/vehicles?q=ABC1234')).status).toBe(403);
        expect((await get(as.boditi(), '/api/v1/vehicles?q=')).status).toBe(422);
        expect((await get(as.boditi(), '/api/v1/vehicles/not-a-uuid')).status).toBe(400);
    });

    it('lists the categories', async () => {
        const res = await get<{ items: { key: string; needsSeats: boolean; family: string }[] }>(
            as.damot(),
            '/api/v1/vehicle-categories'
        );
        expect(res.status).toBe(200);
        expect(res.body.items.map((c) => c.key)).toContain('three_wheeler');
        expect(res.body.items.find((c) => c.key === 'bus')).toMatchObject({ needsSeats: true, family: 'passenger' });
    });
});

describe('the registry rules', () => {
    it('refuses a VIN whose check digit fails where it binds, one with I, O or Q, and a duplicate chassis or plate', async () => {
        const ctx = ctxOf(units.damot);
        const attempt = (chassisNumber: string, chassisKind?: 'iso3779' | 'other') =>
            app.scoped(ctx, (tx) =>
                registry.register(tx, ctx, {
                    chassisNumber,
                    ...(chassisKind ? { chassisKind } : {}),
                    make: 'Bajaj',
                    model: 'RE',
                    modelYear: 2022,
                    categoryKey: 'three_wheeler',
                    use: 'public_transport',
                    seats: 3,
                    firstRegisteredOn: '2022-06-01',
                    owners: [{ kind: 'person', id: people.chaltu }],
                    acquiredBy: 'first_registration'
                })
            );
        await expect(attempt('1M8GDM9A1KP042788')).rejects.toMatchObject({
            status: 422,
            errors: [{ path: 'chassisNumber', code: 'invalid_vin' }]
        });
        await expect(attempt('1M8GDM9AXKP04278O')).rejects.toMatchObject({ status: 422 });
        await expect(attempt('1M8GDM9AXKP042788')).rejects.toMatchObject({ status: 409, code: 'duplicate_reference' });
        // the same chassis number typed another way is the same vehicle
        await expect(attempt('1m8g-dm9a-xkp-042788')).rejects.toMatchObject({
            status: 409,
            code: 'duplicate_reference'
        });
    });

    it('flags a wrong check digit of a Japanese WMI as a warning and keeps it', async () => {
        const row = await newVehicle(units.damot, {
            chassisNumber: 'JHMCM56547C404999',
            chassisKind: undefined,
            categoryKey: 'automobile',
            seats: 5,
            loadCapacityKg: undefined,
            axles: undefined
        });
        expect(row.vinCheck).toBe('mismatch');
        expect(row.chassisKind).toBe('iso3779');
    });

    it('refuses a seat count the category does not take, and a freight vehicle without axles', async () => {
        await expect(
            newVehicle(units.damot, { chassisNumber: 'SEATS-0001', categoryKey: 'automobile' })
        ).rejects.toMatchObject({ status: 422 });
        await expect(newVehicle(units.damot, { chassisNumber: 'AXLES-0001', axles: undefined })).rejects.toMatchObject({
            status: 422,
            errors: [{ path: 'axles' }]
        });
    });

    it('answers 409 duplicate_reference when the plate is open on another vehicle', async () => {
        const other = await newVehicle(units.damot, { chassisNumber: 'PLATE-DUP-1' });
        const ctx = ctxOf(units.damot);
        await expect(
            app.scoped(ctx, (tx) =>
                registry.recordPlate(tx, ctx, other.id, {
                    text: 'eth abc 1234',
                    source: 'federal',
                    since: '2025-04-01',
                    endedReason: 'exchanged'
                })
            )
        ).rejects.toMatchObject({ status: 409, code: 'duplicate_reference' });
        // the failed command left nothing behind: the vehicle has no plate
        expect((await app.scoped(ctx, (tx) => reads.get(tx, other.id))).plates).toEqual([]);
        await expect(
            app.scoped(ctx, (tx) =>
                registry.recordPlate(tx, ctx, other.id, {
                    text: 'not a plate!',
                    source: 'manual',
                    since: '2025-04-01',
                    endedReason: 'exchanged'
                })
            )
        ).rejects.toMatchObject({ status: 422, errors: [{ code: 'invalid_plate' }] });
    });

    it('replaces the libre in force, and takes a vehicle off the register with its open period', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'LIBRE-0001' });
        const ctx = ctxOf(units.damot);
        await app.scoped(ctx, async (tx) => {
            await registry.recordLibre(tx, ctx, v.id, { number: 'LB-0001', issuedOn: '2020-03-05' });
            await registry.recordLibre(tx, ctx, v.id, { number: 'LB-0002', issuedOn: '2021-03-05' });
        });
        const libres = (await app.scoped(ctx, (tx) => reads.get(tx, v.id))).libres;
        expect(libres.map((l) => [l.number, l.status])).toEqual([
            ['LB-0002', 'issued'],
            ['LB-0001', 'replaced']
        ]);
        const gone = await app.scoped(ctx, (tx) =>
            registry.setStatus(tx, ctx, v.id, v.rowVersion, { status: 'deregistered', on: '2023-01-01' })
        );
        expect(gone.status).toBe('deregistered');
        const after = await app.scoped(ctx, (tx) => reads.get(tx, v.id));
        expect(after.ownerships.map((o) => o.until)).toEqual(['2023-01-01']);
        expect(after.libres.map((l) => l.status)).toEqual(['cancelled', 'replaced']);
        // a deregistered vehicle is not found by the form lookup but resolves
        await expect(
            app.scoped(ctx, (tx) =>
                registry.setStatus(tx, ctx, v.id, gone.rowVersion, { status: 'stolen', on: '2023-02-01' })
            )
        ).rejects.toBeInstanceOf(ConflictError);
    });
});

describe('the ownership history', () => {
    it('keeps contiguous periods with one open: register, transfer, transfer to two co-owners', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'HISTORY-001' });
        const ctx = ctxOf(units.damot);
        const second = await app.scoped(ctx, (tx) =>
            registry.transferOwnership(tx, ctx, v.id, v.rowVersion, {
                since: '2022-05-10',
                owners: [{ kind: 'person', id: people.bekele }],
                acquiredBy: 'sale'
            })
        );
        expect(second.rowVersion).toBe(v.rowVersion + 1);
        await app.scoped(ctx, (tx) =>
            registry.transferOwnership(tx, ctx, v.id, second.rowVersion, {
                since: '2024-02-01',
                owners: [
                    { kind: 'person', id: people.chaltu },
                    { kind: 'organisation', id: association }
                ],
                acquiredBy: 'inheritance',
                note: 'estate'
            })
        );
        const detail = (await get<Detail>(as.damot(), `/api/v1/vehicles/${v.id}`)).body;
        expect(detail.ownerships.map((o) => [o.since, o.until, o.holders.length])).toEqual([
            ['2024-02-01', null, 2],
            ['2022-05-10', '2024-02-01', 1],
            ['2020-03-01', '2022-05-10', 1]
        ]);
        expect(detail.owners.map((o) => o.id)).toEqual([people.chaltu, association]);
        // the owner's list follows the open period
        expect(
            (await get<{ items: Summary[] }>(as.damot(), `/api/v1/vehicles?ownerId=${people.ayana}`)).body.items.map(
                (x) => x.id
            )
        ).not.toContain(v.id);
        expect(
            (await get<{ items: Summary[] }>(as.damot(), `/api/v1/vehicles?ownerId=${people.chaltu}`)).body.items.map(
                (x) => x.id
            )
        ).toContain(v.id);
        // a transfer on or before the current period's start is refused
        const ctx2 = ctxOf(units.damot);
        await expect(
            app.scoped(ctx2, (tx) =>
                registry.transferOwnership(tx, ctx2, v.id, 3, {
                    since: '2024-02-01',
                    owners: [{ kind: 'person', id: people.ayana }],
                    acquiredBy: 'gift'
                })
            )
        ).rejects.toMatchObject({ status: 422 });
    });

    /** Raw writes as the API role, the way a bug or a future code path might: the database must refuse a broken chain. */
    describe('refuses at commit', () => {
        const insertPeriod = (tx: Tx, vehicleId: string, since: string, until: string | null) =>
            tx.execute(sql`insert into vehicles.vehicle_ownerships (id, vehicle_id, since, until, acquired_by)
                values (gen_random_uuid(), ${vehicleId}, ${since}::date, ${until}::date, 'sale')`);
        const insertHolder = (tx: Tx, vehicleId: string, since: string, personId: string) =>
            tx.execute(sql`insert into vehicles.vehicle_owners (id, ownership_id, person_id, ordinal)
                select gen_random_uuid(), o.id, ${personId}, 1 from vehicles.vehicle_ownerships o
                 where o.vehicle_id = ${vehicleId} and o.since = ${since}::date`);
        const closeOpen = (tx: Tx, vehicleId: string, until: string) =>
            tx.execute(sql`update vehicles.vehicle_ownerships set until = ${until}::date
                 where vehicle_id = ${vehicleId} and until is null`);

        it('a gap between two periods', async () => {
            const v = await newVehicle(units.damot, { chassisNumber: 'GAP-0001' });
            const ctx = ctxOf(units.damot);
            const refused = await refusal(
                app.scoped(ctx, async (tx) => {
                    await closeOpen(tx, v.id, '2022-01-01');
                    await insertPeriod(tx, v.id, '2022-02-01', null);
                    await insertHolder(tx, v.id, '2022-02-01', people.bekele);
                })
            );
            expect(refused).toMatch(/gap or an overlap/);
        });

        it('an overlap of two periods', async () => {
            const v = await newVehicle(units.damot, { chassisNumber: 'OVERLAP-001' });
            const ctx = ctxOf(units.damot);
            const refused = await refusal(
                app.scoped(ctx, async (tx) => {
                    await closeOpen(tx, v.id, '2022-01-01');
                    await insertPeriod(tx, v.id, '2021-06-01', null);
                    await insertHolder(tx, v.id, '2021-06-01', people.bekele);
                })
            );
            expect(refused).toMatch(/vehicle_ownerships_no_overlap|conflicting key/);
        });

        it('a second open period', async () => {
            const v = await newVehicle(units.damot, { chassisNumber: 'TWOOPEN-01' });
            const ctx = ctxOf(units.damot);
            expect(await refusal(app.scoped(ctx, (tx) => insertPeriod(tx, v.id, '2022-01-01', null)))).toMatch(
                /vehicle_ownerships_open_uq|duplicate key/
            );
        });

        it('a period without a holder', async () => {
            const v = await newVehicle(units.damot, { chassisNumber: 'NOHOLDER-01' });
            const ctx = ctxOf(units.damot);
            const refused = await refusal(
                app.scoped(ctx, async (tx) => {
                    await closeOpen(tx, v.id, '2022-01-01');
                    await insertPeriod(tx, v.id, '2022-01-01', null);
                })
            );
            expect(refused).toMatch(/has no holder/);
        });

        it('an active vehicle with no open period, and a deregistered one that still has one', async () => {
            const v = await newVehicle(units.damot, { chassisNumber: 'STATUS-001' });
            const ctx = ctxOf(units.damot);
            expect(await refusal(app.scoped(ctx, (tx) => closeOpen(tx, v.id, '2022-01-01')))).toMatch(
                /must have one open ownership period/
            );
            const stolen = await refusal(
                app.scoped(ctx, (tx) =>
                    tx.execute(sql`update vehicles.vehicles set status = 'deregistered' where id = ${v.id}`)
                )
            );
            expect(stolen).toMatch(/must have no open ownership period/);
        });

        it('a first period that begins before the first registration', async () => {
            await expect(
                newVehicle(units.damot, { chassisNumber: 'BEFORE-0001', since: '2019-01-01' })
            ).rejects.toMatchObject({ status: 422 });
            const v = await newVehicle(units.damot, { chassisNumber: 'BEFORE-0002' });
            const ctx = ctxOf(units.damot);
            const refused = await refusal(
                app.scoped(ctx, async (tx) => {
                    // a period before the registration, ending where the first begins: no gap, but it is too early
                    await insertPeriod(tx, v.id, '2019-01-01', '2020-03-01');
                    await insertHolder(tx, v.id, '2019-01-01', people.bekele);
                })
            );
            expect(refused).toMatch(/before its first registration/);
        });

        it('a holder that is both a person and an organisation', async () => {
            const v = await newVehicle(units.damot, { chassisNumber: 'HOLDER-001' });
            const ctx = ctxOf(units.damot);
            const refused = await refusal(
                app.scoped(ctx, (tx) =>
                    tx.execute(sql`insert into vehicles.vehicle_owners (id, ownership_id, person_id, organisation_id, ordinal)
                        select gen_random_uuid(), o.id, ${people.ayana}, ${association}, 2 from vehicles.vehicle_ownerships o where o.vehicle_id = ${v.id}`)
                )
            );
            expect(refused).toMatch(/vehicle_owners_one_holder_check/);
        });
    });

    it('lets one of two transfers on the same version win and answers 409 stale_version to the other', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'RACE-00001' });
        const attempt = (who: string, since: string) => {
            const ctx = ctxOf(units.damot);
            return app.scoped(ctx, (tx) =>
                registry.transferOwnership(tx, ctx, v.id, v.rowVersion, {
                    since,
                    owners: [{ kind: 'person', id: who }],
                    acquiredBy: 'sale'
                })
            );
        };
        const results = await Promise.allSettled([
            attempt(people.bekele, '2022-01-01'),
            attempt(people.chaltu, '2022-01-02')
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(lost?.reason).toBeInstanceOf(ConflictError);
        expect(lost?.reason).toMatchObject({ status: 409, code: 'stale_version' });
        const ctx = ctxOf(units.damot);
        expect((await app.scoped(ctx, (tx) => reads.get(tx, v.id))).ownerships).toHaveLength(2);
    });
});

describe('the audit trail', () => {
    it('writes a row for each insert and update in the command’s own transaction', async () => {
        const ctx = ctxOf(units.damot);
        const v = await app.scoped(ctx, (tx) =>
            registry.register(tx, ctx, {
                chassisNumber: 'AUDIT-00001',
                chassisKind: 'other',
                make: 'Hino',
                model: '500',
                modelYear: 2017,
                categoryKey: 'heavy_truck',
                use: 'commercial',
                loadCapacityKg: 9000,
                axles: 3,
                firstRegisteredOn: '2020-03-01',
                owners: [
                    { kind: 'person', id: people.ayana },
                    { kind: 'person', id: people.chaltu }
                ],
                acquiredBy: 'first_registration'
            })
        );
        expect(await auditOf(ctx.requestId ?? '')).toEqual([
            'vehicles.vehicle_owners:insert',
            'vehicles.vehicle_owners:insert',
            'vehicles.vehicle_ownerships:insert',
            'vehicles.vehicles:insert'
        ]);
        const transfer = ctxOf(units.damot);
        await app.scoped(transfer, (tx) =>
            registry.transferOwnership(tx, transfer, v.id, v.rowVersion, {
                since: '2023-03-01',
                owners: [{ kind: 'person', id: people.bekele }],
                acquiredBy: 'sale'
            })
        );
        expect(await auditOf(transfer.requestId ?? '')).toEqual([
            'vehicles.vehicle_owners:insert',
            'vehicles.vehicle_ownerships:insert',
            'vehicles.vehicle_ownerships:update',
            'vehicles.vehicles:update'
        ]);
        const plate = ctxOf(units.damot);
        await app.scoped(plate, async (tx) => {
            await registry.recordPlate(tx, plate, v.id, {
                text: 'ETH AUD 0001',
                source: 'federal',
                since: '2025-01-01',
                endedReason: 'exchanged'
            });
            await registry.recordPlate(tx, plate, v.id, {
                text: 'ETH AUD 0002',
                source: 'federal',
                since: '2025-06-01',
                endedReason: 'lost'
            });
        });
        expect(await auditOf(plate.requestId ?? '')).toEqual([
            'vehicles.plate_assignments:insert',
            'vehicles.plate_assignments:insert',
            'vehicles.plate_assignments:update'
        ]);
    });

    it('leaves nothing, not even an audit row, when the command is rolled back', async () => {
        const ctx = ctxOf(units.damot);
        await expect(
            app.scoped(ctx, async (tx) => {
                await registry.register(tx, ctx, {
                    chassisNumber: 'ROLLBACK-01',
                    chassisKind: 'other',
                    make: 'Hino',
                    model: '500',
                    modelYear: 2017,
                    categoryKey: 'heavy_truck',
                    use: 'commercial',
                    loadCapacityKg: 9000,
                    axles: 3,
                    firstRegisteredOn: '2020-03-01',
                    owners: [{ kind: 'person', id: people.ayana }],
                    acquiredBy: 'first_registration'
                });
                throw new Error('stop');
            })
        ).rejects.toThrow('stop');
        expect(await auditOf(ctx.requestId ?? '')).toEqual([]);
        const { rows } = await api.owner.query("select 1 from vehicles.vehicles where chassis_number = 'ROLLBACK-01'");
        expect(rows).toEqual([]);
    });
});

describe('class R: the isolation matrix on vehicles and their ownership periods', () => {
    const CASE_UNITS: Record<IsolationCase, () => OrgUnit> = {
        own: () => units.zone,
        child: () => units.boditi,
        parent: () => units.ser,
        sibling: () => units.tzb,
        otherZone: () => units.tzbW1,
        otherRegion: () => units.trx
    };
    const matrix = {} as Record<IsolationCase, string>;
    const holderFor = (c: IsolationCase) => (c === 'otherRegion' ? people.trxOwner : people.ayana);

    beforeAll(async () => {
        for (const c of ISOLATION_CASES) {
            const unit = CASE_UNITS[c]();
            const ctx = ctxOf(unit);
            const v = await app.scoped(ctx, (tx) =>
                registry.register(tx, ctx, {
                    chassisNumber: `MATRIX-${c.toUpperCase()}`,
                    chassisKind: 'other',
                    make: 'Matrix',
                    model: c,
                    modelYear: 2020,
                    categoryKey: 'tractor',
                    use: 'government',
                    firstRegisteredOn: '2020-03-01',
                    owners: [{ kind: 'person', id: holderFor(c) }],
                    acquiredBy: 'first_registration'
                })
            );
            matrix[c] = v.id;
        }
    }, 120_000);

    const caseOf = (id: string) => ISOLATION_CASES.find((c) => matrix[c] === id);

    it('shows the acting unit exactly the vehicles class R allows', async () => {
        const seen = await asUnit(app, units.zone, async (tx) =>
            (await tx.execute<{ id: string }>(sql`select id from vehicles.vehicles where make = 'Matrix'`)).rows.map(
                (r) => caseOf(r.id)
            )
        );
        expect([...seen].sort()).toEqual([...VISIBLE.registry].sort());
    });

    it('shows the same for the ownership periods', async () => {
        const seen = await asUnit(app, units.zone, async (tx) =>
            (
                await tx.execute<{ vehicle_id: string }>(
                    sql`select o.vehicle_id from vehicles.vehicle_ownerships o join vehicles.vehicles v on v.id = o.vehicle_id where v.make = 'Matrix'`
                )
            ).rows.map((r) => caseOf(r.vehicle_id))
        );
        expect([...seen].sort()).toEqual([...VISIBLE.registry].sort());
    });

    it.each(ISOLATION_CASES)(
        'lets the acting unit change the %s vehicle and its periods only where the class allows it',
        async (c) => {
            const allowed = WRITABLE.registry.includes(c) ? 1 : 0;
            const vehicle = await asUnit(app, units.zone, (tx) =>
                tx.execute(sql`update vehicles.vehicles set colour = 'white' where id = ${matrix[c]}`)
            );
            expect(vehicle.rowCount).toBe(allowed);
            const period = await asUnit(app, units.zone, (tx) =>
                tx.execute(
                    sql`update vehicles.vehicle_ownerships set updated_at = now() where vehicle_id = ${matrix[c]}`
                )
            );
            expect(period.rowCount).toBe(allowed);
        }
    );

    it.each(ISOLATION_CASES)('refuses a child row for the %s vehicle unless the unit handles it', async (c) => {
        const n = String(ISOLATION_CASES.indexOf(c)).padStart(4, '0');
        const insert = asUnit(app, units.zone, (tx) =>
            tx.execute(sql`insert into vehicles.plate_assignments (id, vehicle_id, plate_text, plate_key, format, source, since)
                values (gen_random_uuid(), ${matrix[c]}, ${`ETH MTX ${n}`}, ${`ETHMTX${n}`}, 'national', 'federal', '2025-01-01')`)
        );
        if (WRITABLE.registry.includes(c)) await expect(insert).resolves.toBeDefined();
        else expect(await refusal(insert)).toMatch(/row-level security|vehicle is not found|unit not/);
    });

    it.each(['vehicles.vehicles', 'vehicles.vehicle_ownerships'])(
        'shows nothing of %s without a context, on a connection that has just served one',
        async (table) => {
            const one = createDatabase(pg.url('app'), { max: 1 });
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

    it('has no delete for anyone', async () => {
        const refused = await refusal(
            asUnit(app, units.zone, (tx) => tx.execute(sql`delete from vehicles.vehicles where id = ${matrix.own}`))
        );
        expect(refused).toMatch(/permission denied/);
    });

    it('answers 403 from the service to a unit that does not handle the vehicle, and lets the unit above write', async () => {
        const boditiVehicle = await newVehicle(units.boditi, { chassisNumber: 'SCOPE-0001' });
        // Damot Gale reads the vehicle (the region does) but its subtree does not include Boditi
        const damot = ctxOf(units.damot);
        await expect(
            app.scoped(damot, (tx) =>
                registry.transferOwnership(tx, damot, boditiVehicle.id, boditiVehicle.rowVersion, {
                    since: '2022-01-01',
                    owners: [{ kind: 'person', id: people.bekele }],
                    acquiredBy: 'sale'
                })
            )
        ).rejects.toBeInstanceOf(ForbiddenError);
        const direct = await asUnit(app, units.damot, (tx) =>
            tx.execute(sql`update vehicles.vehicles set colour = 'red' where id = ${boditiVehicle.id}`)
        );
        expect(direct.rowCount).toBe(0);
        // the zone handles everything below it
        const zone = ctxOf(units.zone);
        const moved = await app.scoped(zone, (tx) =>
            registry.transferOwnership(tx, zone, boditiVehicle.id, boditiVehicle.rowVersion, {
                since: '2022-01-01',
                owners: [{ kind: 'person', id: people.bekele }],
                acquiredBy: 'sale'
            })
        );
        expect(moved.rowVersion).toBe(boditiVehicle.rowVersion + 1);
        // a vehicle of another region is not there at all
        await expect(
            app.scoped(zone, (tx) =>
                registry.transferOwnership(tx, zone, ids.trxVehicle, 1, {
                    since: '2022-01-01',
                    owners: [{ kind: 'person', id: people.bekele }],
                    acquiredBy: 'sale'
                })
            )
        ).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('the rules of the commands (review of 1.1a)', () => {
    const plate = (text: string, since = '2025-01-01') => ({
        text,
        source: 'federal' as const,
        since,
        endedReason: 'exchanged' as const
    });

    it('records and finds a plate whose series letter is Ethiopic only as a refusal: 422 invalid_plate, not a 500', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'ETHSERIES-01' });
        const ctx = ctxOf(units.damot);
        await expect(
            app.scoped(ctx, (tx) => registry.recordPlate(tx, ctx, v.id, plate('ኦሮ 3-ሀ12345')))
        ).rejects.toMatchObject({ status: 422, errors: [{ code: 'invalid_plate' }] });
        // a Latin series letter records and is found, in both scripts of the region code
        await app.scoped(ctx, (tx) => registry.recordPlate(tx, ctx, v.id, plate('ኦሮ 3-B54321')));
        expect((await find(as.damot(), 'or 3 b 54321')).map((x) => [x.id, x.matched])).toEqual([[v.id, 'plate']]);
    });

    it('refuses the other kind for a VIN-shaped number, one under 4 characters, and a repeat of any kind', async () => {
        await expect(
            newVehicle(units.damot, { chassisNumber: '2HGFA16509H000001', chassisKind: 'other' })
        ).rejects.toMatchObject({ status: 422, errors: [{ path: 'chassisNumber', code: 'invalid_vin' }] });
        await expect(newVehicle(units.damot, { chassisNumber: 'A./B' })).rejects.toMatchObject({ status: 422 });
        await newVehicle(units.damot, { chassisNumber: 'KINDS-0001' });
        await expect(newVehicle(units.damot, { chassisNumber: 'kinds 0001' })).rejects.toMatchObject({
            status: 409,
            code: 'duplicate_reference'
        });
    });

    it('answers 422 to a cursor that is not an id', async () => {
        for (const bad of ['abc', 'a'.repeat(40)]) {
            const res = await api.call('GET', `/api/v1/vehicles?after=${bad}`, as.damot());
            expect(res.statusCode).toBe(422);
            expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('after');
        }
    });

    it('keeps the owners while a vehicle is stolen and restores it, audited and scope-checked', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'STOLEN-0001' });
        const ctx = ctxOf(units.damot);
        const stolen = await app.scoped(ctx, (tx) =>
            registry.setStatus(tx, ctx, v.id, v.rowVersion, { status: 'stolen', on: '2023-01-01' })
        );
        expect(stolen.status).toBe('stolen');
        const mid = (await get<Detail>(as.damot(), `/api/v1/vehicles/${v.id}`)).body;
        expect(mid.ownerships.map((o) => o.until)).toEqual([null]);
        // a stolen vehicle cannot be transferred, nor restored from the wrong office or with a stale version
        const other = ctxOf(units.boditi);
        await expect(
            app.scoped(other, (tx) => registry.restore(tx, other, v.id, stolen.rowVersion))
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(app.scoped(ctx, (tx) => registry.restore(tx, ctx, v.id, v.rowVersion))).rejects.toMatchObject({
            status: 409,
            code: 'stale_version'
        });
        const back = ctxOf(units.damot);
        const restored = await app.scoped(back, (tx) => registry.restore(tx, back, v.id, stolen.rowVersion));
        expect(restored.status).toBe('active');
        expect(await auditOf(back.requestId ?? '')).toEqual(['vehicles.vehicles:update']);
        // an active vehicle is not restored
        const again = ctxOf(units.damot);
        await expect(
            app.scoped(again, (tx) => registry.restore(tx, again, v.id, restored.rowVersion))
        ).rejects.toMatchObject({ status: 409, code: 'invalid_transition' });
    });

    it('checks the dates of a plate: not before the registration, not before the last plate ended, not in the future', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'DATES-00001' });
        const ctx = ctxOf(units.damot);
        const record = (input: ReturnType<typeof plate>) =>
            app.scoped(ctx, (tx) => registry.recordPlate(tx, ctx, v.id, input));
        await expect(record(plate('ETH DAT 0001', '2020-02-01'))).rejects.toMatchObject({
            status: 422,
            errors: [{ code: 'before_registration' }]
        });
        await expect(record(plate('ETH DAT 0001', '2999-01-01'))).rejects.toMatchObject({
            errors: [{ code: 'in_future' }]
        });
        await record(plate('ETH DAT 0001', '2021-01-01'));
        await record(plate('ETH DAT 0002', '2022-01-01'));
        await expect(record(plate('ETH DAT 0003', '2021-06-01'))).rejects.toMatchObject({
            errors: [{ code: 'before_period' }]
        });
    });

    it('refuses a plate for a deregistered vehicle, and a future transfer or status date', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'FUTURE-0001' });
        const ctx = ctxOf(units.damot);
        await expect(
            app.scoped(ctx, (tx) =>
                registry.transferOwnership(tx, ctx, v.id, v.rowVersion, {
                    since: '2999-01-01',
                    owners: [{ kind: 'person', id: people.bekele }],
                    acquiredBy: 'sale'
                })
            )
        ).rejects.toMatchObject({ errors: [{ code: 'in_future' }] });
        await expect(
            app.scoped(ctx, (tx) =>
                registry.setStatus(tx, ctx, v.id, v.rowVersion, { status: 'deregistered', on: '2999-01-01' })
            )
        ).rejects.toMatchObject({ errors: [{ code: 'in_future' }] });
        const gone = await app.scoped(ctx, (tx) =>
            registry.setStatus(tx, ctx, v.id, v.rowVersion, { status: 'deregistered', on: '2023-01-01' })
        );
        expect(gone.status).toBe('deregistered');
        await expect(
            app.scoped(ctx, (tx) => registry.recordPlate(tx, ctx, v.id, plate('ETH FUT 0001')))
        ).rejects.toMatchObject({ status: 409, code: 'invalid_transition' });
    });

    it('ties a libre to an ownership period of its own vehicle', async () => {
        const a = await newVehicle(units.damot, { chassisNumber: 'LIBFK-00001' });
        const b = await newVehicle(units.damot, { chassisNumber: 'LIBFK-00002' });
        const ctx = ctxOf(units.damot);
        const refused = await refusal(
            app.scoped(ctx, (tx) =>
                tx.execute(sql`insert into vehicles.libres (id, vehicle_id, ownership_id, issued_on, issuing_unit_id)
                    select gen_random_uuid(), ${a.id}, o.id, '2021-01-01'::date, ${units.damot.id}
                      from vehicles.vehicle_ownerships o where o.vehicle_id = ${b.id}`)
            )
        );
        expect(refused).toMatch(/libres_ownership_vehicle_fk/);
    });
});

describe('the lookup of a vehicle in a form', () => {
    const lookup = (who: As, q: string, headers: Record<string, string> = {}) =>
        api.call('GET', `/api/v1/registry-lookups/vehicle?q=${encodeURIComponent(q)}`, who, undefined, headers);
    const items = (who: As, idList: string[]) =>
        api.call('GET', `/api/v1/registry-lookups/vehicle/items?ids=${idList.join(',')}`, who);

    it('is listed with its facts, in Amharic and in English', async () => {
        const am = await api.call('GET', '/api/v1/registry-lookups', as.damot(), undefined, {
            'accept-language': 'am'
        });
        const listed = am.json<{ items: { key: string; title: string; facts: { key: string }[] }[] }>().items;
        const vehicle = listed.find((i) => i.key === 'vehicle');
        expect(vehicle?.title).toBe('ተሽከርካሪ');
        expect(vehicle?.facts.map((f) => f.key)).toEqual([
            'plate',
            'makeModel',
            'year',
            'category',
            'owner',
            'federalId',
            'handlingUnit'
        ]);
        const en = await api.call('GET', '/api/v1/registry-lookups', as.damot(), undefined, {
            'accept-language': 'en'
        });
        expect(
            en.json<{ items: { key: string; title: string }[] }>().items.find((i) => i.key === 'vehicle')?.title
        ).toBe('Vehicle');
    });

    it('finds by plate and shows the facts the form needs, in Amharic and in English', async () => {
        const res = await lookup(as.boditi(), 'abc 1234', { 'accept-language': 'am' });
        expect(res.statusCode, res.body).toBe(200);
        const [item] = res.json<{ items: Item[] }>().items;
        expect(item).toMatchObject({ id: ids.v1, label: 'ETH ABC 1234', active: true });
        const value = (key: string) => item?.facts.find((f) => f.key === key)?.value;
        expect(value('makeModel')).toBe('Toyota Hilux');
        expect(value('year')).toBe('2018');
        expect(value('federalId')).toBe('ETH-VEH-000001');
        expect(value('owner')).toBe('አያና ተሰማ');
        expect(value('category')).toBe('አውቶሞቢል');
        const english = await lookup(as.boditi(), 'ETHABC1234', { 'accept-language': 'en' });
        const [en] = english.json<{ items: Item[] }>().items;
        expect(en?.facts.find((f) => f.key === 'owner')?.value).toBe('Vehicle OwnerB');
        expect(en?.facts.find((f) => f.key === 'category')?.value).toBe('Automobile');
        expect(en?.facts.find((f) => f.key === 'plate')?.label).toBe('Plate');
    });

    it('searches the active vehicles only, and resolves a deregistered one with active false', async () => {
        const v = await newVehicle(units.damot, { chassisNumber: 'LOOKUP-GONE' });
        const ctx = ctxOf(units.damot);
        await app.scoped(ctx, (tx) =>
            registry.recordPlate(tx, ctx, v.id, {
                text: 'ETH GON 0001',
                source: 'federal',
                since: '2025-01-01',
                endedReason: 'exchanged'
            })
        );
        expect((await lookup(as.damot(), 'ETH GON 0001')).json<{ items: Item[] }>().items.map((i) => i.id)).toEqual([
            v.id
        ]);
        const off = ctxOf(units.damot);
        await app.scoped(off, (tx) =>
            registry.setStatus(tx, off, v.id, v.rowVersion, { status: 'deregistered', on: '2025-02-01' })
        );
        expect((await lookup(as.damot(), 'ETH GON 0001')).json<{ items: Item[] }>().items).toEqual([]);
        const resolved = await items(as.damot(), [v.id]);
        expect(resolved.json<{ items: Item[] }>().items).toMatchObject([{ id: v.id, active: false }]);
    });

    it('does not resolve a vehicle of another region, and answers 403 without a role in the unit', async () => {
        expect((await items(as.trx(), [ids.v1])).json<{ items: Item[] }>().items).toEqual([]);
        expect((await items(as.damot(), [ids.trxVehicle])).json<{ items: Item[] }>().items).toEqual([]);
        expect((await lookup(as.damotWithoutRole(), 'abc 1234')).statusCode).toBe(403);
    });
});
