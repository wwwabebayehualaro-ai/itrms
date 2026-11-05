/**
 * The demo's data (docs/demo-plan.md §4, task 0.25a): generated, never real people. A seeded generator makes the same people on every
 * reset, with birth dates and licence terms counted from today, so the demo's cases stay true whenever it is run: someone expired 14
 * months ago stays 14 months late. No Fayda number or phone number is generated: a random one could be somebody's.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { insertAudited, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { nextNumber } from '@itrms/kernel/numbering';
import { orgUnits } from '@itrms/kernel/tables';
import { settingsValues } from '@itrms/kernel/settings';
import { organisations, type OrganisationsService, type PersonsService } from '@itrms/parties/api';
import { holidays } from '@itrms/workflow/api';

import {
    driverLicences,
    examSessions,
    licenceGrades,
    licenceGradeTypes,
    trainingEnrolments
} from '../api/competency.table';
import { addisDay, addMonths, addYears, LICENCE_COUNTER } from '../contracts';

export interface DemoDeps {
    persons: Pick<PersonsService, 'create'>;
    organisations: Pick<OrganisationsService, 'create'>;
}

export interface DemoCounts {
    persons: number;
    organisations: number;
    licences: number;
    enrolments: number;
    examSessions: number;
}

/** A small seeded generator (mulberry32): the same demo on every reset. */
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
        of: <T>(items: readonly T[]): T => {
            const item = items[Math.floor(next() * items.length)];
            if (item === undefined) throw new Error('nothing to choose from');
            return item;
        }
    };
}

type Name = readonly [am: string, en: string];

const WOMEN: readonly Name[] = [
    ['ማርታ', 'Marta'],
    ['ሰላም', 'Selam'],
    ['ትዕግስት', 'Tigist'],
    ['መሰረት', 'Meseret'],
    ['አልማዝ', 'Almaz'],
    ['ሄራን', 'Heran'],
    ['ብርቱካን', 'Birtukan'],
    ['ገነት', 'Genet'],
    ['ታደለች', 'Tadelech'],
    ['ዘነበች', 'Zenebech'],
    ['አበበች', 'Abebech'],
    ['ወይንሸት', 'Woynshet']
];
const MEN: readonly Name[] = [
    ['ዳዊት', 'Dawit'],
    ['ሳሙኤል', 'Samuel'],
    ['ማቴዎስ', 'Matewos'],
    ['ኤርሚያስ', 'Ermias'],
    ['ታምራት', 'Tamrat'],
    ['ዳንኤል', 'Daniel'],
    ['ዮሐንስ', 'Yohannes'],
    ['ተስፋዬ', 'Tesfaye'],
    ['አበራ', 'Abera'],
    ['ወርቁ', 'Worku'],
    ['ዳና', 'Dana'],
    ['ሽብሩ', 'Shibru']
];
const FATHERS: readonly Name[] = [
    ['አየለ', 'Ayele'],
    ['ከበደ', 'Kebede'],
    ['ዳጋ', 'Daga'],
    ['ገበየሁ', 'Gebeyehu'],
    ['ላሊሶ', 'Laliso'],
    ['ኤሊያስ', 'Elias'],
    ['ቶማስ', 'Tomas'],
    ['ሙሉጌታ', 'Mulugeta'],
    ['ባልቻ', 'Balcha'],
    ['ዳመና', 'Damena'],
    ['ማዳ', 'Mada'],
    ['ጋጋ', 'Gaga'],
    ['ወልደ', 'Wolde'],
    ['ሀይሌ', 'Haile'],
    ['ገታሁን', 'Getahun'],
    ['ታደሰ', 'Tadesse']
];

/** Who the demo has, by age: Art. 12's bands, some too young to apply, and holders over 55. */
const AGE_BANDS: readonly (readonly [share: number, from: number, to: number])[] = [
    [8, 15, 17],
    [50, 18, 21],
    [50, 22, 25],
    [62, 26, 54],
    [30, 56, 72]
];

/** How the licences are spread: the states the journey and the reports show (demo-plan.md §4). */
const LICENCE_STATES = [
    { count: 16, kind: 'temporary', from: 'issued', issuedMonthsAgo: 10, validForMonths: 14 },
    { count: 18, kind: 'permanent', from: 'issued', issuedMonthsAgo: 20, validForMonths: 28 },
    // expired less than a year ago: a renewal with a late fee
    { count: 10, kind: 'permanent', from: 'expired', expiredMonthsAgo: 4 },
    // expired more than a year ago: the practical exam
    { count: 8, kind: 'permanent', from: 'expired', expiredMonthsAgo: 14 }
] as const;
const OVER_55_LICENCES = 8;

