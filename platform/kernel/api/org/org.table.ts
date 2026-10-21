/**
 * The org tree and unit types (ADR-0011, ADR-0026; architecture.md §5, org-and-unit-types.md). A region is the root unit of
 * its own tree (`region_id = id`); its level definitions set the depth and the level names. `path` is the materialised
 * ancestry, kept by triggers (drizzle/0004): set from the parent on insert, rewritten for the whole subtree on a move, and
 * refused when written directly. Every write goes through the audited helpers. RLS (class C) arrives with task 0.9.
 */
import type { I18nText } from '@itrms/schemas';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { audited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { baseColumns, ltree } from '../db/columns';

/** A team a unit type creates in each of its units (Form 15 teams: one per work process). */
export interface DepartmentTemplate {
    key: string;
    process?: string;
    name: I18nText;
}

export const orgLevelDefinitions = audited(
    kernelSchema.table(
        'org_level_definitions',
        {
            ...baseColumns(),
            regionId: uuid('region_id')
                .notNull()
                .references((): AnyPgColumn => orgUnits.id),
            key: text('key').notNull(),
            name: jsonb('name').$type<I18nText>().notNull(),
            /** 1 for the region; a unit's level ranks below its parent's (a special woreda: rank 3 directly under rank 1) */
            rank: integer('rank').notNull()
        },
        (t) => [uniqueIndex('org_level_definitions_key_uq').on(t.regionId, t.key)]
    )
);

export const unitTypes = audited(
    kernelSchema.table(
        'unit_types',
        {
            ...baseColumns(),
            regionId: uuid('region_id')
                .notNull()
                .references((): AnyPgColumn => orgUnits.id),
            key: text('key').notNull(),
            name: jsonb('name').$type<I18nText>().notNull(),
            levelKey: text('level_key').notNull(),
            /** the categories (ምድብ) or grades (ፈርጅ) a unit of this type may have: `m1`, `f3` */
            categories: text('categories')
                .array()
                .notNull()
                .default(sql`'{}'`),
            /** named switches code may check (`collects_cash`, `runs_terminal`); never the type's key */
            capabilities: text('capabilities')
                .array()
                .notNull()
                .default(sql`'{}'`),
            departments: jsonb('departments').$type<DepartmentTemplate[]>().notNull().default([]),
            active: boolean('active').notNull().default(true)
        },
        (t) => [uniqueIndex('unit_types_key_uq').on(t.regionId, t.key)]
    )
);

export const unitTypeServices = audited(
    kernelSchema.table(
        'unit_type_services',
        {
            ...baseColumns(),
            regionId: uuid('region_id').notNull(),
            unitTypeId: uuid('unit_type_id')
                .notNull()
                .references(() => unitTypes.id),
            serviceCode: text('service_code').notNull(),
            enabled: boolean('enabled').notNull().default(true)
        },
        (t) => [uniqueIndex('unit_type_services_uq').on(t.unitTypeId, t.serviceCode)]
    )
);

export const unitTypeRoles = audited(
    kernelSchema.table(
        'unit_type_roles',
        {
            ...baseColumns(),
            regionId: uuid('region_id').notNull(),
            unitTypeId: uuid('unit_type_id')
                .notNull()
                .references(() => unitTypes.id),
            roleKey: text('role_key').notNull()
        },
        (t) => [uniqueIndex('unit_type_roles_uq').on(t.unitTypeId, t.roleKey)]
    )
);

export const ORG_UNIT_KINDS = [
    'region',
    'zone',
    'woreda',
    'special_woreda',
    'town_admin',
    'city_admin',
    'sub_city',
    'kebele'
] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

export const orgUnits = audited(
    kernelSchema.table(
        'org_units',
        {
            ...baseColumns(),
            regionId: uuid('region_id').notNull(),
            parentId: uuid('parent_id').references((): AnyPgColumn => orgUnits.id),
            /** set by the trigger; the value written on insert is ignored */
            path: ltree('path').notNull().default(''),
            kind: text('kind', { enum: ORG_UNIT_KINDS }).notNull(),
            levelKey: text('level_key').notNull(),
            code: text('code').notNull(),
            name: jsonb('name').$type<I18nText>().notNull(),
            category: text('category'),
            unitTypeId: uuid('unit_type_id').references(() => unitTypes.id),
            keycloakGroupId: text('keycloak_group_id'),
            /** facts the unit has still to confirm (`name.am`, `category`, `unit_type`): shown in the org admin screen */
            toConfirm: text('to_confirm')
                .array()
                .notNull()
                .default(sql`'{}'`),
            active: boolean('active').notNull().default(true)
        },
        (t) => [
            uniqueIndex('org_units_code_uq').on(t.regionId, t.code),
            index('org_units_path_gist').using('gist', t.path),
            index('org_units_parent_idx').on(t.parentId)
        ]
    )
);

export const orgDepartments = audited(
    kernelSchema.table(
        'org_departments',
        {
            ...baseColumns(),
            regionId: uuid('region_id').notNull(),
            orgUnitId: uuid('org_unit_id')
                .notNull()
                .references(() => orgUnits.id),
            key: text('key').notNull(),
            process: text('process'),
            name: jsonb('name').$type<I18nText>().notNull(),
            active: boolean('active').notNull().default(true)
        },
        (t) => [uniqueIndex('org_departments_key_uq').on(t.orgUnitId, t.key)]
    )
);

export const unitServiceOverrides = audited(
    kernelSchema.table(
        'unit_service_overrides',
        {
            ...baseColumns(),
            regionId: uuid('region_id').notNull(),
            orgUnitId: uuid('org_unit_id')
                .notNull()
                .references(() => orgUnits.id),
            serviceCode: text('service_code').notNull(),
            enabled: boolean('enabled').notNull(),
            reason: text('reason').notNull()
        },
        (t) => [uniqueIndex('unit_service_overrides_uq').on(t.orgUnitId, t.serviceCode)]
    )
);
