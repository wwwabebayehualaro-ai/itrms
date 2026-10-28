/**
 * The settings registry at work (ADR-0026, org-and-unit-types.md §4; task 0.21a): a unit's effective settings through
 * the one resolver (default → installation → region → the units below it → unit type → unit → person), where each value
 * comes from, and the writes of a unit's or a unit type's own value. Every value is checked against its schema; a level
 * the setting does not allow is refused (422 `setting_level_not_allowed`); a unit the person cannot see is 404, one they
 * see but may not change (above their seat) 403; a change names the version it was based on (If-Match), and a sensitive
 * setting needs a fresh second factor (SEC-SE-5). The writes are audited; RLS (class C) decides again.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { I18nText } from '@itrms/schemas';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { KernelConfig } from '../config';
import { deleteAudited, insertAudited, updateAudited } from '../db/audit';
import type { Tx } from '../db/types';
import { ConflictError, ForbiddenError, NotFoundError, StepUpRequiredError, ValidationError } from '../errors';
import { textOf, type Catalogues } from '../iam/menu';
import { SHELL, type Shell } from '../iam/shell';
import { KERNEL_CONFIG } from '../observability/tokens';
import { orgUnits, unitTypes } from '../org/org.table';
import { withinScope } from '../org/org-admin.service';
import type { OrgUnit } from '../org/org-tree';
import { allowedAt, defaultsOf, registryRules, type SettingEntry, type SettingsRegistry } from './registry';
import { resolve, resolveAll, unitChain, without, type Layer, type Resolved, type Source } from './resolve';
import { settingsValues } from './settings.table';

/** A sensitive setting is changed only with a second factor entered in the last 5 minutes (SEC-SE-5). */
export const SENSITIVE_STEP_UP = 300;

type Row = typeof settingsValues.$inferSelect;

/** A value's JSON Schema, with the parts the screen's editor reads checked (the rest kept as it is). */
const jsonSchema = z
    .object({
        enum: z.array(z.string()).optional(),
        items: z
            .object({ enum: z.array(z.string()).optional() })
            .loose()
            .optional()
    })
    .loose();
type JsonSchema = z.infer<typeof jsonSchema>;

/** The installation's values (`INSTALLATION_SETTINGS`), each checked against the registry; a problem stops the start. */
export function installationValues(registry: SettingsRegistry, raw: Readonly<Record<string, unknown>>) {
    const problems: string[] = [];
    for (const [key, value] of Object.entries(raw)) {
        const entry = registry.get(key);
        if (!entry) problems.push(`INSTALLATION_SETTINGS: "${key}" is not a setting of the installed modules`);
        else if (!allowedAt(entry, 'installation'))
            problems.push(`INSTALLATION_SETTINGS: "${key}" cannot be set for the installation`);
        else if (!entry.schema.safeParse(value).success)
            problems.push(`INSTALLATION_SETTINGS: the value of "${key}" does not fit its schema`);
    }
    if (problems.length) throw new Error(problems.join('; '));
    return new Map(Object.entries(raw));
}

/** A person's own values among their preferences: the settings they may choose, as they chose them (null = reset). */
export function userValues(registry: SettingsRegistry, preferences: unknown): Map<string, unknown> {
    const out = new Map<string, unknown>();
    if (typeof preferences !== 'object' || preferences === null) return out;
    for (const [key, value] of Object.entries(preferences))
        if (value !== null && registry.get(key)?.declaration.userPreference) out.set(key, value);
    return out;
}

/** What a unit's chain is made of: the units from the region's root down to it, and the values stored for them. */
interface ChainData {
    units: OrgUnit[];
    rows: Row[];
}

/** One setting of a unit as the admin screen shows it. */
export interface UnitSetting {
    key: string;
    owner: string;
    /** its name, in every language that has it */
    name: I18nText;
    /** the choices of a setting with a fixed list, each with its name where the catalogue has one */
    options: { value: string; name: I18nText | null }[] | null;
    overridableAt: readonly string[];
    userPreference: boolean;
    sensitive: boolean;
    /** the value's JSON Schema, for the screen's editor */
    schema: JsonSchema;
    value: unknown;
    source: Source;
    /** what the unit would have without its own value (its reset) */
    inherited: Resolved | null;
    /** the unit's own value, with the version a change names */
    own: { value: unknown; version: number } | null;
    /** the region's value for the unit's type */
    unitType: { value: unknown; version: number } | null;
    /** whether the person may set or reset the unit's own value, and the value for its type */
    writable: { unit: boolean; unitType: boolean };
}

