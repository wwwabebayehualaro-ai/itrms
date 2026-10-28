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
 *
 *   cases, case_tasks, case_events   the cases running on them, their open and closed steps, their timeline (0.19b).
 */
import { sql } from 'drizzle-orm';
import {
    bigint,
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';

import { CASE_EVENT_KINDS } from '../contracts';

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

/**
 * Cases (task 0.19b): one service request running on the workflow version it started with and the configuration frozen
 * at its start (`approval_unit` …). Its state changes only through a transition. Class T at the handling unit.
 */
export const cases = withRls(
    audited(
        workflowSchema.table(
            'cases',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                handlingUnitId: uuid('handling_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the handling unit */
                orgPath: ltree('org_path').notNull().default(''),
                /** from an ordinary sequence: gaps are harmless here (architecture.md §17) */
                number: bigint('number', { mode: 'number' }).notNull(),
                definitionVersionId: uuid('definition_version_id')
                    .notNull()
                    .references(() => workflowDefinitionVersions.id),
                /** the resolved configuration, frozen at the start: later changes never alter an open case */
                config: jsonb('config').$type<Record<string, unknown>>().notNull(),
                configHash: text('config_hash').notNull(),
                state: text('state').notNull(),
                /** what effects handed back, for later guards and effects */
                facts: jsonb('facts')
                    .$type<Record<string, unknown>>()
                    .notNull()
                    .default(sql`'{}'::jsonb`),
                startedBy: uuid('started_by').notNull(),
                /** when the wait the case is in is due (its timeout), from the state's SLA (task 0.20a) */
                dueAt: timestamp('due_at', { withTimezone: true }),
                closedAt: timestamp('closed_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('cases_number_uq').on(t.regionId, t.number),
                index('cases_org_path_gist').using('gist', t.orgPath),
                index('cases_state_idx').on(t.regionId, t.state),
                index('cases_due_idx')
                    .on(t.dueAt)
                    .where(sql`due_at is not null and closed_at is null`)
            ]
        ),
        { omit: ['facts'] }
    ),
    'transaction'
);

export const CASE_TASK_STATUSES = ['open', 'done', 'cancelled'] as const;

/**
 * A step waiting for a person (task 0.19b): the role that acts and the unit it is held in. Class T at the **assignee**
 * unit: only that unit (and the offices above it) sees the task; who of them may act is the engine's business (the role).
 * One open task per case.
 */
export const caseTasks = withRls(
    audited(
        workflowSchema.table(
            'case_tasks',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                caseId: uuid('case_id')
                    .notNull()
                    .references(() => cases.id),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the assignee unit */
                orgPath: ltree('org_path').notNull().default(''),
                stateKey: text('state_key').notNull(),
                role: text('role').notNull(),
                status: text('status', { enum: CASE_TASK_STATUSES }).notNull().default('open'),
                /** the unit the definition assigned it to, when separation of duties sent it up the tree */
                routedFromUnitId: uuid('routed_from_unit_id').references(() => orgUnits.id),
                actedBy: uuid('acted_by'),
                action: text('action'),
                /** from the state's SLA on the assignee unit's calendar (task 0.20a) */
                dueAt: timestamp('due_at', { withTimezone: true }),
                /** when the SLA timer (or the sweep) found it overdue and told the supervisors */
                overdueAt: timestamp('overdue_at', { withTimezone: true }),
                /** who of the role's holders took it on (task 0.20b): the others see it is theirs, and may not act on it */
                claimedBy: uuid('claimed_by'),
                claimedAt: timestamp('claimed_at', { withTimezone: true }),
                closedAt: timestamp('closed_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('case_tasks_open_uq')
                    .on(t.caseId)
                    .where(sql`status = 'open'`),
                index('case_tasks_case_idx').on(t.caseId),
                index('case_tasks_org_path_gist').using('gist', t.orgPath),
                index('case_tasks_inbox_idx').on(t.unitId, t.role, t.status),
                index('case_tasks_due_idx')
                    .on(t.dueAt)
                    .where(sql`status = 'open' and overdue_at is null`)
            ]
        )
    ),
    'transaction'
);

/**
 * A case's timeline (task 0.19b): append-only (no UPDATE or DELETE but a unit move's `org_path`). Class T at the unit
 * handling the case when it happened. A person's actor is a user id; a system actor its `system:<adapter>`. A comment
 * (task 0.20b) is an event of its own: its text, the people it mentions and who may read it (`data`).
 */
export const caseEvents = withRls(
    audited(
        workflowSchema.table(
            'case_events',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                caseId: uuid('case_id')
                    .notNull()
                    .references(() => cases.id),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                kind: text('kind', { enum: CASE_EVENT_KINDS }).notNull(),
                fromState: text('from_state'),
                toState: text('to_state'),
                /** the action, or the event or `timeout` a system actor took */
                action: text('action'),
                actorUserId: uuid('actor_user_id'),
                systemActor: text('system_actor'),
                comment: text('comment'),
                data: jsonb('data').$type<Record<string, unknown>>()
            },
            (t) => [
                index('case_events_case_idx').on(t.caseId, t.createdAt),
                index('case_events_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['comment'] }
    ),
    'transaction'
);

/**
 * A unit's working calendar (task 0.20a): its working periods per weekday and its half days, when it differs from the
 * civil service's week (`CIVIL_SERVICE_WEEK`). The nearest one up the tree applies. Class C.
 */
export const workingCalendars = withRls(
    audited(
        workflowSchema.table(
            'working_calendars',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                /** weekday (0 = Sunday) → [["08:30","12:30"], ["13:30","17:30"]] */
                week: jsonb('week').$type<Record<string, [string, string][]>>().notNull(),
                /** YYYY-MM-DD → the hour it closes */
                halfDays: jsonb('half_days')
                    .$type<Record<string, string>>()
                    .notNull()
                    .default(sql`'{}'::jsonb`)
            },
            (t) => [
                uniqueIndex('working_calendars_unit_uq').on(t.unitId),
                index('working_calendars_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

/**
 * A unit's own holidays (task 0.20a), besides the national ones the calendar package computes: a regional day, a
 * confirmed date of a Muslim holiday. They apply to the unit and below it. Class C.
 */
export const holidays = withRls(
    audited(
        workflowSchema.table(
            'holidays',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                date: date('date', { mode: 'string' }).notNull(),
                key: text('key').notNull(),
                /** I18nText */
                name: jsonb('name').$type<Record<string, string>>().notNull()
            },
            (t) => [
                uniqueIndex('holidays_unit_date_uq').on(t.unitId, t.date),
                index('holidays_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);
