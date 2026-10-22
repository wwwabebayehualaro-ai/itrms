/**
 * A region's settings (task 0.13; the inheritance down the tree is task 0.21): a value replaces a manifest's default for
 * the whole region, for the keys whose manifest allows it (`overridableAt: ['region']`) and that have a schema here. A
 * value is always checked against its schema, so a setting can never hold what the code does not expect.
 */
import { and, eq } from 'drizzle-orm';
import type { ModuleManifest } from '@itrms/module-sdk';
import { INSTALLABLE_LANGUAGES } from '@itrms/schemas';
import { z } from 'zod';

import { insertAudited, updateAudited } from '../db/audit';
import type { Tx } from '../db/types';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { settingsValues } from './settings.table';

export const SETTING_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
    'i18n.languages': z
        .array(z.enum(INSTALLABLE_LANGUAGES))
        .min(2)
        .max(INSTALLABLE_LANGUAGES.length)
        .refine((l) => new Set(l).size === l.length, 'a language is listed twice')
        .refine((l) => l.includes('am') && l.includes('en'), 'Amharic and English are always on')
};

/** The settings a region may set: declared by an installed manifest as overridable at the region, with a schema. */
export function regionSettingKeys(manifests: readonly ModuleManifest[]): Map<string, unknown> {
    const keys = new Map<string, unknown>();
    for (const m of manifests)
        for (const s of m.settings)
            if (s.overridableAt.includes('region') && SETTING_SCHEMAS[s.key]) keys.set(s.key, s.default);
    return keys;
}

export async function regionSettings(tx: Tx, regionId: string): Promise<Record<string, unknown>> {
    const rows = await tx
        .select({ key: settingsValues.key, value: settingsValues.value })
        .from(settingsValues)
        .where(eq(settingsValues.regionId, regionId));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export interface RegionSetting {
    key: string;
    value: unknown;
    /** the row version a change names in If-Match: 0 while the region has kept the default */
    version: number;
}

/** A region's value of one setting, with its version (the default and version 0 while it has none of its own). */
export async function regionSetting(
    tx: Tx,
    manifests: readonly ModuleManifest[],
    regionId: string,
    key: string
): Promise<RegionSetting> {
    const keys = regionSettingKeys(manifests);
    if (!SETTING_SCHEMAS[key] || !keys.has(key)) throw new NotFoundError();
    const [current] = await tx
        .select()
        .from(settingsValues)
        .where(and(eq(settingsValues.regionId, regionId), eq(settingsValues.key, key)));
    return current
        ? { key, value: current.value, version: current.rowVersion }
        : { key, value: keys.get(key), version: 0 };
}

const isUniqueViolation = (error: unknown) => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
        if ((e as { code?: string }).code === '23505') return true;
    return false;
};

/**
 * Sets a region's value, based on the version the caller read (`expectedVersion`, 0 for the default): another
 * administrator's change since then is refused with 409 `stale_version`, never overwritten.
 */
export async function setRegionSetting(
    tx: Tx,
    manifests: readonly ModuleManifest[],
    regionId: string,
    key: string,
    value: unknown,
    expectedVersion: number
): Promise<RegionSetting> {
    const schema = SETTING_SCHEMAS[key];
    if (!schema || !regionSettingKeys(manifests).has(key)) throw new NotFoundError();
    const parsed = schema.safeParse(value);
    if (!parsed.success)
        throw new ValidationError('validation_failed', {
            errors: parsed.error.issues.map((i) => ({
                path: ['value', ...i.path].join('.'),
                code: i.code,
                message: i.message
            }))
        });
    const [current] = await tx
        .select()
        .from(settingsValues)
        .where(and(eq(settingsValues.regionId, regionId), eq(settingsValues.key, key)));
    const stale = () =>
        new ConflictError('stale_version', {
            detail: `Version ${expectedVersion} was changed; read the setting again.`
        });
    if (current) {
        const saved = await updateAudited(tx, settingsValues, current.id, expectedVersion, { value: parsed.data });
        return { key: saved.key, value: saved.value, version: saved.rowVersion };
    }
    if (expectedVersion !== 0) throw stale();
    try {
        const saved = await insertAudited(tx, settingsValues, { regionId, key, value: parsed.data });
        return { key: saved.key, value: saved.value, version: saved.rowVersion };
    } catch (error) {
        // another administrator set it first, in a transaction that committed meanwhile
        if (isUniqueViolation(error)) throw stale();
        throw error;
    }
}
