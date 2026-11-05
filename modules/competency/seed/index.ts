/**
 * Seed entry of @itrms/competency (task 0.24a): the catalogue of licence grades from Art. 12 of Proclamation 1074/2018
 * (ethiopia-context.md §3.1: the schedule itself was not in the published text, so check these against the Negarit Gazette), and the
 * licence counter of each office that handles licences. Run again, both stay as they are unless the table here changed.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { insertAudited, updateAudited } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import type { I18nText } from '@itrms/schemas';

import { LICENCE_COUNTER, LICENCE_PATTERN, type GRADE_FAMILIES } from '../contracts';
import { licenceGradeTypes } from '../api/competency.table';

export interface GradeSeed {
    key: string;
    name: I18nText;
    family: (typeof GRADE_FAMILIES)[number];
    minAge: number | null;
    minEducation: number;
    prerequisites: string[];
    prerequisiteMonths: number;
}

export const LICENCE_GRADES: readonly GradeSeed[] = [
    {
        key: 'motorcycle',
        name: { am: 'ሞተር ሳይክል', en: 'Motorcycle' },
        family: 'motorcycle',
        minAge: 18,
        minEducation: 4,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'automobile',
        name: { am: 'አውቶሞቢል', en: 'Automobile' },
        family: 'automobile',
        minAge: 18,
        minEducation: 4,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'three-wheel',
        name: { am: 'ባለ ሶስት እግር ሞተር ሳይክል', en: 'Three-wheel motorcycle' },
        family: 'motorcycle',
        minAge: 20,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'truck-1',
        name: { am: 'ደረቅ ጭነት 1', en: 'Truck I' },
        family: 'truck',
        minAge: 22,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'public-1',
        name: { am: 'ህዝብ ማመላለሻ 1', en: 'Public transport I' },
        family: 'public',
        minAge: 22,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'truck-2',
        name: { am: 'ደረቅ ጭነት 2', en: 'Truck II' },
        family: 'truck',
        minAge: 24,
        minEducation: 10,
        prerequisites: ['truck-1'],
        prerequisiteMonths: 12
    },
    {
        key: 'public-2',
        name: { am: 'ህዝብ ማመላለሻ 2', en: 'Public transport II' },
        family: 'public',
        minAge: 24,
        minEducation: 10,
        prerequisites: ['public-1'],
        prerequisiteMonths: 12
    },
    {
        key: 'tanker-1',
        name: { am: 'ፈሳሽ ጭነት 1', en: 'Tanker I' },
        family: 'tanker',
        minAge: 24,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'truck-3',
        name: { am: 'ደረቅ ጭነት 3', en: 'Truck III' },
        family: 'truck',
        minAge: 26,
        minEducation: 10,
        prerequisites: ['truck-2'],
        prerequisiteMonths: 12
    },
    {
        key: 'public-3',
        name: { am: 'ህዝብ ማመላለሻ 3', en: 'Public transport III' },
        family: 'public',
        minAge: 26,
        minEducation: 10,
        prerequisites: ['public-2'],
        prerequisiteMonths: 12
    },
    {
        key: 'tanker-2',
        name: { am: 'ፈሳሽ ጭነት 2', en: 'Tanker II' },
        family: 'tanker',
        minAge: 26,
        minEducation: 10,
        prerequisites: ['tanker-1'],
        prerequisiteMonths: 12
    },
    {
        key: 'machinery',
        name: { am: 'ማሽነሪ ኦፕሬተር', en: 'Machinery operator' },
        family: 'machinery',
        minAge: 20,
        minEducation: 10,
        prerequisites: [],
        prerequisiteMonths: 0
    },
    {
        key: 'taxi',
        name: { am: 'ታክሲ', en: 'Taxi driving' },
        family: 'taxi',
        minAge: null,
        minEducation: 10,
        prerequisites: ['automobile', 'public-1', 'public-2', 'public-3'],
        prerequisiteMonths: 0
    }
];

/** The catalogue at the region's root; an installation step, audited. */
export async function importLicenceGrades(
    tx: Tx,
    root: { id: string; regionId: string },
    grades: readonly GradeSeed[] = LICENCE_GRADES
): Promise<number> {
    let changed = 0;
    for (const grade of grades) {
        const [existing] = await tx
            .select()
            .from(licenceGradeTypes)
            .where(and(eq(licenceGradeTypes.regionId, root.regionId), eq(licenceGradeTypes.key, grade.key)));
        if (!existing) {
            await insertAudited(tx, licenceGradeTypes, { ...grade, regionId: root.regionId, ownerUnitId: root.id });
            changed += 1;
        } else if (
            JSON.stringify([
                existing.name,
                existing.family,
                existing.minAge,
                existing.minEducation,
                existing.prerequisites,
                existing.prerequisiteMonths
            ]) !==
            JSON.stringify([
                grade.name,
                grade.family,
                grade.minAge,
                grade.minEducation,
                grade.prerequisites,
                grade.prerequisiteMonths
            ])
        ) {
            await updateAudited(tx, licenceGradeTypes, existing.id, existing.rowVersion, {
                name: grade.name,
                family: grade.family,
                minAge: grade.minAge,
                minEducation: grade.minEducation,
                prerequisites: grade.prerequisites,
                prerequisiteMonths: grade.prerequisiteMonths
            });
            changed += 1;
        }
    }
    return changed;
}

/** A counter for each office whose type offers licences. It never lowers one. */
export async function setUpLicenceCounters(tx: Tx, regionId: string, pattern = LICENCE_PATTERN): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = 'DVC-03'`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: LICENCE_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}