const GRADE_BY_AGE = (age: number) =>
    age >= 22 ? ['automobile', 'public-1', 'truck-1'] : ['automobile', 'motorcycle'];

/** The whole demo for a region, once: a second run finds its schools and does nothing. Needs the org tree and the catalogue first. */
export async function importDemoData(
    db: Database,
    code: string,
    deps: DemoDeps,
    today = addisDay()
): Promise<DemoCounts | null> {
    const random = generator(2019);
    const base = { requestId: 'seed:demo' };
    const units = await db.scoped(base, async (tx) => {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
        if (!root) throw new Error(`no region ${code}`);
        const offices = await tx
            .select()
            .from(orgUnits)
            .where(
                and(
                    eq(orgUnits.regionId, root.regionId),
                    inArray(orgUnits.code, ['WOL', 'WOL-BODITI', 'WOL-DAMOT-GALE'])
                )
            );
        const named = (wanted: string) => {
            const unit = offices.find((u) => u.code === wanted);
            if (!unit) throw new Error(`no unit ${wanted}`);
            return unit;
        };
        return { root, zone: named('WOL'), boditi: named('WOL-BODITI'), damot: named('WOL-DAMOT-GALE') };
    });
    const regionId = units.root.regionId;
    const asUnit = (unit: { id: string; path: string }): DbContext => ({
        ...base,
        regionId,
        unitId: unit.id,
        scopePath: unit.path
    });

    const SCHOOLS = [
        { am: 'ናሙና ማሰልጠኛ ተቋም ሀ', en: 'Sample Driving School A' },
        { am: 'ናሙና ማሰልጠኛ ተቋም ለ', en: 'Sample Driving School B' },
        { am: 'ናሙና ማሰልጠኛ ተቋም ሐ', en: 'Sample Driving School C' }
    ];
    const already = await db.scoped(base, (tx) =>
        tx
            .select({ id: organisations.id })
            .from(organisations)
            .where(and(eq(organisations.regionId, regionId), eq(organisations.kind, 'training_school')))
            .limit(1)
    );
    if (already.length > 0) return null;

    // the organisations, and the neutral branding (real names, logos and stamps appear only with permission)
    const zoneCtx = asUnit(units.zone);
    const schools = await db.scoped(zoneCtx, async (tx) => {
        const made: string[] = [];
        for (const name of SCHOOLS)
            made.push((await deps.organisations.create(tx, zoneCtx, { kind: 'training_school', name })).id);
        for (const name of [
            { am: 'ናሙና ጤና ጣቢያ አንድ', en: 'Sample Health Centre One' },
            { am: 'ናሙና ጤና ጣቢያ ሁለት', en: 'Sample Health Centre Two' }
        ])
            await deps.organisations.create(tx, zoneCtx, { kind: 'health_facility', name });
        return made;
    });
    await db.scoped(asUnit(units.root), (tx) =>
        insertAudited(tx, settingsValues, {
            regionId,
            unitId: units.root.id,
            unitTypeId: null,
            key: 'documents.header',
            value: { title: { am: 'ናሙና የክልል ትራንስፖርት ቢሮ', en: 'Sample Regional Transport Bureau' } }
        })
    );

    // the people: each a different name, kept apart from one another by the register's own duplicate check
    const seen = new Set<string>();
    const people: { id: string; age: number; unit: 'boditi' | 'zone' | 'damot' }[] = [];
    for (const [share, from, to] of AGE_BANDS)
        for (let i = 0; i < share; i += 1) {
            const sex = random.int(2) === 0 ? ('female' as const) : ('male' as const);
            const given = random.of(sex === 'female' ? WOMEN : MEN);
            const father = random.of(FATHERS);
            const grandfather = random.of(FATHERS);
            const key = `${given[1]}/${father[1]}/${grandfather[1]}`;
            if (seen.has(key) || father === grandfather) {
                i -= 1;
                continue;
            }
            seen.add(key);
            const age = from + random.int(to - from + 1);
            const birthDate = addMonths(addYears(today, -age), -(1 + random.int(10)));
            const place = random.int(10);
            const home = place < 6 ? 'boditi' : place < 8 ? 'zone' : 'damot';
            const unit = units[home];
            const ctx = asUnit(unit);
            const made = await db.scoped(ctx, (tx) =>
                deps.persons.create(tx, ctx, {
                    nameAm: { given: given[0], father: father[0], grandfather: grandfather[0] },
                    nameEn: { given: given[1], father: father[1], grandfather: grandfather[1] },
                    sex,
                    birthYear: Number(birthDate.slice(0, 4)),
                    sensitive: { birthDate },
                    address: { unitId: unit.id, kebele: `ቀበሌ ${String(1 + random.int(12)).padStart(2, '0')}` },
                    acknowledgedDuplicates: []
                })
            );
            people.push({ id: made.id, age, unit: home });
        }

    // the licences: of the offices that handle them, in the states the journey needs
    const licensable = people.filter((p) => p.unit !== 'damot' && p.age >= 18);
    const over55 = licensable.filter((p) => p.age >= 56);
    const younger = licensable.filter((p) => p.age < 56);
    const taken = new Set<string>();
    const takeFrom = (pool: typeof people) => {
        const free = pool.filter((p) => !taken.has(p.id));
        const person = random.of(free);
        taken.add(person.id);
        return person;
    };
    const makeLicence = async (
        tx: Tx,
        person: (typeof people)[number],
        grades: Map<string, string>,
        kind: 'temporary' | 'permanent',
        issuedOn: string,
        validUntil: string
    ) => {
        const unit = units[person.unit];
        const { number } = await nextNumber(tx, LICENCE_COUNTER, unit.id);
        const licence = await insertAudited(tx, driverLicences, {
            regionId,
            handlingUnitId: unit.id,
            personId: person.id,
            status: 'active',
            kind,
            number,
            issuedOn,
            validUntil,
            nationalReference: `DEMO-${number}`
        });
        const gradeTypeId = grades.get(random.of(GRADE_BY_AGE(person.age)));
        if (!gradeTypeId) throw new Error('seed the licence grades first');
        await insertAudited(tx, licenceGrades, {
            regionId,
            handlingUnitId: unit.id,
            licenceId: licence.id,
            gradeTypeId,
            permanentSince: kind === 'permanent' ? issuedOn : null
        });
    };
    const counts = await db.scoped(asUnit(units.zone), async (tx) => {
        const grades = new Map(
            (
                await tx
                    .select({ key: licenceGradeTypes.key, id: licenceGradeTypes.id })
                    .from(licenceGradeTypes)
                    .where(eq(licenceGradeTypes.regionId, regionId))
            ).map((g) => [g.key, g.id])
        );
        let licences = 0;
        for (const state of LICENCE_STATES)
            for (let i = 0; i < state.count; i += 1) {
                const person = takeFrom(younger);
                const validUntil =
                    state.from === 'expired'
                        ? addMonths(today, -state.expiredMonthsAgo)
                        : addMonths(addMonths(today, -state.issuedMonthsAgo), state.validForMonths);
                const issuedOn =
                    state.from === 'expired' ? addYears(validUntil, -4) : addMonths(today, -state.issuedMonthsAgo);
                await makeLicence(tx, person, grades, state.kind, issuedOn, validUntil);
                licences += 1;
            }
        for (let i = 0; i < OVER_55_LICENCES; i += 1) {
            const issuedOn = addMonths(today, -6);
            await makeLicence(tx, takeFrom(over55), grades, 'permanent', issuedOn, addYears(issuedOn, 2));
            licences += 1;
        }

        // the schools' lists: finished and still training, for applications not yet made
        const automobile = grades.get('automobile');
        if (!automobile) throw new Error('seed the licence grades first');
        let enrolments = 0;
        for (const done of [true, false])
            for (let i = 0; i < (done ? 12 : 8); i += 1) {
                const person = takeFrom(younger);
                await insertAudited(tx, trainingEnrolments, {
                    regionId,
                    handlingUnitId: units[person.unit].id,
                    personId: person.id,
                    schoolId: random.of(schools),
                    gradeTypeId: automobile,
                    status: done ? 'completed' : 'enrolled',
                    completedOn: done ? addMonths(today, -1) : null
                });
                enrolments += 1;
            }

        // exam days of the coming month, at the two offices with examiners
        let sessions = 0;
        for (const unit of [units.boditi, units.zone])
            for (let week = 1; week <= 4; week += 1) {
                const heldOn = new Date(Date.parse(`${today}T00:00:00Z`) + week * 7 * 86_400_000)
                    .toISOString()
                    .slice(0, 10);
                await insertAudited(tx, examSessions, { regionId, handlingUnitId: unit.id, heldOn });
                sessions += 1;
            }

        // the national holidays come from the calendar; a zone's own is entered with its date of the year
        const year = Number(today.slice(0, 4));
        const gifaata = `${today > `${year}-09-27` ? year + 1 : year}-09-27`;
        await insertAudited(tx, holidays, {
            regionId,
            unitId: units.zone.id,
            date: gifaata,
            key: 'gifaata',
            name: { am: 'ጊፋታ (የናሙና ቀን)', en: 'Gifaata (sample date)' }
        });
        return { licences, enrolments, examSessions: sessions };
    });
    return { persons: people.length, organisations: schools.length + 2, ...counts };
}
