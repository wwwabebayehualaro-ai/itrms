/**
 * A region's settings from a data file (task 0.25b), an installation step like the org tree: what a bureau could set on its
 * settings screen, checked against the same registry and stored as its schema reads it. Nothing is written if a value is
 * wrong, and a value already set stays, so a seed can run again without undoing a bureau's own change.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
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

/** The values as their schemas read them, and what is wrong: a setting no enabled slice declares, one a region may not set, a value it refuses. */
export function parseRegionSettings(
    settings: Record<string, unknown>,
    registry: SettingsRegistry
): { problems: string[]; values: [key: string, value: unknown][] } {
    const problems: string[] = [];
    const values: [string, unknown][] = [];
    for (const [key, value] of Object.entries(settings)) {
        const entry = registry.get(key);
        if (!entry) {
            problems.push(`${key}: no such setting`);
            continue;
        }
        if (!allowedAt(entry, 'region')) {
            problems.push(`${key}: a region cannot set it`);
            continue;
        }
        const checked = entry.schema.safeParse(value);
        if (checked.success) values.push([key, checked.data]);
        else problems.push(`${key}: ${checked.error.issues.map((i) => i.message).join('; ')}`);
    }
    return { problems, values };
}

export const regionSettingProblems = (settings: Record<string, unknown>, registry: SettingsRegistry): string[] =>
    parseRegionSettings(settings, registry).problems;

/** Sets the values on the region's root unit. Returns how many it set. */
export async function importRegionSettings(
    tx: Tx,
    root: { id: string; regionId: string },
    settings: Record<string, unknown>,
    registry: SettingsRegistry
): Promise<number> {
    const { problems, values } = parseRegionSettings(settings, registry);
    if (problems.length > 0) throw new Error(`the region's settings: ${problems.join(', ')}`);
    if (values.length === 0) return 0;
    // two runs at once (a start-up seed and a manual one) take turns, so the second skips what the first set
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kernel.settings:${root.id}`}))`);
    const set = await tx
        .select({ key: settingsValues.key })
        .from(settingsValues)
        .where(
            and(
                eq(settingsValues.unitId, root.id),
                isNull(settingsValues.unitTypeId),
                inArray(
                    settingsValues.key,
                    values.map(([key]) => key)
                )
            )
        );
    const already = new Set(set.map((row) => row.key));
    let made = 0;
    for (const [key, value] of values) {
        if (already.has(key)) continue;
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
