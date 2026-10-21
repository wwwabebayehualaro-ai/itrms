/**
 * The audit log (ADR-0018, architecture.md §15): one row per insert, update or delete of a business table, written in the
 * same transaction by the write helpers (audit.ts), plus non-row events (`recordEvent`). Append-only: the migration adds a
 * trigger that refuses UPDATE, DELETE and TRUNCATE, and grants the app INSERT and SELECT only. RLS (class T) comes with the
 * isolation work (task 0.9); hash chaining, monthly partitions and masking of personal fields are follow-ups.
 */
import { index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { notAudited } from './audit-policy';
import { ltree, newId } from './columns';

export const kernelSchema = pgSchema('kernel');

export const AUDIT_ACTIONS = ['insert', 'update', 'delete', 'event'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditLog = notAudited(
    kernelSchema.table(
        'audit_log',
        {
            id: uuid('id').primaryKey().$defaultFn(newId),
            at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
            actorId: uuid('actor_id'),
            unitId: uuid('unit_id'),
            regionId: uuid('region_id'),
            orgPath: ltree('org_path'),
            action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
            /** schema-qualified table of a row change (`kernel.org_units`) */
            tableName: text('table_name'),
            rowId: uuid('row_id'),
            /** the kind of a non-row event (`person.revealed`, `export.created`) */
            eventType: text('event_type'),
            /** insert: `{ after }`, update: `{ before, after }` of the changed fields, delete: `{ before }`, event: its data */
            diff: jsonb('diff'),
            requestId: text('request_id'),
            ip: text('ip')
        },
        (t) => [index('audit_log_row_idx').on(t.tableName, t.rowId), index('audit_log_at_idx').on(t.at)]
    ),
    'it is the audit log'
);
