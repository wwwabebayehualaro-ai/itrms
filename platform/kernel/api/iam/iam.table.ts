/**
 * Who may do what (ADR-0031, roles-and-permissions.md): `users` mirrors the Keycloak accounts (identity only: Keycloak
 * signs people in; nothing in a token decides what they may do), and `role_assignments` is the only source of
 * authorization: a user holds a role in a unit, from a date, until a date, granted by someone for a reason. A revocation
 * ends the assignment (`valid_to`), it is never deleted.
 *
 * users: class R (the region reads the names; the home unit's subtree administers them).
 * role_assignments: class T (the unit's subtree).
 * role_grant_requests: class T. A grant is asked for by one administrator and takes effect only when a second one
 * confirms it (security.md SEC-AC-6): the assignment then names both (`granted_by` asked, `confirmed_by` confirmed).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
                /**
                 * The person's own display preferences (language, calendar, favourites, recents), so they follow them between
                 * PCs. Written only through kernel.set_my_preferences(): a person changes their own, nobody else's.
                 */
                preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
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
                /** who asked for the grant (null: the installation's seeds) */
                grantedBy: uuid('granted_by'),
                /** the second administrator who confirmed it (SEC-AC-6; null: seeds, and grants made before task 0.21e) */
                confirmedBy: uuid('confirmed_by'),
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

export const GRANT_REQUEST_STATES = ['pending', 'confirmed', 'rejected', 'withdrawn', 'expired'] as const;
export type GrantRequestState = (typeof GRANT_REQUEST_STATES)[number];

/** A role grant waiting for a second administrator (who asked: `created_by`). Decided once, never deleted. */
export const roleGrantRequests = withRls(
    audited(
        kernelSchema.table(
            'role_grant_requests',
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
                /** the start asked for (null: when it is confirmed) */
                validFrom: timestamp('valid_from', { withTimezone: true }),
                validTo: timestamp('valid_to', { withTimezone: true }),
                reason: text('reason').notNull(),
                state: text('state').$type<GrantRequestState>().notNull().default('pending'),
                decidedBy: uuid('decided_by'),
                decidedAt: timestamp('decided_at', { withTimezone: true }),
                decisionReason: text('decision_reason'),
                /** the assignment a confirmation made */
                assignmentId: uuid('assignment_id').references(() => roleAssignments.id)
            },
            (t) => [
                index('role_grant_requests_unit_idx').on(t.unitId, t.state),
                // one request waiting per person, unit and role
                uniqueIndex('role_grant_requests_pending_uq')
                    .on(t.userId, t.unitId, t.roleKey)
                    .where(sql`state = 'pending'`)
            ]
        )
    ),
    'transaction'
);
