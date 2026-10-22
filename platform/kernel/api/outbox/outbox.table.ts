/**
 * The transactional outbox (architecture.md §12): events written in the business transaction (`pending`), enqueued by the
 * relay (`enqueued`, jobId = event id), marked `done` by their handler, `dead` after the last retry. Losing Valkey loses
 * no event: the sweep sends back to `pending` anything enqueued too long ago. Class T: the unit the event happened in.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { notAudited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { ltree, newId } from '../db/columns';
import { withRls } from '../db/rls';
import { orgUnits } from '../org/org.table';

export const OUTBOX_STATUSES = ['pending', 'enqueued', 'done', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const outboxEvents = withRls(
    notAudited(
        kernelSchema.table(
            'outbox_events',
            {
                id: uuid('id').primaryKey().$defaultFn(newId),
                regionId: uuid('region_id').notNull(),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** `<entity>.<happened>.v<n>` */
                type: text('type').notNull(),
                payload: jsonb('payload').notNull(),
                status: text('status', { enum: OUTBOX_STATUSES }).notNull().default('pending'),
                attempts: integer('attempts').notNull().default(0),
                lastError: text('last_error'),
                requestId: text('request_id'),
                createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
                availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
                enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
                doneAt: timestamp('done_at', { withTimezone: true })
            },
            (t) => [
                index('outbox_events_pending_idx')
                    .on(t.availableAt)
                    .where(sql`status = 'pending'`),
                index('outbox_events_enqueued_idx')
                    .on(t.enqueuedAt)
                    .where(sql`status = 'enqueued'`),
                index('outbox_events_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        "an event of a business write that is itself audited; its status is the relay's bookkeeping"
    ),
    'transaction'
);
