/**
 * Who may do what (ADR-0031, roles-and-permissions.md): `users` mirrors the Keycloak accounts (identity only: Keycloak
 * signs people in; nothing in a token decides what they may do), and `role_assignments` is the only source of
 * authorization: a user holds a role in a unit, from a date, until a date, granted by someone for a reason. A revocation
 * ends the assignment (`valid_to`), it is never deleted.
 *
 * users: class R (the region reads the names; the home unit's subtree administers them).
 * role_assignments: class T (the unit's subtree).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { audited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { baseColumns, ltree } from '../db/columns';
import { withRls } from '../db/rls';
import { orgUnits } from '../org/org.table';

export const users = withRls(
    audited(
        kernelSchema.table(
            'users',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                homeUnitId: uuid('home_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the home unit */
                handlingOrgPath: ltree('handling_org_path').notNull().default(''),
                /** the Keycloak account (`sub`); one ITRMS user per account */
                keycloakSub: text('keycloak_sub').notNull(),
                username: text('username').notNull(),
                /** the name shown in the application; the person's legal names are a person record's (task 0.14) */
                displayName: text('display_name').notNull(),
                active: boolean('active').notNull().default(true)
            },
            (t) => [
                uniqueIndex('users_keycloak_sub_uq').on(t.keycloakSub),
                uniqueIndex('users_username_uq').on(t.username)
            ]
        )
    ),
    'registry'
);

export const roleAssignments = withRls(
    audited(
        kernelSchema.table(
            'role_assignments',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                userId: uuid('user_id')
                    .notNull()
                    .references(() => users.id),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                roleKey: text('role_key').notNull(),
                validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
                validTo: timestamp('valid_to', { withTimezone: true }),
                grantedBy: uuid('granted_by'),
                reason: text('reason').notNull()
            },
            (t) => [
                index('role_assignments_user_idx').on(t.userId, t.unitId),
                index('role_assignments_unit_idx').on(t.unitId),
                // one open assignment of a role per user and unit; a revoked one may be granted again
                uniqueIndex('role_assignments_open_uq')
                    .on(t.userId, t.unitId, t.roleKey)
                    .where(sql`valid_to is null`)
            ]
        )
    ),
    'transaction'
);
