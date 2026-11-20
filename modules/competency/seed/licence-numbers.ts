/**
 * The licence counters a region numbers from (task 1.6, ADR-0051, ADR-0064 §2): an installation step, as the owner, because the
 * regional counter starts after the first number of the range the region reserves (request code only makes a counter at 0).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import { settingsValues } from '@itrms/kernel/settings';
import { orgUnits } from '@itrms/kernel/tables';

import {
    LICENCE_COUNTER,
    LICENCE_NUMBER_SETTING,
    LICENCE_NUMBERING_DEFAULT,
    LICENCE_PATTERN,
    licenceNumberingSchema,
    regionalCounterSetup,
    type LicenceNumbering
} from '../contracts';

/**
 * How the region numbers its licences (`competency.licence_number`, ADR-0051): the region's own value, else the installation's,
 * else the default. The setting is never an office's or a unit type's, so these are all the levels the resolver would read.
 */
export async function licenceNumberingOf(tx: Tx, regionId: string, installation?: unknown): Promise<LicenceNumbering> {
    const [root] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.regionId, regionId), isNull(orgUnits.parentId)));
    if (!root) throw new Error(`no region ${regionId}`);
    const [own] = await tx
        .select({ value: settingsValues.value })
        .from(settingsValues)
        .where(
            and(
                eq(settingsValues.unitId, root.id),
                isNull(settingsValues.unitTypeId),
                eq(settingsValues.key, LICENCE_NUMBER_SETTING)
            )
        );
    return licenceNumberingSchema.parse(own?.value ?? installation ?? LICENCE_NUMBERING_DEFAULT);
}

/**
 * The licence counters (task 1.6): the region's one counter on its root unit, from its code and the first number of its range,
 * when it numbers regionally (refused, or left unmade with `onUnset`, when either is missing: a region that has not agreed its range
 * must not start); and one for each office whose type offers licences, which scope `unit` numbers from (the root too, in that
 * scope). Run again it never lowers a counter, so a number once issued is never issued again; a new code or a higher first number
 * is taken up.
 */
export async function setUpLicenceCounters(
    tx: Tx,
    regionId: string,
    options: {
        installation?: unknown;
        /**
         * Given, a region without its code or first number is told here and its counter left unmade, so the rest of the region's
         * seed goes ahead; a filing is still refused (409) until the counter exists. Not given, it is refused here.
         */
        onUnset?: (problem: string) => void;
    } = {}
): Promise<number> {
    const numbering = await licenceNumberingOf(tx, regionId, options.installation);
    let regional = regionalCounterSetup(numbering);
    if (regional && 'problem' in regional) {
        if (!options.onUnset) throw new Error(regional.problem);
        options.onUnset(regional.problem);
        regional = null;
    }
    let made = 0;
    if (regional) {
        const [root] = await tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(and(eq(orgUnits.regionId, regionId), isNull(orgUnits.parentId)));
        if (!root) throw new Error(`no region ${regionId}`);
        await setUpCounter(tx, { key: LICENCE_COUNTER, unitId: root.id, regionId, ...regional });
        made += 1;
    }
    // the root's counter is the regional one when the region numbers regionally; numbered per office, a root that offers
    // licences keeps its own like any office
    const perOffice = numbering.scope !== 'region';
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = 'DVC-03'
           and (u.parent_id is not null or ${perOffice}::boolean)`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: LICENCE_COUNTER, unitId: office.id, regionId, pattern: LICENCE_PATTERN });
    return made + offices.rows.length;
}
