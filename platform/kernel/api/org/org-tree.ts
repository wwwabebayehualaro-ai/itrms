/**
 * The org tree's operations on a transaction (used by the admin API and the import): create, rename, move and deactivate a
 * unit, unit-service overrides, and the effective services of a unit (org-and-unit-types.md §2):
 *   effective = the unit type's default services ⊕ the unit's overrides.
 * Every write goes through the audited helpers. The level rules are checked here, the path rules by the triggers. Scope
 * (may this person touch that unit) is the caller's concern: the admin service checks it, the import runs as an installer.
 */
import type { I18nText } from '@itrms/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';

import { deleteAudited, insertAudited, recordEvent, updateAudited } from '../db/audit';
import { newId } from '../db/columns';
import type { Tx } from '../db/types';
import { ConflictError, NotFoundError, ValidationError, type FieldError } from '../errors';
import { emit } from '../outbox/outbox';
import {
    orgDepartments,
    orgLevelDefinitions,
    orgUnits,
    unitServiceOverrides,
    unitTypes,
    unitTypeServices,
    type OrgUnitKind
} from './org.table';

export type OrgUnit = typeof orgUnits.$inferSelect;
export type UnitType = typeof unitTypes.$inferSelect;
export type LevelDefinition = typeof orgLevelDefinitions.$inferSelect;

export const SERVICE_CODE = /^[A-Z]{2,3}-\d{2}$/;

const invalid = (path: string, code: string, message: string): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message }] satisfies FieldError[] });
};

/**
 * Serialises tree writes of a region (the same lock the path trigger takes, released at commit), so the checks that
 * follow read what is committed and a duplicate code or a concurrent move cannot slip between check and write.
 */
export async function lockRegionTree(tx: Tx, regionId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'kernel.org_units:' + regionId}, 0))`);
}

export async function findUnit(tx: Tx, id: string): Promise<OrgUnit | undefined> {
    const [unit] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id));
    return unit;
}

export async function getUnit(tx: Tx, id: string): Promise<OrgUnit> {
    const unit = await findUnit(tx, id);
    if (!unit) throw new NotFoundError();
    return unit;
}

export async function findUnitByCode(tx: Tx, regionId: string, code: string): Promise<OrgUnit | undefined> {
    const [unit] = await tx
        .select()
        .from(orgUnits)
        .where(and(eq(orgUnits.regionId, regionId), eq(orgUnits.code, code)));
    return unit;
}

export async function levelsOf(tx: Tx, regionId: string): Promise<Map<string, LevelDefinition>> {
    const rows = await tx.select().from(orgLevelDefinitions).where(eq(orgLevelDefinitions.regionId, regionId));
    return new Map(rows.map((l) => [l.key, l]));
}

export async function unitTypesOf(tx: Tx, regionId: string): Promise<Map<string, UnitType>> {
    const rows = await tx.select().from(unitTypes).where(eq(unitTypes.regionId, regionId));
    return new Map(rows.map((t) => [t.id, t]));
}

/** A unit's level must be one of its region's, and rank below its parent's. */
function checkLevel(levels: Map<string, LevelDefinition>, levelKey: string, parentLevelKey: string | undefined) {
    const level = levels.get(levelKey);
    if (!level) return invalid('level', 'unknown_level', `"${levelKey}" is not a level of this region`);
    if (parentLevelKey === undefined) {
        if (level.rank !== 1)
            invalid('level', 'not_a_root_level', `a region's level ranks 1, "${levelKey}" ranks ${level.rank}`);
        return;
    }
    const parentLevel = levels.get(parentLevelKey);
    if (parentLevel && level.rank <= parentLevel.rank)
        invalid(
            'level',
            'level_not_below_parent',
            `"${levelKey}" does not rank below its parent's level "${parentLevelKey}"`
        );
}

/** A unit type must be of the region, of the unit's level, and allow the unit's category. */
function checkType(type: UnitType | undefined, levelKey: string, category: string | null) {
    if (!type) return;
    if (type.levelKey !== levelKey)
        invalid(
            'unitType',
            'unit_type_level',
            `unit type "${type.key}" is for the level "${type.levelKey}", not "${levelKey}"`
        );
    if (category !== null && type.categories.length > 0 && !type.categories.includes(category))
        invalid('category', 'category_not_allowed', `unit type "${type.key}" allows ${type.categories.join(', ')}`);
}

export interface NewUnit {
    parentId: string;
    kind: OrgUnitKind;
    levelKey: string;
    code: string;
    name: I18nText;
    category?: string | null;
    unitTypeId?: string | null;
    toConfirm?: string[];
}

