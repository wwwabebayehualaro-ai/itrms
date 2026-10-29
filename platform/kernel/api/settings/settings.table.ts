/**
 * The values chosen for settings (ADR-0026, org-and-unit-types.md §4; task 0.21a), for the keys the installed manifests
 * declare overridable at that level: one value per (unit, key), a unit's own (the region's when the unit is its root),
 * or per (unit type, key), the region's value for every unit of a type, kept on the region's root. Class C on the unit's
 * path: the units above read it (the admin screen shows what a unit inherits), writing needs a seat at the unit or above;
 * a unit type's value is the region's choice, so only a seat at the root writes it. The installation's values are its
 * configuration (`INSTALLATION_SETTINGS`), a person's own their preferences (`users.preferences`).
 */
import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';

import { audited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { baseColumns, ltree } from '../db/columns';
import { withRls } from '../db/rls';
import { orgUnits, unitTypes } from '../org/org.table';

export const settingsValues = withRls(
    audited(
        kernelSchema.table(
            'settings_values',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** set by trigger: the unit's path */
                orgPath: ltree('org_path').notNull().default(''),
                /** the unit whose value it is; for a unit type's value, the region's root */
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set for the region's value for every unit of this type */
                unitTypeId: uuid('unit_type_id'),
                key: text('key').notNull(),
                value: jsonb('value').notNull()
            },
            (t) => [
                unique('settings_values_scope_key_uq').on(t.unitId, t.unitTypeId, t.key).nullsNotDistinct(),
                foreignKey({
                    name: 'settings_values_unit_type_fk',
                    columns: [t.unitTypeId, t.regionId],
                    foreignColumns: [unitTypes.id, unitTypes.regionId]
                }),
                check('settings_values_unit_type_at_root', sql`${t.unitTypeId} is null or ${t.unitId} = ${t.regionId}`)
            ]
        )
    ),
    'config'
);
