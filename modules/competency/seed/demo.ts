/**
 * The demo's data (docs/demo-plan.md §4, task 0.25a): generated, never real people. A seeded generator makes the same people on every
 * reset, with birth dates and licence terms counted from today, so the demo's cases stay true whenever it is run: someone expired 14
 * months ago stays 14 months late. No Fayda number or phone number is generated: a random one could be somebody's.
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { ethiopianHolidays } from '@itrms/ethiopian-calendar';
import { insertAudited, type Database, type DbContext } from '@itrms/kernel/db';
import { nextNumber } from '@itrms/kernel/numbering';
import { orgUnits } from '@itrms/kernel/tables';
import type { OrganisationsService, PersonsService } from '@itrms/parties/api';
import { serviceDefinitions, serviceOverrides } from '@itrms/services/api';
import { holidays } from '@itrms/workflow/api';

import {
    driverLicences,
    examSessions,
    licenceGrades,
    licenceGradeTypes,
    trainingEnrolments
} from '../api/competency.table';
import {
    addisDay,
    addMonths,
    addYears,
    ageOn,
    LICENCE_COUNTER,
    RENEWAL_YEARS,
    RENEWAL_YEARS_OVER_55,
    temporaryValidUntil
} from '../contracts';

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

const MONTHS_OF_LICENCE = {
    temporary: 10,
    permanent: 20,
    over55: 6
} as const;

/** How the licences are spread: the states the journey and the reports show (demo-plan.md §4), on the terms the rules give. */
const licenceStates = (today: string) => {
    const issued = (months: number) => addMonths(today, -months);
    const expired = (months: number) => {
        const validUntil = addMonths(today, -months);
        return { kind: 'permanent' as const, issuedOn: addYears(validUntil, -RENEWAL_YEARS), validUntil };
    };
    return [
        {
            count: 16,
            term: {
                kind: 'temporary' as const,
                issuedOn: issued(MONTHS_OF_LICENCE.temporary),
                validUntil: temporaryValidUntil(issued(MONTHS_OF_LICENCE.temporary))
            }
        },
        {
            count: 18,
            term: {
                kind: 'permanent' as const,
                issuedOn: issued(MONTHS_OF_LICENCE.permanent),
                validUntil: addYears(issued(MONTHS_OF_LICENCE.permanent), RENEWAL_YEARS)
            }
        },
        // expired less than a year ago: a renewal with a late fee
        { count: 10, term: expired(4) },
        // expired more than a year ago: the practical exam
        { count: 8, term: expired(14) }
    ];
};
const OVER_55_LICENCES = 8;

const GRADES_AT_AGE = (age: number) =>
    age >= 22 ? ['automobile', 'public-1', 'truck-1'] : ['automobile', 'motorcycle'];

/** A working day on or after this one: no exam, and no office's own holiday, on a weekend or a national holiday. */
const workingDayFrom = (day: string): string => {
    let at = day;
    for (;;) {
        const date = new Date(`${at}T00:00:00Z`);
        const national = ethiopianHolidays(date.getUTCFullYear()).map((h) => h.date);
        if (![0, 6].includes(date.getUTCDay()) && !national.includes(at)) return at;
        at = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
    }
};

/**
 * The whole demo for a region, in one transaction: it is there completely or not at all, and a run that finds it does nothing. Needs the
 * org tree and the catalogue first. Done as an installation step at the region's root, so that is what its audit rows name.
 */