/** A unit under `parentId`, with the teams its type creates. */
export async function createUnit(tx: Tx, input: NewUnit): Promise<OrgUnit> {
    await lockRegionTree(tx, (await getUnit(tx, input.parentId)).regionId);
    const parent = await getUnit(tx, input.parentId);
    if (!parent.active) invalid('parentId', 'parent_inactive', 'the parent unit is deactivated');
    checkLevel(await levelsOf(tx, parent.regionId), input.levelKey, parent.levelKey);
    const types = await unitTypesOf(tx, parent.regionId);
    const type = input.unitTypeId ? types.get(input.unitTypeId) : undefined;
    if (input.unitTypeId && !type) invalid('unitTypeId', 'unknown_unit_type', 'not a unit type of this region');
    if (type && !type.active) invalid('unitTypeId', 'unit_type_inactive', `unit type "${type.key}" is no longer used`);
    checkType(type, input.levelKey, input.category ?? null);
    if (await findUnitByCode(tx, parent.regionId, input.code))
        throw new ConflictError('duplicate_reference', { detail: `The code ${input.code} is already used.` });

    const unit = await insertAudited(tx, orgUnits, {
        regionId: parent.regionId,
        parentId: parent.id,
        kind: input.kind,
        levelKey: input.levelKey,
        code: input.code,
        name: input.name,
        category: input.category ?? null,
        unitTypeId: type?.id ?? null,
        toConfirm: input.toConfirm ?? []
    });
    for (const department of type?.departments ?? [])
        await insertAudited(tx, orgDepartments, {
            regionId: unit.regionId,
            orgUnitId: unit.id,
            key: department.key,
            process: department.process ?? null,
            name: department.name
        });
    await unitChanged(tx, unit, 'created');
    return unit;
}

/** The identity provider mirrors the tree (its groups): the worker updates it from this event. */
async function unitChanged(tx: Tx, unit: OrgUnit, change: 'created' | 'renamed' | 'moved' | 'deactivated') {
    await emit(tx, 'org-unit.changed.v1', { unitId: unit.id, change }, { unitId: unit.id, regionId: unit.regionId });
}

/** A region: the root of its own tree. Its levels are added next (the import does both in one transaction). */
export async function createRegion(
    tx: Tx,
    input: { code: string; name: I18nText; levelKey: string; toConfirm?: string[] }
): Promise<OrgUnit> {
    const id = newId();
    const region = await insertAudited(tx, orgUnits, {
        id,
        regionId: id,
        parentId: null,
        kind: 'region',
        levelKey: input.levelKey,
        code: input.code,
        name: input.name,
        toConfirm: input.toConfirm ?? []
    });
    await unitChanged(tx, region, 'created');
    return region;
}

export async function renameUnit(tx: Tx, id: string, version: number, name: I18nText): Promise<OrgUnit> {
    const unit = await updateAudited(tx, orgUnits, id, version, { name });
    await unitChanged(tx, unit, 'renamed');
    return unit;
}

/** Moves a unit and its subtree under another unit of the region (the triggers rewrite the paths). */
export async function moveUnit(tx: Tx, id: string, version: number, parentId: string): Promise<OrgUnit> {
    await lockRegionTree(tx, (await getUnit(tx, id)).regionId);
    const unit = await getUnit(tx, id);
    const parent = await getUnit(tx, parentId);
    if (unit.parentId === null) invalid('parentId', 'region_cannot_move', 'a region is the root of its tree');
    if (parent.regionId !== unit.regionId) throw new NotFoundError();
    if (!parent.active) invalid('parentId', 'parent_inactive', 'the new parent unit is deactivated');
    if (parent.path === unit.path || parent.path.startsWith(`${unit.path}.`))
        invalid('parentId', 'move_under_itself', 'a unit cannot move under itself');
    checkLevel(await levelsOf(tx, unit.regionId), unit.levelKey, parent.levelKey);

    const [{ descendants } = { descendants: 0 }] = await tx
        .select({ descendants: sql<number>`count(*)::int` })
        .from(orgUnits)
        .where(sql`${orgUnits.path} <@ ${unit.path}::ltree and ${orgUnits.id} <> ${unit.id}`);
    const moved = await updateAudited(tx, orgUnits, id, version, { parentId });
    await recordEvent(tx, {
        type: 'org.unit_moved',
        table: orgUnits,
        rowId: id,
        data: {
            fromParentId: unit.parentId,
            toParentId: parentId,
            fromPath: unit.path,
            toPath: moved.path,
            descendants
        }
    });
    await unitChanged(tx, moved, 'moved');
    return moved;
}

/** Deactivates a unit with no active units below it. Records are never deleted (architecture §6). */
export async function deactivateUnit(tx: Tx, id: string, version: number): Promise<OrgUnit> {
    await lockRegionTree(tx, (await getUnit(tx, id)).regionId);
    const unit = await getUnit(tx, id);
    if (unit.parentId === null)
        invalid('id', 'region_cannot_deactivate', 'a region is deactivated with its installation');
    const [child] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.parentId, id), eq(orgUnits.active, true)))
        .limit(1);
    if (child) invalid('id', 'has_active_children', 'deactivate the units below it first');
    const deactivated = await updateAudited(tx, orgUnits, id, version, { active: false });
    await unitChanged(tx, deactivated, 'deactivated');
    return deactivated;
}

