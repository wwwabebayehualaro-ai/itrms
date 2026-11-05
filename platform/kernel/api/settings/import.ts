/**
 * A region's settings from a data file (task 0.25b), an installation step like the org tree: what a bureau could set on its
 * settings screen, checked against the same registry. Nothing is written if a value is wrong, and a value already set stays,
 * so a seed can run again without undoing a bureau's own change.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { insertAudited } from '../db/audit';
import type { Tx } from '../db/types';
import { allowedAt, type SettingsRegistry } from './registry';
import { settingsValues } from './settings.table';

export const regionSettingsSchema = z.strictObject({
    region: z.string().min(1),
    settings: z.record(z.string(), z.unknown())
});
export type RegionSettings = z.infer<typeof regionSettingsSchema>;

/** What is wrong with these values for a region: a setting no slice declares, one a region may not set, a value it refuses. */
export function regionSettingProblems(settings: Record<string, unknown>, registry: SettingsRegistry): string[] {
    return Object.entries(settings).flatMap(([key, value]) => {
        const entry = registry.get(key);
        if (!entry) return [`${key}: no such setting`];
        if (!allowedAt(entry, 'region')) return [`${key}: a region cannot set it`];
        const checked = entry.schema.safeParse(value);
        return checked.success ? [] : [`${key}: ${checked.error.issues.map((i) => i.message).join('; ')}`];
    });
}

/** Sets the values on the region's root unit. Returns how many it set. */
export async function importRegionSettings(
    tx: Tx,
    root: { id: string; regionId: string },
    settings: Record<string, unknown>,
    registry: SettingsRegistry
): Promise<number> {
    const problems = regionSettingProblems(settings, registry);
    if (problems.length > 0) throw new Error(`the region's settings: ${problems.join(', ')}`);
    let made = 0;
    for (const [key, value] of Object.entries(settings)) {
        const [set] = await tx
            .select({ id: settingsValues.id })
            .from(settingsValues)
            .where(
                and(eq(settingsValues.unitId, root.id), eq(settingsValues.key, key), isNull(settingsValues.unitTypeId))
            );
        if (set) continue;
        await insertAudited(tx, settingsValues, {
            regionId: root.regionId,
            unitId: root.id,
            unitTypeId: null,
            key,
            value
        });
        made += 1;
    }
    return made;
}
