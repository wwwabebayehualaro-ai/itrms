/**
 * Idempotency keys (architecture.md §15, ADR-0031): one row per (user, unit, method, path, key), inserted in the business
 * transaction of the request, holding the request's hash and the response it got. A replay with the same hash gets that
 * response; another hash gets 422. Kept 7 days. Class T: the unit the request acted for.
 */
import { index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { notAudited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { ltree, newId } from '../db/columns';
import { withRls } from '../db/rls';
import { orgUnits } from '../org/org.table';

export const idempotencyKeys = withRls(
    notAudited(
        kernelSchema.table(
            'idempotency_keys',
            {
                id: uuid('id').primaryKey().$defaultFn(newId),
                regionId: uuid('region_id').notNull(),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                userId: uuid('user_id').notNull(),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                method: text('method').notNull(),
                path: text('path').notNull(),
                key: text('key').notNull(),
                /** SHA-256 of the method, path, unit and body */
                requestHash: text('request_hash').notNull(),
                statusCode: integer('status_code').notNull(),
                response: jsonb('response'),
                createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
                expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
            },
            (t) => [
                uniqueIndex('idempotency_keys_uq').on(t.userId, t.unitId, t.method, t.path, t.key),
                index('idempotency_keys_expires_idx').on(t.expiresAt)
            ]
        ),
        'a technical record of a request already audited by the write it carried'
    ),
    'transaction'
);
