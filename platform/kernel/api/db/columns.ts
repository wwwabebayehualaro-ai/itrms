/**
 * The columns every business table starts with (architecture.md §6): a UUIDv7 id generated in the app (index locality,
 * tech-stack T4), who created and last changed the row and when, and `row_version` for optimistic locking (a write that
 * names an older version is refused with 409 `stale_version`).
 */
import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** PostgreSQL's ltree (org paths: `et.snnp.wolaita.sodo`). */
export const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });

export const newId = (): string => uuidv7();

export const baseColumns = () => ({
    id: uuid('id').primaryKey().$defaultFn(newId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    rowVersion: integer('row_version').notNull().default(1)
});
