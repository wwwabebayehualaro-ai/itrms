/**
 * The demo's vehicles (task 1.1b, docs/demo-plan.md): generated, never real records. A seeded generator makes the same
 * vehicles on every reset: their chassis numbers are ISO 3779 VINs with a correct check digit, their plates are national
 * (`ETH` + three letters + four digits) or, in the first region, old regional plates and their exchange for national ones
 * (Directive 1050/2025); a share of them changed owners. Everything is written through the register's own commands, so the
 * ownership chain, the uniqueness and the audit rows are those of a real registration. Run again, it adds nothing.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { orgUnits } from '@itrms/kernel/tables';
import { persons, type OrganisationsService, type PersonsService } from '@itrms/parties/api';

import type { VehicleRegistry } from '../api/vehicle-registry.service';
import { vehicles } from '../api/vehicles.table';
import { vinCheckDigit, type VehicleRegister } from '../contracts';

export interface VehicleDemoDeps {
    registry: Pick<VehicleRegistry, 'register' | 'transferOwnership' | 'recordPlate' | 'recordLibre'>;
    persons: Pick<PersonsService, 'create'>;
    organisations: Pick<OrganisationsService, 'create'>;
}

export interface VehicleDemoCounts {
    vehicles: number;
    exchanged: number;
    legacyOnly: number;
    transferred: number;
    persons: number;
    organisations: number;
}

/**
 * The demo's regions: the offices that handle the vehicles (the first one gets the story vehicle the walkthrough opens) and,
 * where the region had them, the code of its old regional plates.
 */
export const DEMO_VEHICLE_REGIONS: Record<string, { offices: readonly string[]; vehicles: number; legacy?: string }> = {
    SER: { offices: ['WOL-BODITI', 'WOL-DAMOT-GALE', 'WOL'], vehicles: 36, legacy: 'ደቡ' },
    SCA: { offices: ['SCA-NORTH', 'SCA-SOUTH', 'SCA-NORTH-D1'], vehicles: 18 }
};

/** The vehicle the walkthrough finds from another office (demo-plan.md): a Boditi minibus with an exchanged plate. */
export const STORY_PLATE = 'ETH BOD 1001';
const STORY_OLD_PLATE = 'ደቡ 3-04512';

/** The day the national plates began to be issued (Directive 1050/2025; a stated assumption for the demo). */
const NATIONAL_PLATES_FROM = '2025-08-01';

/** A small seeded generator (mulberry32): the same vehicles on every reset. */
function generator(seed: number) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        int: (below: number) => Math.floor(next() * below),
        chance: (p: number) => next() < p,
        of: <T>(items: readonly T[]): T => {
            const item = items[Math.floor(next() * items.length)];
            if (item === undefined) throw new Error('nothing to choose from');
            return item;
        }
    };
}
type Random = ReturnType<typeof generator>;

interface Kind {
    category: string;
    make: string;
    model: string;
    wmi: string;
    use: VehicleRegister['use'];
    seats?: number;
    loadCapacityKg?: number;
    axles?: number;
    fuel: NonNullable<VehicleRegister['fuel']>;
}