/** The units of a subtree, the root first, then by depth and code. */
export async function subtree(tx: Tx, rootPath: string): Promise<OrgUnit[]> {
    return tx
        .select()
        .from(orgUnits)
        .where(sql`${orgUnits.path} <@ ${rootPath}::ltree`)
        .orderBy(sql`nlevel(${orgUnits.path})`, asc(orgUnits.code));
}

/** A unit's effective services: its type's defaults with its own overrides applied, sorted by code. */
export async function effectiveServices(tx: Tx, unitId: string): Promise<string[]> {
    const unit = await getUnit(tx, unitId);
    const effective = new Map<string, boolean>();
    if (unit.unitTypeId) {
        const defaults = await tx
            .select({ code: unitTypeServices.serviceCode, enabled: unitTypeServices.enabled })
            .from(unitTypeServices)
            .where(eq(unitTypeServices.unitTypeId, unit.unitTypeId));
        for (const d of defaults) effective.set(d.code, d.enabled);
    }
    const overrides = await tx
        .select({ code: unitServiceOverrides.serviceCode, enabled: unitServiceOverrides.enabled })
        .from(unitServiceOverrides)
        .where(eq(unitServiceOverrides.orgUnitId, unitId));
    for (const o of overrides) effective.set(o.code, o.enabled);
    return [...effective]
        .filter(([, enabled]) => enabled)
        .map(([code]) => code)
        .sort();
}

/**
 * Turns a service on or off for one unit, against its type's default (an exception, with its reason). With
 * `expectedVersion` (the API's If-Match; 0 for none yet) another administrator's change since is refused, never
 * overwritten; the seeds and tests leave it out.
 */
export async function setServiceOverride(
    tx: Tx,
    unitId: string,
    serviceCode: string,
    enabled: boolean,
    reason: string,
    expectedVersion?: number
): Promise<void> {
    if (!SERVICE_CODE.test(serviceCode))
        invalid('serviceCode', 'unknown_service', `"${serviceCode}" is not a service code`);
    const unit = await getUnit(tx, unitId);
    const [current] = await tx
        .select()
        .from(unitServiceOverrides)
        .where(and(eq(unitServiceOverrides.orgUnitId, unitId), eq(unitServiceOverrides.serviceCode, serviceCode)));
    if (current)
        await updateAudited(tx, unitServiceOverrides, current.id, expectedVersion ?? current.rowVersion, {
            enabled,
            reason
        });
    else if (expectedVersion !== undefined && expectedVersion !== 0)
        throw new ConflictError('stale_version', { detail: `Version ${expectedVersion} was changed; read it again.` });
    else
        await insertAudited(tx, unitServiceOverrides, {
            regionId: unit.regionId,
            orgUnitId: unitId,
            serviceCode,
            enabled,
            reason
        });
}

/** Back to the unit type's default for this service. */
export async function clearServiceOverride(
    tx: Tx,
    unitId: string,
    serviceCode: string,
    expectedVersion?: number
): Promise<void> {
    const [current] = await tx
        .select()
        .from(unitServiceOverrides)
        .where(and(eq(unitServiceOverrides.orgUnitId, unitId), eq(unitServiceOverrides.serviceCode, serviceCode)));
    if (!current) throw new NotFoundError();
    await deleteAudited(tx, unitServiceOverrides, current.id, expectedVersion ?? current.rowVersion);
}

/** A unit's own exceptions to its type's services, with the version a change names. */
export async function serviceOverridesOf(tx: Tx, unitId: string) {
    const rows = await tx
        .select()
        .from(unitServiceOverrides)
        .where(eq(unitServiceOverrides.orgUnitId, unitId))
        .orderBy(asc(unitServiceOverrides.serviceCode));
    return rows.map((r) => ({ code: r.serviceCode, enabled: r.enabled, reason: r.reason, version: r.rowVersion }));
}

/** What a screen shows of a unit: its level's name in the region's own words, its type and capabilities. */
export async function describeUnit(tx: Tx, unit: OrgUnit) {
    const level = (await levelsOf(tx, unit.regionId)).get(unit.levelKey);
    const [type] = unit.unitTypeId ? await tx.select().from(unitTypes).where(eq(unitTypes.id, unit.unitTypeId)) : [];
    return {
        id: unit.id,
        regionId: unit.regionId,
        parentId: unit.parentId,
        code: unit.code,
        kind: unit.kind,
        name: unit.name,
        level: { key: unit.levelKey, name: level?.name ?? null },
        category: unit.category,
        unitType: type ? { id: type.id, key: type.key, name: type.name } : null,
        capabilities: type?.capabilities ?? [],
        toConfirm: unit.toConfirm,
        active: unit.active,
        version: unit.rowVersion
    };
}