export interface UnitSettings {
    unitId: string;
    /** the unit's type, whose value the region may set for all its units */
    unitType: { id: string; name: I18nText } | null;
    /** the units of the chain, for naming a source (`unitId` → name) */
    units: { id: string; name: I18nText }[];
    settings: UnitSetting[];
}

const levelOf = (unit: OrgUnit) => (unit.parentId === null ? 'region' : 'unit');

@Injectable()
export class SettingsService {
    readonly registry: SettingsRegistry;
    private readonly installation: ReadonlyMap<string, unknown>;
    private readonly messages: Catalogues;

    constructor(@Inject(SHELL) shell: Shell, @Inject(KERNEL_CONFIG) config: KernelConfig) {
        this.registry = shell.settings ?? new Map();
        this.messages = shell.messages;
        this.installation = installationValues(this.registry, config.INSTALLATION_SETTINGS);
    }

    private entry(key: string): SettingEntry {
        const entry = this.registry.get(key);
        if (!entry) throw new NotFoundError();
        return entry;
    }

    /** The unit and the units above it (root first), and the values stored for them and for its type. */
    private async chainData(tx: Tx, unit: OrgUnit): Promise<ChainData> {
        const units = await tx
            .select()
            .from(orgUnits)
            .where(sql`${orgUnits.path} @> ${unit.path}::ltree`)
            .orderBy(sql`nlevel(${orgUnits.path})`);
        const ids = units.map((u) => u.id);
        const rows = await tx
            .select()
            .from(settingsValues)
            .where(
                and(
                    eq(settingsValues.regionId, unit.regionId),
                    or(
                        and(isNull(settingsValues.unitTypeId), inArray(settingsValues.unitId, ids)),
                        unit.unitTypeId ? eq(settingsValues.unitTypeId, unit.unitTypeId) : sql`false`
                    )
                )
            );
        return { units, rows };
    }

    private chain(data: ChainData, unit: OrgUnit, user?: ReadonlyMap<string, unknown>): Layer[] {
        const valuesOf = (match: (r: Row) => boolean) =>
            new Map(data.rows.filter(match).map((r) => [r.key, r.value] as const));
        return unitChain({
            defaults: defaultsOf(this.registry),
            installation: this.installation,
            units: data.units.map((u) => ({
                unitId: u.id,
                values: valuesOf((r) => r.unitTypeId === null && r.unitId === u.id)
            })),
            unitType: unit.unitTypeId
                ? { unitTypeId: unit.unitTypeId, values: valuesOf((r) => r.unitTypeId === unit.unitTypeId) }
                : undefined,
            user
        });
    }

    /** Every setting's effective value for a unit, and for a person there (their own values last). */
    async effective(tx: Tx, unit: OrgUnit, user?: ReadonlyMap<string, unknown>): Promise<Map<string, Resolved>> {
        const chain = this.chain(await this.chainData(tx, unit), unit, user);
        return resolveAll(this.registry.keys(), chain, registryRules(this.registry));
    }

    /** One setting's effective value for a unit (its default when nothing else holds). */
    async value<T = unknown>(tx: Tx, unitId: string, key: string): Promise<T> {
        const entry = this.entry(key);
        const [unit] = await tx.select().from(orgUnits).where(eq(orgUnits.id, unitId));
        if (!unit) return entry.declaration.default as T;
        const chain = this.chain(await this.chainData(tx, unit), unit);
        return (resolve(key, chain, registryRules(this.registry))?.value ?? entry.declaration.default) as T;
    }

    private async visibleUnit(tx: Tx, unitId: string): Promise<OrgUnit> {
        const [unit] = await tx.select().from(orgUnits).where(eq(orgUnits.id, unitId));
        if (!unit) throw new NotFoundError();
        return unit;
    }