/** What the offices register most: minibuses and three-wheelers for public transport, pickups and trucks for freight. */
const KINDS: readonly Kind[] = [
    {
        category: 'three_wheeler',
        make: 'Bajaj',
        model: 'RE',
        wmi: 'MD2',
        use: 'public_transport',
        seats: 3,
        fuel: 'petrol'
    },
    {
        category: 'three_wheeler',
        make: 'TVS',
        model: 'King',
        wmi: 'MD6',
        use: 'public_transport',
        seats: 3,
        fuel: 'petrol'
    },
    { category: 'motorcycle', make: 'Bajaj', model: 'Boxer', wmi: 'MD2', use: 'private', fuel: 'petrol' },
    { category: 'automobile', make: 'Toyota', model: 'Corolla', wmi: 'JTD', use: 'private', seats: 5, fuel: 'petrol' },
    { category: 'automobile', make: 'Suzuki', model: 'Dzire', wmi: 'MA3', use: 'private', seats: 5, fuel: 'petrol' },
    {
        category: 'minibus',
        make: 'Toyota',
        model: 'Hiace',
        wmi: 'JTF',
        use: 'public_transport',
        seats: 12,
        fuel: 'diesel'
    },
    {
        category: 'midibus',
        make: 'Isuzu',
        model: 'NQR',
        wmi: 'JAA',
        use: 'public_transport',
        seats: 27,
        fuel: 'diesel'
    },
    {
        category: 'pickup',
        make: 'Toyota',
        model: 'Hilux',
        wmi: 'MR0',
        use: 'commercial',
        loadCapacityKg: 1000,
        axles: 2,
        fuel: 'diesel'
    },
    {
        category: 'light_truck',
        make: 'Isuzu',
        model: 'NPR',
        wmi: 'JAA',
        use: 'commercial',
        loadCapacityKg: 4000,
        axles: 2,
        fuel: 'diesel'
    },
    {
        category: 'heavy_truck',
        make: 'Sinotruk',
        model: 'HOWO',
        wmi: 'LZZ',
        use: 'commercial',
        loadCapacityKg: 15000,
        axles: 3,
        fuel: 'diesel'
    },
    {
        category: 'pickup',
        make: 'Toyota',
        model: 'Land Cruiser',
        wmi: 'JTE',
        use: 'government',
        loadCapacityKg: 900,
        axles: 2,
        fuel: 'diesel'
    }
];

const COLOURS = ['white', 'blue', 'silver', 'red', 'yellow', 'black'];
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
// the tenth character of a VIN for its model year (2010 = A … 2030 = Y; I, O, Q, U and Z are never used)
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY';

/** A VIN of the make's WMI with the model year in it and the check digit it must have. */
function makeVin(random: Random, wmi: string, modelYear: number): string {
    const pick = (chars: string) => chars[random.int(chars.length)] ?? '0';
    const vds = Array.from({ length: 5 }, () => pick(VIN_CHARS)).join('');
    const year = YEAR_CODES[modelYear - 2010] ?? 'A';
    const serial = String(100000 + random.int(900000));
    const draft = `${wmi}${vds}0${year}${pick(VIN_CHARS)}${serial}`;
    return `${draft.slice(0, 8)}${vinCheckDigit(draft) ?? '0'}${draft.slice(9)}`;
}

/** A Gregorian day between two (inclusive), as `YYYY-MM-DD`. */
function dayBetween(random: Random, from: string, to: string): string {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    return new Date(a + random.int(Math.max(1, Math.floor((b - a) / 86_400_000) + 1)) * 86_400_000)
        .toISOString()
        .slice(0, 10);
}

const addYears = (day: string, years: number) => `${Number(day.slice(0, 4)) + years}${day.slice(4)}`;

/** The old regional use code of a use (a stated assumption: the regions' own records give the real table). */
const LEGACY_USE: Partial<Record<VehicleRegister['use'], number>> = {
    private: 1,
    commercial: 2,
    public_transport: 3,
    government: 4,
    ngo: 5
};

const OWNER_NAMES: readonly (readonly [am: string, en: string, sex: 'female' | 'male'])[] = [
    ['ዳዊት', 'Dawit', 'male'],
    ['ሔኖክ', 'Henok', 'male'],
    ['ብርሃኑ', 'Birhanu', 'male'],
    ['ሰላማዊት', 'Selamawit', 'female'],
    ['ፍሬሕይወት', 'Frehiwot', 'female'],
    ['ታምራት', 'Tamrat', 'male'],
    ['ኤልሳ', 'Elsa', 'female'],
    ['ሙሉጌታ', 'Mulugeta', 'male']
];
const OWNER_FATHERS: readonly (readonly [am: string, en: string])[] = [
    ['ሽፈራው', 'Shiferaw'],
    ['ተስፋዬ', 'Tesfaye'],
    ['ገብረመድኅን', 'Gebremedhin'],
    ['አስፋው', 'Asfaw']
];

