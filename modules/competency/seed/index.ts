/**
 * Seed entry of @itrms/competency (task 0.24a): the catalogue of licence grades from Art. 12 of Proclamation 1074/2018
 * (ethiopia-context.md §3.1: the schedule itself was not in the published text, so check these against the Negarit Gazette), and the
 * licence counter of each office that handles licences. Run again, both stay as they are unless the table here changed.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { insertAudited, updateAudited } from '@itrms/kernel/db';

import { licenceGradeTypes } from '../api/competency.table';
import { LICENCE_GRADES, type GradeSeed } from './grades';

export { LICENCE_GRADES, type GradeSeed } from './grades';
export * from './licence-services';
export * from './licence-capture-service';
export * from './licence-restriction-service';
export { licenceNumberingOf, setUpLicenceCounters } from './licence-numbers';
export * from './vehicle-services';
export * from './back-capture-service';
export * from './exchange-service';
export * from './replacement-service';
export * from './transfer-service';
export * from './vehicle-transfer-service';
export * from './vehicle-arrival-service';
export * from './bolo-service';
export { importDemoData, type DemoCounts, type DemoDeps } from './demo';

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
