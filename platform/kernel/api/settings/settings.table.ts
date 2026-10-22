/**
 * Settings a region chooses (architecture.md §6; the configuration inheritance of task 0.21 adds unit overrides): one
 * value per (region, key), for the keys the installed manifests declare overridable at the region. Class C: the region
 * reads them; writing needs a seat at the region (its root's scope).
 */
import { jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { audited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { baseColumns, ltree } from '../db/columns';
import { withRls } from '../db/rls';

export const settingsValues = withRls(
    audited(
        kernelSchema.table(
            'settings_values',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** set by trigger: the region's path */
                orgPath: ltree('org_path').notNull().default(''),
                key: text('key').notNull(),
                value: jsonb('value').notNull()
            },
            (t) => [uniqueIndex('settings_values_region_key_uq').on(t.regionId, t.key)]
        )
    ),
    'config'
);