export async function importVehicleDemo(
    db: Database,
    code: string,
    deps: VehicleDemoDeps,
    today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date())
): Promise<VehicleDemoCounts | null> {
    const plan = DEMO_VEHICLE_REGIONS[code];
    if (!plan) throw new Error(`no demo vehicles are planned for region ${code}`);
    const random = generator(1050);
    const base = { requestId: 'seed:demo-vehicles' };
    const { root, offices } = await db.scoped(base, async (tx) => {
        const [found] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
        if (!found) throw new Error(`no region ${code}`);
        const units = await tx
            .select()
            .from(orgUnits)
            .where(and(eq(orgUnits.regionId, found.regionId), inArray(orgUnits.code, [...plan.offices])));
        return {
            root: found,
            offices: plan.offices.map((wanted) => {
                const unit = units.find((u) => u.code === wanted);
                if (!unit) throw new Error(`no unit ${wanted}`);
                return unit;
            })
        };
    });
    const asUnit = (unit: { id: string; path: string }): DbContext => ({
        ...base,
        regionId: root.regionId,
        unitId: unit.id,
        scopePath: unit.path
    });
    const first = offices[0];
    if (!first) throw new Error(`region ${code} has no demo office`);

    return db.scoped(asUnit(root), async (tx) => {
        // the story vehicle's VIN is the generator's first: when it is there, so is the rest
        const storyVin = makeVin(generator(7), 'JTF', 2016);
        const [already] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.vinKey, storyVin));
        if (already) return null;

        const owners = await demoOwners(tx, random, deps, offices, asUnit, root.regionId);
        const counts: VehicleDemoCounts = {
            vehicles: 0,
            exchanged: 0,
            legacyOnly: 0,
            transferred: 0,
            persons: owners.created.persons,
            organisations: owners.created.organisations
        };
        const holders = owners.holders;
        let plateNumber = 1001;
        let libreNumber = 1;
        const nationalPlate = () => {
            const letters = Array.from({ length: 3 }, () => PLATE_LETTERS[random.int(PLATE_LETTERS.length)]).join('');
            plateNumber += 1 + random.int(40);
            return `ETH ${letters} ${String(plateNumber % 10000).padStart(4, '0')}`;
        };

        for (let n = 0; n < plan.vehicles; n += 1) {
            const story = n === 0 && plan.legacy !== undefined;
            const unit = story ? first : (offices[n % offices.length] ?? first);
            const ctx = asUnit(unit);
            const kind = story ? (KINDS.find((k) => k.category === 'minibus') ?? KINDS[0]) : random.of(KINDS);
            if (!kind) throw new Error('no vehicle kinds');
            // the first region's vehicles go back years; the second region's were registered since the national plates began
            const firstRegisteredOn = story
                ? '2016-03-14'
                : plan.legacy
                  ? dayBetween(random, '2012-01-01', today)
                  : dayBetween(random, NATIONAL_PLATES_FROM, today);
            const modelYear = Math.max(2010, Number(firstRegisteredOn.slice(0, 4)) - random.int(3));
            const firstOwner = story
                ? holders.persons[0]
                : random.of(random.chance(0.8) ? holders.persons : holders.organisations);
            if (!firstOwner) throw new Error('no demo owners');
            const vehicle = await deps.registry.register(tx, ctx, {
                chassisNumber: story ? storyVin : makeVin(random, kind.wmi, modelYear),
                make: kind.make,
                model: kind.model,
                modelYear,
                categoryKey: kind.category,
                use: kind.use,
                seats: kind.seats,
                loadCapacityKg: kind.loadCapacityKg,
                axles: kind.axles,
                colour: random.of(COLOURS),
                fuel: kind.fuel,
                firstRegisteredOn,
                owners: [firstOwner]
            });
            counts.vehicles += 1;

            // the plates: an old regional one exchanged for a national one, an old one not yet exchanged, or national from the start
            const legacy = plan.legacy !== undefined && firstRegisteredOn < NATIONAL_PLATES_FROM;
            if (legacy) {
                const use = LEGACY_USE[kind.use] ?? 1;
                const oldPlate = story
                    ? STORY_OLD_PLATE
                    : `${plan.legacy} ${use}-${String(10000 + random.int(90000)).padStart(5, '0')}`;
                await deps.registry.recordPlate(tx, ctx, vehicle.id, {
                    text: oldPlate,
                    source: 'legacy',
                    since: firstRegisteredOn
                });
                if (story || random.chance(0.7)) {
                    await deps.registry.recordPlate(tx, ctx, vehicle.id, {
                        text: story ? STORY_PLATE : nationalPlate(),
                        source: 'federal',
                        since: story ? '2025-09-15' : dayBetween(random, NATIONAL_PLATES_FROM, today),
                        endedReason: 'exchanged'
                    });
                    counts.exchanged += 1;
                } else counts.legacyOnly += 1;
            } else
                await deps.registry.recordPlate(tx, ctx, vehicle.id, {
                    text: nationalPlate(),
                    source: 'federal',
                    since: firstRegisteredOn
                });

            // a share changed owners: sold once, at least a year after it was first registered
            let since = firstRegisteredOn;
            const sellable = addYears(firstRegisteredOn, 1) < today;
            if (story || (sellable && random.chance(0.3))) {
                since = story ? '2022-06-20' : dayBetween(random, addYears(firstRegisteredOn, 1), today);
                const buyer = story
                    ? holders.organisations[0]
                    : random.of([...holders.persons, ...holders.organisations].filter((h) => h.id !== firstOwner.id));
                if (!buyer) throw new Error('no demo buyer');
                const [current] = await tx
                    .select({ version: vehicles.rowVersion })
                    .from(vehicles)
                    .where(eq(vehicles.id, vehicle.id));
                await deps.registry.transferOwnership(tx, ctx, vehicle.id, current?.version ?? vehicle.rowVersion, {
                    since,
                    owners: [buyer],
                    acquiredBy: 'sale'
                });
                counts.transferred += 1;
            }
            // the libre of the current owners
            await deps.registry.recordLibre(tx, ctx, vehicle.id, {
                number: `${code}-${String(libreNumber).padStart(6, '0')}`,
                issuedOn: since
            });
            libreNumber += 1;
        }
        return counts;
    });
}