export async function importDemoData(
    db: Database,
    code: string,
    deps: DemoDeps,
    today = addisDay()
): Promise<DemoCounts | null> {
    const random = generator(2019);
    const base = { requestId: 'seed:demo' };
    const found = await db.scoped(base, async (tx) => {
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
    const { root, ...offices } = found;
    const regionId = root.regionId;
    const asUnit = (unit: { id: string; path: string }): DbContext => ({
        ...base,
        regionId,
        unitId: unit.id,
        scopePath: unit.path
    });

    return db.scoped(asUnit(root), async (tx) => {
        const [already] = await tx
            .select({ id: driverLicences.id })
            .from(driverLicences)
            .where(and(eq(driverLicences.regionId, regionId), like(driverLicences.nationalReference, 'DEMO-%')))
            .limit(1);
        if (already) return null;

        const zoneCtx = asUnit(offices.zone);
        const schools: string[] = [];
        for (const name of [
            { am: 'ናሙና ማሰልጠኛ ተቋም ሀ', en: 'Sample Driving School A' },
            { am: 'ናሙና ማሰልጠኛ ተቋም ለ', en: 'Sample Driving School B' },
            { am: 'ናሙና ማሰልጠኛ ተቋም ሐ', en: 'Sample Driving School C' }
        ])
            schools.push((await deps.organisations.create(tx, zoneCtx, { kind: 'training_school', name })).id);
        for (const name of [
            { am: 'ናሙና ጤና ጣቢያ አንድ', en: 'Sample Health Centre One' },
            { am: 'ናሙና ጤና ጣቢያ ሁለት', en: 'Sample Health Centre Two' }
        ])
            await deps.organisations.create(tx, zoneCtx, { kind: 'health_facility', name });

        // the people: each a different name, past the register's own duplicate check
        type Person = { id: string; birthDate: string; age: number; unit: keyof typeof offices };
        const seen = new Set<string>();
        const people: Person[] = [];
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
                const unit = offices[home];
                const made = await deps.persons.create(tx, asUnit(unit), {
                    nameAm: { given: given[0], father: father[0], grandfather: grandfather[0] },
                    nameEn: { given: given[1], father: father[1], grandfather: grandfather[1] },
                    sex,
                    birthYear: Number(birthDate.slice(0, 4)),
                    sensitive: { birthDate },
                    address: { unitId: unit.id, kebele: `ቀበሌ ${String(1 + random.int(12)).padStart(2, '0')}` },
                    acknowledgedDuplicates: []
                });
                people.push({ id: made.id, birthDate, age, unit: home });
            }

        const grades = new Map(
            (
                await tx
                    .select({ key: licenceGradeTypes.key, id: licenceGradeTypes.id })
                    .from(licenceGradeTypes)
                    .where(eq(licenceGradeTypes.regionId, regionId))
            ).map((g) => [g.key, g.id])
        );
        const taken = new Set<string>();
        const takeFrom = (fits: (person: Person) => boolean): Person => {
            const person = random.of(people.filter((p) => p.unit !== 'damot' && !taken.has(p.id) && fits(p)));
            taken.add(person.id);
            return person;
        };

        // the licences, of the offices that handle them: each holder was old enough for it on the day it was issued
        const makeLicence = async (
            fits: (person: Person) => boolean,
            term: { kind: 'temporary' | 'permanent'; issuedOn: string; validUntil: string }
        ) => {
            const holder = takeFrom((p) => fits(p) && ageOn(p.birthDate, term.issuedOn) >= 18);
            const unit = offices[holder.unit];
            const { number } = await nextNumber(tx, LICENCE_COUNTER, unit.id);
            const licence = await insertAudited(tx, driverLicences, {
                regionId,
                handlingUnitId: unit.id,
                personId: holder.id,
                status: 'active',
                number,
                nationalReference: `DEMO-${number}`,
                ...term
            });
            const gradeTypeId = grades.get(random.of(GRADES_AT_AGE(ageOn(holder.birthDate, term.issuedOn))));
            if (!gradeTypeId) throw new Error('seed the licence grades first');
            await insertAudited(tx, licenceGrades, {
                regionId,
                handlingUnitId: unit.id,
                licenceId: licence.id,
                gradeTypeId,
                permanentSince: term.kind === 'permanent' ? term.issuedOn : null
            });
        };
        let licences = 0;
        const under56 = (p: Person) => p.age < 56;
        for (const { count, term } of licenceStates(today))
            for (let i = 0; i < count; i += 1) {
                await makeLicence(under56, term);
                licences += 1;
            }
        const lately = addMonths(today, -MONTHS_OF_LICENCE.over55);
        for (let i = 0; i < OVER_55_LICENCES; i += 1) {
            await makeLicence((p) => !under56(p), {
                kind: 'permanent',
                issuedOn: lately,
                validUntil: addYears(lately, RENEWAL_YEARS_OVER_55)
            });
            licences += 1;
        }

        // the schools' lists: finished and still training, for applications not yet made
        const automobile = grades.get('automobile');
        if (!automobile) throw new Error('seed the licence grades first');
        let enrolments = 0;
        for (const done of [true, false])
            for (let i = 0; i < (done ? 12 : 8); i += 1) {
                const person = takeFrom((p) => under56(p) && p.age >= 18);
                await insertAudited(tx, trainingEnrolments, {
                    regionId,
                    handlingUnitId: offices[person.unit].id,
                    personId: person.id,
                    schoolId: random.of(schools),
                    gradeTypeId: automobile,
                    status: done ? 'completed' : 'enrolled',
                    completedOn: done ? addMonths(today, -1) : null
                });
                enrolments += 1;
            }

        // exam days of the coming month, on days the offices are open, at the two with examiners
        let sessions = 0;
        const dayOffset = (days: number) =>
            new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
        for (const unit of [offices.boditi, offices.zone])
            for (let week = 1; week <= 4; week += 1) {
                await insertAudited(tx, examSessions, {
                    regionId,
                    handlingUnitId: unit.id,
                    heldOn: workingDayFrom(dayOffset(week * 7))
                });
                sessions += 1;
            }

        // the national holidays come from the calendar; a zone's own is entered with its date of the year, on a day that is otherwise
        // a working one, so it shows in its deadlines
        const year = Number(today.slice(0, 4));
        const sampleDay = `${today > `${year}-09-27` ? year + 1 : year}-09-28`;
        await insertAudited(tx, holidays, {
            regionId,
            unitId: offices.zone.id,
            date: workingDayFrom(sampleDay),
            key: 'gifaata',
            name: { am: 'ጊፋታ (የናሙና ቀን)', en: 'Gifaata (sample date)' }
        });
        // the zone's renewals are paid at the revenue office, and verified by its finance officer (demo-plan.md §3, step 9);
        // Boditi takes its fees at its own till
        const [renewal] = await tx
            .select({ id: serviceDefinitions.id })
            .from(serviceDefinitions)
            .where(and(eq(serviceDefinitions.regionId, regionId), eq(serviceDefinitions.code, 'DVC-04')));
        if (renewal) {
            const [set] = await tx
                .select({ id: serviceOverrides.id })
                .from(serviceOverrides)
                .where(and(eq(serviceOverrides.unitId, offices.zone.id), eq(serviceOverrides.serviceId, renewal.id)));
            if (!set)
                await insertAudited(tx, serviceOverrides, {
                    regionId,
                    unitId: offices.zone.id,
                    serviceId: renewal.id,
                    values: { 'payment.collection': 'elsewhere' },
                    reason: 'Renewals at the zone are paid at the revenue office (demo)'
                });
        }
        return {
            persons: people.length,
            organisations: schools.length + 2,
            licences,
            enrolments,
            examSessions: sessions
        };
    });
}
