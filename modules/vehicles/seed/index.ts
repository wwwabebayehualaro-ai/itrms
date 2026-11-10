/**
 * Seed entry of @itrms/vehicles (task 1.1a): the catalogue of vehicle categories at a region's root. Run again, it changes
 * only what the table here changed. The demo's vehicles (task 1.1b) are `importVehicleDemo`.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { insertAudited, updateAudited } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';

import { LIBRE_COUNTER, LIBRE_PATTERN } from '../contracts';
import { vehicleCategories } from '../api/vehicles.table';
import { VEHICLE_CATEGORIES, type CategorySeed } from './categories';

export { VEHICLE_CATEGORIES, type CategorySeed } from './categories';
export {
    DEMO_VEHICLE_REGIONS,
    importVehicleDemo,
    STORY_PLATE,
    type VehicleDemoCounts,
    type VehicleDemoDeps
} from './demo';
export { DEMO_PLATE_STOCK, importPlateStockDemo, type PlateStockDemoCounts } from './plate-stock';

/** The catalogue at the region's root; an installation step, audited. */
export async function importVehicleCategories(
    tx: Tx,
    root: { id: string; regionId: string },
    categories: readonly CategorySeed[] = VEHICLE_CATEGORIES
): Promise<number> {
    let changed = 0;
    for (const category of categories) {
        const [existing] = await tx
            .select()
            .from(vehicleCategories)
            .where(and(eq(vehicleCategories.regionId, root.regionId), eq(vehicleCategories.key, category.key)));
        if (!existing) {
            await insertAudited(tx, vehicleCategories, { ...category, regionId: root.regionId, ownerUnitId: root.id });
            changed += 1;
        } else if (
            JSON.stringify([existing.name, existing.family, existing.needsSeats, existing.needsLoad]) !==
            JSON.stringify([category.name, category.family, category.needsSeats, category.needsLoad])
        ) {
            await updateAudited(tx, vehicleCategories, existing.id, existing.rowVersion, {
                name: category.name,
                family: category.family,
                needsSeats: category.needsSeats,
                needsLoad: category.needsLoad
            });
            changed += 1;
        }
    }
    return changed;
}

/** A libre counter for each office whose type offers new vehicle registration (DVC-01). It never lowers one. */
export async function setUpLibreCounters(tx: Tx, regionId: string, pattern = LIBRE_PATTERN): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = 'DVC-01'`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: LIBRE_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}