    /** A unit's settings for the admin screen: each value, where it comes from, what it inherits, who may change it. */
    async forUnit(tx: Tx, scopePath: string, unitId: string): Promise<UnitSettings> {
        const unit = await this.visibleUnit(tx, unitId);
        const data = await this.chainData(tx, unit);
        const chain = this.chain(data, unit);
        const rules = registryRules(this.registry);
        const self: Source = { level: levelOf(unit), unitId: unit.id };
        const mayWriteUnit = withinScope(unit.path, scopePath);
        const root = data.units[0];
        const mayWriteType = Boolean(unit.unitTypeId && root && withinScope(root.path, scopePath));
        const settings = [...this.registry.values()].map((entry): UnitSetting => {
            const key = entry.declaration.key;
            const own = data.rows.find((r) => r.key === key && r.unitTypeId === null && r.unitId === unit.id);
            const forType = data.rows.find((r) => r.key === key && r.unitTypeId !== null);
            const found = resolve(key, chain, rules);
            const schema = jsonSchema.parse(z.toJSONSchema(entry.schema, { unrepresentable: 'any' }));
            return {
                key,
                owner: entry.owner,
                name: textOf(this.messages, entry.label),
                options: this.options(entry, schema),
                overridableAt: entry.declaration.overridableAt,
                userPreference: entry.declaration.userPreference,
                sensitive: entry.declaration.sensitive,
                schema,
                value: found?.value ?? entry.declaration.default,
                source: found?.source ?? { level: 'default' },
                inherited: resolve(key, without(chain, self), rules) ?? null,
                own: own ? { value: own.value, version: own.rowVersion } : null,
                unitType: forType ? { value: forType.value, version: forType.rowVersion } : null,
                writable: {
                    unit: mayWriteUnit && allowedAt(entry, levelOf(unit)),
                    unitType: mayWriteType && allowedAt(entry, 'unitType')
                }
            };
        });
        const [type] = unit.unitTypeId
            ? await tx
                  .select({ id: unitTypes.id, name: unitTypes.name })
                  .from(unitTypes)
                  .where(eq(unitTypes.id, unit.unitTypeId))
            : [];
        return {
            unitId: unit.id,
            unitType: type ?? null,
            units: data.units.map((u) => ({ id: u.id, name: u.name })),
            settings
        };
    }

    /** A fixed list's choices (an enum, or a list of an enum's values), named by `<owner>.settingOption.<key>.<value>`. */
    private options(entry: SettingEntry, schema: JsonSchema): UnitSetting['options'] {
        const values = schema.enum ?? schema.items?.enum;
        if (!values) return null;
        return values.map((value) => {
            const key = `${entry.label.replace('.setting.', '.settingOption.')}.${value}`;
            return { value, name: this.messages.en?.[key] ? textOf(this.messages, key) : null };
        });
    }

