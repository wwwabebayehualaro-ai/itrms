/**
 * Workflow definitions (architecture.md §6.2 and §8, task 0.19a).
 *
 *   workflow_definitions          a workflow by key, owned by a unit: the bureau's at the region's root (class C: the
 *                                 subtree and its ancestors read, the subtree writes; a woreda's cases run on the bureau's
 *                                 workflows, which it cannot change).
 *   workflow_definition_versions  immutable, content-hashed versions, stored only once the engine's checks pass (class C,
 *                                 beside their definition). No UPDATE or DELETE: grants and a trigger refuse them; only a
 *                                 unit move rewrites `org_path`. A case runs on the version it started with (0.19b).
 *
 * The audit log holds a version's hash, never its content (the versions are the record).
 */
import {
    boolean,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';

export const workflowSchema = pgSchema('workflow');

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

export const workflowDefinitions = withRls(
    audited(
        workflowSchema.table(
            'workflow_definitions',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<Record<string, string>>().notNull(),
                active: boolean('active').notNull().default(true),
                /** the newest version: what a service version picks by default (0.21) */
                latestVersionId: uuid('latest_version_id').references((): AnyPgColumn => workflowDefinitionVersions.id)
            },
            (t) => [
                uniqueIndex('workflow_definitions_key_uq').on(t.regionId, t.key),
                index('workflow_definitions_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const workflowDefinitionVersions = withRls(
    audited(
        workflowSchema.table(
            'workflow_definition_versions',
            {
                ...baseColumns(),
                ...owned(),
                definitionId: uuid('definition_id')
                    .notNull()
                    .references(() => workflowDefinitions.id),
                /** 1, 2, 3 … per workflow, in the order versions were stored */
                number: integer('number').notNull(),
                contentHash: text('content_hash').notNull(),
                definition: jsonb('definition').notNull()
            },
            (t) => [
                uniqueIndex('workflow_definition_versions_content_uq').on(t.definitionId, t.contentHash),
                uniqueIndex('workflow_definition_versions_number_uq').on(t.definitionId, t.number),
                index('workflow_definition_versions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['definition'] }
    ),
    'config'
);
