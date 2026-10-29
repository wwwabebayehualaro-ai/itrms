/**
 * The service catalogue (architecture.md §6.2, §7; task 0.21b). Schema `services`.
 *
 *   service_definitions  a region's catalogue: one row per service code (54 seeded), owned by the region's root (class C:
 *                        every unit reads it, the region's seat writes it). "Not configured" until a version is published.
 *   service_versions     a bureau's configuration of a service: the form and workflow versions, the defaults and the
 *                        override policy, from a date. Immutable and content-hashed (drizzle/0046); a case freezes the one
 *                        it starts on.
 *   service_overrides    a unit's values for the keys its region's version lets it change (class C on the unit: the units
 *                        above read it, the subtree writes it). Resolved root → unit by the kernel's one resolver.
 */
import { sql } from 'drizzle-orm';
import {
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import { orgUnits } from '@itrms/kernel/tables';

export const servicesSchema = pgSchema('services');

export const serviceDefinitions = withRls(
    audited(
        servicesSchema.table(
            'service_definitions',
            {
                ...baseColumns(),
                regionId: uuid('region_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger: the region's path */
                orgPath: ltree('org_path').notNull().default(''),
                code: text('code').notNull(),
                /** the work process (1–10) */
                process: integer('process').notNull(),
                module: text('module').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<Record<string, string>>().notNull(),
                active: boolean('active').notNull().default(true),
                /** the newest version published; none: not configured */
                currentVersionId: uuid('current_version_id').references((): AnyPgColumn => serviceVersions.id)
            },
            (t) => [uniqueIndex('service_definitions_code_uq').on(t.regionId, t.code)]
        )
    ),
    'config'
);

export const serviceVersions = withRls(
    audited(
        servicesSchema.table(
            'service_versions',
            {
                ...baseColumns(),
                regionId: uuid('region_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger: the region's path */
                orgPath: ltree('org_path').notNull().default(''),
                serviceId: uuid('service_id')
                    .notNull()
                    .references(() => serviceDefinitions.id),
                /** 1, 2, 3 … per service */
                number: integer('number').notNull(),
                contentHash: text('content_hash').notNull(),
                // their foreign keys are in drizzle/0046 (the forms and workflow tables are those slices' own)
                formVersionId: uuid('form_version_id'),
                workflowVersionId: uuid('workflow_version_id').notNull(),
                /** the fee rule's version (task 0.22) and the document templates' (0.23): none until they exist */
                feeRuleVersionId: uuid('fee_rule_version_id'),
                templateVersionIds: jsonb('template_version_ids')
                    .$type<string[]>()
                    .notNull()
                    .default(sql`'[]'::jsonb`),
                defaults: jsonb('defaults').$type<Record<string, unknown>>().notNull(),
                overridePolicy: jsonb('override_policy').$type<Record<string, string[]>>().notNull(),
                /** each effect's contract paths mapped to the request form's keys (task 0.21d; a path maps to itself otherwise) */
                inputMap: jsonb('input_map')
                    .$type<Record<string, Record<string, string>>>()
                    .notNull()
                    .default(sql`'{}'::jsonb`),
                /** the first day (Addis Ababa) it holds for new cases */
                effectiveFrom: date('effective_from').notNull(),
                note: text('note')
            },
            (t) => [
                uniqueIndex('service_versions_number_uq').on(t.serviceId, t.number),
                index('service_versions_service_idx').on(t.serviceId, t.effectiveFrom)
            ]
        )
    ),
    'config'
);

export const serviceOverrides = withRls(
    audited(
        servicesSchema.table(
            'service_overrides',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** set by trigger: the unit's path */
                orgPath: ltree('org_path').notNull().default(''),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                serviceId: uuid('service_id')
                    .notNull()
                    .references(() => serviceDefinitions.id),
                values: jsonb('values').$type<Record<string, unknown>>().notNull(),
                reason: text('reason').notNull()
            },
            (t) => [
                uniqueIndex('service_overrides_unit_service_uq').on(t.unitId, t.serviceId),
                index('service_overrides_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);