    /** Checks a change: the key, the level, the value, the second factor for a sensitive setting. */
    private checkChange(key: string, level: 'region' | 'unit' | 'unitType', value: unknown, authAge?: number) {
        const entry = this.entry(key);
        if (!allowedAt(entry, level))
            throw new ValidationError('setting_level_not_allowed', {
                detail: `"${key}" cannot be set for a ${level === 'unitType' ? 'unit type' : level}.`
            });
        if (entry.declaration.sensitive && !(authAge !== undefined && authAge <= SENSITIVE_STEP_UP))
            throw new StepUpRequiredError(SENSITIVE_STEP_UP);
        if (value === undefined) return undefined;
        const parsed = entry.schema.safeParse(value);
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: ['value', ...i.path].join('.'),
                    code: i.code,
                    message: i.message
                }))
            });
        return parsed.data;
    }

    /** The row of a scope and key, locked. */
    private async current(tx: Tx, unitId: string, unitTypeId: string | null, key: string) {
        const [row] = await tx
            .select()
            .from(settingsValues)
            .where(
                and(
                    eq(settingsValues.unitId, unitId),
                    unitTypeId ? eq(settingsValues.unitTypeId, unitTypeId) : isNull(settingsValues.unitTypeId),
                    eq(settingsValues.key, key)
                )
            )
            .for('update');
        return row;
    }

    private async write(
        tx: Tx,
        scope: { regionId: string; unitId: string; unitTypeId: string | null },
        key: string,
        value: unknown,
        expectedVersion: number
    ): Promise<{ key: string; value: unknown; version: number }> {
        const current = await this.current(tx, scope.unitId, scope.unitTypeId, key);
        if (current) {
            const saved = await updateAudited(tx, settingsValues, current.id, expectedVersion, { value });
            return { key, value: saved.value, version: saved.rowVersion };
        }
        if (expectedVersion !== 0) throw stale(expectedVersion);
        try {
            const saved = await insertAudited(tx, settingsValues, { ...scope, key, value });
            return { key, value: saved.value, version: saved.rowVersion };
        } catch (error) {
            // another administrator set it first, in a transaction that committed meanwhile
            if (isUniqueViolation(error)) throw stale(expectedVersion);
            throw error;
        }
    }

    private async reset(tx: Tx, unitId: string, unitTypeId: string | null, key: string, expectedVersion: number) {
        const current = await this.current(tx, unitId, unitTypeId, key);
        // nothing of its own to reset
        if (!current) throw new NotFoundError();
        await deleteAudited(tx, settingsValues, current.id, expectedVersion);
    }

    /** The unit whose own value is changed: seen (else 404) and at or below the person's seat (else 403). */
    private async writableUnit(tx: Tx, scopePath: string, unitId: string): Promise<OrgUnit> {
        const unit = await this.visibleUnit(tx, unitId);
        if (!withinScope(unit.path, scopePath))
            throw new ForbiddenError({ audit: { reason: 'setting_above_scope', unit: unit.id } });
        return unit;
    }

    async setForUnit(tx: Tx, who: Who, unitId: string, key: string, value: unknown, expectedVersion: number) {
        const unit = await this.writableUnit(tx, who.scopePath, unitId);
        const parsed = this.checkChange(key, levelOf(unit), value, who.authAge);
        return this.write(tx, { regionId: unit.regionId, unitId, unitTypeId: null }, key, parsed, expectedVersion);
    }

    async resetForUnit(tx: Tx, who: Who, unitId: string, key: string, expectedVersion: number) {
        const unit = await this.writableUnit(tx, who.scopePath, unitId);
        this.checkChange(key, levelOf(unit), undefined, who.authAge);
        await this.reset(tx, unitId, null, key, expectedVersion);
    }

    /** A unit type of the person's region, whose value only a seat at the region's root changes. */
    private async writableUnitType(tx: Tx, who: Who, unitTypeId: string) {
        const [type] = await tx.select().from(unitTypes).where(eq(unitTypes.id, unitTypeId));
        if (!type || type.regionId !== who.regionId) throw new NotFoundError();
        const [root] = await tx.select().from(orgUnits).where(eq(orgUnits.id, type.regionId));
        if (!root || !withinScope(root.path, who.scopePath))
            throw new ForbiddenError({ audit: { reason: 'unit_type_setting_below_region', unitType: type.id } });
        return type;
    }

    async setForUnitType(tx: Tx, who: Who, unitTypeId: string, key: string, value: unknown, expectedVersion: number) {
        const type = await this.writableUnitType(tx, who, unitTypeId);
        const parsed = this.checkChange(key, 'unitType', value, who.authAge);
        const scope = { regionId: type.regionId, unitId: type.regionId, unitTypeId };
        return this.write(tx, scope, key, parsed, expectedVersion);
    }

    async resetForUnitType(tx: Tx, who: Who, unitTypeId: string, key: string, expectedVersion: number) {
        const type = await this.writableUnitType(tx, who, unitTypeId);
        this.checkChange(key, 'unitType', undefined, who.authAge);
        await this.reset(tx, type.regionId, unitTypeId, key, expectedVersion);
    }

    /** A person's own value of a setting they may choose: checked (null resets it to their unit's). */
    preferenceValue(key: string, value: unknown): unknown {
        const entry = this.entry(key);
        if (!entry.declaration.userPreference)
            throw new ValidationError('setting_level_not_allowed', { detail: `"${key}" is not a personal choice.` });
        if (value === null) return null;
        const parsed = entry.schema.safeParse(value);
        if (!parsed.success)
            throw new ValidationError('validation_failed', {
                errors: parsed.error.issues.map((i) => ({
                    path: ['value', ...i.path].join('.'),
                    code: i.code,
                    message: i.message
                }))
            });
        return parsed.data;
    }
}

/** Who changes a value: their seat's scope and region, and how long ago they entered their second factor. */
export interface Who {
    scopePath: string;
    regionId: string;
    authAge?: number;
}

const stale = (expectedVersion: number) =>
    new ConflictError('stale_version', { detail: `Version ${expectedVersion} was changed; read the setting again.` });

const isUniqueViolation = (error: unknown) => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
        if ((e as { code?: string }).code === '23505') return true;
    return false;
};