type Holder = { kind: 'person' | 'organisation'; id: string };

/**
 * The owners: the region's demo people when it has them (the first region's, task 0.25a), else a few generated here; and two
 * organisations, a public transport association and a freight enterprise.
 */
async function demoOwners(
    tx: Tx,
    random: Random,
    deps: VehicleDemoDeps,
    offices: readonly { id: string; path: string }[],
    asUnit: (unit: { id: string; path: string }) => DbContext,
    regionId: string
): Promise<{
    holders: { persons: Holder[]; organisations: Holder[] };
    created: { persons: number; organisations: number };
}> {
    const first = offices[0];
    if (!first) throw new Error('no demo office');
    const existing = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.regionId, regionId), eq(persons.status, 'active')))
        .orderBy(persons.id)
        .limit(24);
    const people: Holder[] = existing.map((p) => ({ kind: 'person', id: p.id }));
    let createdPersons = 0;
    if (people.length < 8)
        for (const [i, given] of OWNER_NAMES.entries()) {
            const father = OWNER_FATHERS[i % OWNER_FATHERS.length] ?? OWNER_FATHERS[0];
            const grandfather = OWNER_FATHERS[(i + 1) % OWNER_FATHERS.length] ?? OWNER_FATHERS[0];
            if (!father || !grandfather) break;
            const unit = offices[i % offices.length] ?? first;
            const made = await deps.persons.create(tx, asUnit(unit), {
                nameAm: { given: given[0], father: father[0], grandfather: grandfather[0] },
                nameEn: { given: given[1], father: father[1], grandfather: grandfather[1] },
                sex: given[2],
                birthYear: 1970 + random.int(30),
                address: { unitId: unit.id },
                acknowledgedDuplicates: []
            });
            people.push({ kind: 'person', id: made.id });
            createdPersons += 1;
        }
    const organisations: Holder[] = [];
    for (const [kind, name] of [
        ['association', { am: 'ናሙና የሕዝብ ትራንስፖርት ማህበር', en: 'Sample Public Transport Association' }],
        ['other', { am: 'ናሙና የጭነት ትራንስፖርት ድርጅት', en: 'Sample Freight Transport Enterprise' }]
    ] as const)
        organisations.push({
            kind: 'organisation',
            id: (await deps.organisations.create(tx, asUnit(first), { kind, name })).id
        });
    return { holders: { persons: people, organisations }, created: { persons: createdPersons, organisations: 2 } };
}
