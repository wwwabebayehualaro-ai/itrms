/**
 * The regions' data keys (security.md §11, SEC-CR-3): each region's sensitive fields are encrypted with its own AES-256
 * data key, stored here only wrapped (encrypted) by a key-encryption key that lives outside the database (`FIELD_KEYS`).
 * Rotating the key-encryption key re-wraps these rows; the data stays as it is. Class C on the region's path: everyone in
 * the region reads the wrapped keys (useless without the key-encryption key); only kernel.ensure_region_data_key writes.
 */
import { sql } from 'drizzle-orm';
import { boolean, customType, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { notAudited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { baseColumns, ltree } from '../db/columns';
import { withRls } from '../db/rls';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const regionDataKeys = withRls(
    notAudited(
        kernelSchema.table(
            'region_data_keys',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** set by trigger: the region's path */
                orgPath: ltree('org_path').notNull().default(''),
                /** which key-encryption key wrapped it (`FIELD_KEYS` id) */
                kekId: text('kek_id').notNull(),
                wrapped: bytea('wrapped').notNull(),
                /** the key new values are encrypted with; an older one still decrypts what it encrypted */
                active: boolean('active').notNull().default(true)
            },
            (t) => [
                uniqueIndex('region_data_keys_active_uq')
                    .on(t.regionId)
                    .where(sql`active`)
            ]
        ),
        'key material: written only by kernel.ensure_region_data_key, which writes its own audit event'
    ),
    'config'
);
