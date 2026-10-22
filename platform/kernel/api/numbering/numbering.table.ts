/**
 * Counters for the numbers ITRMS itself issues (architecture.md §15, ADR-0014/0031): receipts, its own certificates,
 * correspondence. One row per (unit, key); each number is one UPDATE … RETURNING in the business transaction, so numbers
 * are gapless, never reused, and serialised per counter. Class T: a unit's counters are its own.
 */
import { sql } from 'drizzle-orm';
import { bigint, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { notAudited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { ltree, newId } from '../db/columns';
import { withRls } from '../db/rls';
import { orgUnits } from '../org/org.table';

export const numberCounters = withRls(
    notAudited(
        kernelSchema.table(
            'number_counters',
            {
                id: uuid('id').primaryKey().$defaultFn(newId),
                regionId: uuid('region_id').notNull(),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** `<module>.<name>`: `fees.receipt` */
                key: text('key').notNull(),
                /** `{unit}/{seq:06}/{efy}`: the unit's code, the number padded, the Ethiopian fiscal year */
                pattern: text('pattern').notNull(),
                /** the last number issued; a migrated register starts after its highest number (`start_after`) */
                lastValue: bigint('last_value', { mode: 'bigint' })
                    .notNull()
                    .default(sql`0`),
                createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
                updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
            },
            (t) => [
                uniqueIndex('number_counters_unit_key_uq').on(t.unitId, t.key),
                index('number_counters_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        'a counter moves with every number issued; the business row that carries the number is audited'
    ),
    'transaction'
);
