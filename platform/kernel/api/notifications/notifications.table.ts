/**
 * In-app notifications (task 0.20a): a message to one person (an overdue step, an escalation, later a mention or a
 * finished export). Class T at the unit the message is about, but the API holds no grant on the table: a person reads and
 * marks only their own, through the reviewed `kernel.my_notifications` and `kernel.read_my_notifications`; the worker
 * (and later a request's own work, through a reviewed function) writes them. The text is a message key and its values,
 * shown in the reader's language with its params.
 */
import { index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { baseColumns, ltree } from '../db/columns';
import { notAudited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { withRls } from '../db/rls';
import { users } from '../iam/iam.table';
import { orgUnits } from '../org/org.table';

export const notifications = withRls(
    notAudited(
        kernelSchema.table(
            'notifications',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                userId: uuid('user_id')
                    .notNull()
                    .references(() => users.id),
                /** the unit the message is about (a task's) */
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                /** `<slice>.notify.<kind>`: a message key of a slice's catalogue */
                messageKey: text('message_key').notNull(),
                /** the values the message reads */
                params: jsonb('params').$type<Record<string, string>>().notNull(),
                /** what it points at: `{ caseId }` … */
                link: jsonb('link').$type<Record<string, string>>(),
                readAt: timestamp('read_at', { withTimezone: true })
            },
            (t) => [
                index('notifications_user_idx').on(t.userId, t.createdAt),
                index('notifications_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        'a message to one person: what caused it (an overdue step, a mention) is audited where it happened'
    ),
    'transaction'
);
