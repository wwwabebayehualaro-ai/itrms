/**
 * Seed entry of @itrms/vehicles (task 1.1a): the catalogue of vehicle categories at a region's root. Run again, it changes
 * only what the table here changed. The demo's vehicles (task 1.1b) are `importVehicleDemo`.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { insertAudited, updateAudited } from '@itrms/kernel/db';

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
