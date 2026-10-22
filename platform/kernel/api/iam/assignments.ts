/**
 * Granting and revoking roles (roles-and-permissions.md §3, security.md SEC-AC-7). A role is granted in a unit only
 * - if the unit's type lists it in its role catalogue, and only inside the granter's subtree (RLS: class T);
 * - never to oneself (an administrator cannot give themselves cashier and finance rights);
 * - if the catalogue marks it not delegable (`bureau_admin`, `unit_admin` in the seeds), only by a bureau admin;
 * - `unit_admin` only in a unit below the granter's own (never at their own level or above, §3.6);
 * - from now on, never backdated (it would rewrite who held a role when).
 * Revoking follows the same rules, never ends one's own assignment, and never the region's last bureau admin.
 * A revocation ends the assignment; nothing is deleted. Maker-checker on grants (SEC-AC-6) comes with configuration
 * publication (task 0.21).
 */
import { and, asc, count, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Principal } from '../context';
import { insertAudited, updateAudited } from '../db/audit';
import type { Tx } from '../db/types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldError } from '../errors';
import { emit } from '../outbox/outbox';
import { withinScope } from '../org/org-admin.service';
import { findUnitByCode, getUnit, type OrgUnit } from '../org/org-tree';
import { orgUnits, unitTypeRoles } from '../org/org.table';
import { roleAssignments, users } from './iam.table';

export type RoleAssignment = typeof roleAssignments.$inferSelect;
export type User = typeof users.$inferSelect;

const invalid = (path: string, code: string, message: string): never => {
    throw new ValidationError('validation_failed', { errors: [{ path, code, message }] satisfies FieldError[] });
};
const refuse = (reason: string): never => {
    throw new ForbiddenError({ audit: { reason } });
};

export interface Grant {
    userId: string;
    unitId: string;
    roleKey: string;
    validFrom?: Date;
    validTo?: Date | null;
    reason: string;
}

/** Who grants or revokes: the signed-in administrator. */
export type Granter = Pick<Principal, 'roles' | 'userId' | 'scopePath'>;

/** The installation step (seeds), which acts as the bureau; kept out of the public entry (`@itrms/kernel/seed`). */
export const INSTALLER: unique symbol = Symbol('kernel.installer');

const isBureauAdmin = (granter: Granter | typeof INSTALLER) =>
    granter === INSTALLER || granter.roles.includes('bureau_admin');

/** May this granter hand out or take back this role in this unit? */
async function checkAuthority(tx: Tx, granter: Granter | typeof INSTALLER, unit: OrgUnit, roleKey: string) {
    const [listed] = unit.unitTypeId
        ? await tx
              .select({ delegable: unitTypeRoles.delegable })
              .from(unitTypeRoles)
              .where(and(eq(unitTypeRoles.unitTypeId, unit.unitTypeId), eq(unitTypeRoles.roleKey, roleKey)))
        : [];
    if (!listed) return invalid('roleKey', 'role_not_in_unit_type', `"${roleKey}" is not a role of this unit's type`);
    if (isBureauAdmin(granter)) return;
    if (roleKey === 'bureau_admin' || !listed.delegable) refuse('role_not_delegable');
    if (
        granter !== INSTALLER &&
        roleKey === 'unit_admin' &&
        (unit.path === granter.scopePath || !withinScope(unit.path, granter.scopePath))
    )
        refuse('unit_admin_at_own_level');
}

export async function grantRole(tx: Tx, granter: Granter | typeof INSTALLER, grant: Grant) {
    if (granter !== INSTALLER && granter.userId === grant.userId) refuse('self_grant');
    const unit = await getUnit(tx, grant.unitId);
    if (!unit.active) invalid('unitId', 'unit_inactive', 'the unit is deactivated');
    await checkAuthority(tx, granter, unit, grant.roleKey);
    const [user] = await tx.select().from(users).where(eq(users.id, grant.userId));
    if (!user || !user.active || user.regionId !== unit.regionId) throw new NotFoundError();
    if (grant.validFrom) {
        // against the database's clock, with a minute for the difference between clocks
        const [{ past } = { past: false }] = await tx
            .execute<{ past: boolean }>(
                sql`select ${grant.validFrom.toISOString()}::timestamptz < now() - interval '1 minute' as past`
            )
            .then((r) => r.rows);
        if (past) invalid('validFrom', 'backdated', 'an assignment starts now or later');
    }
    try {
        const assignment = await insertAudited(tx, roleAssignments, {
            regionId: unit.regionId,
            userId: grant.userId,
            unitId: grant.unitId,
            roleKey: grant.roleKey,
            // the database's clock, not this process's: validity is checked against now() in the database
            ...(grant.validFrom ? { validFrom: grant.validFrom } : {}),
            validTo: grant.validTo ?? null,
            grantedBy: granter === INSTALLER ? null : granter.userId,
            reason: grant.reason
        });
        await assignmentChanged(tx, assignment, 'granted');
        return assignment;
    } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === '23505')
            throw new ConflictError('duplicate_reference', { detail: 'The person already holds this role here.' });
        throw error;
    }
}

/** Ends an assignment now (one that has not started yet ends before it starts). */
export async function revokeRole(tx: Tx, revoker: Granter, id: string, version: number): Promise<RoleAssignment> {
    const [current] = await tx.select().from(roleAssignments).where(eq(roleAssignments.id, id));
    if (!current) throw new NotFoundError();
    if (current.userId === revoker.userId) refuse('self_revoke');
    await checkAuthority(tx, revoker, await getUnit(tx, current.unitId), current.roleKey);
    const [{ ended } = { ended: false }] = await tx
        .select({ ended: sql<boolean>`${roleAssignments.validTo} is not null and ${roleAssignments.validTo} <= now()` })
        .from(roleAssignments)
        .where(eq(roleAssignments.id, id));
    if (ended) throw new ConflictError('invalid_transition', { detail: 'The assignment has already ended.' });
    if (current.roleKey === 'bureau_admin') {
        const [{ open } = { open: 0 }] = await tx
            .select({ open: count() })
            .from(roleAssignments)
            .where(
                and(
                    eq(roleAssignments.regionId, current.regionId),
                    eq(roleAssignments.roleKey, 'bureau_admin'),
                    or(isNull(roleAssignments.validTo), gt(roleAssignments.validTo, sql`now()`))
                )
            );
        if (open <= 1)
            throw new ConflictError('invalid_transition', { detail: 'The region would have no bureau administrator.' });
    }
    // ended by the database's clock, which the next request's check reads
    const revoked = await updateAudited(tx, roleAssignments, id, version, {
        validTo: sql`greatest(now(), ${roleAssignments.validFrom})` as unknown as Date
    });
    await assignmentChanged(tx, revoked, 'revoked');
    return revoked;
}

/** The identity provider mirrors who belongs to which unit (group membership): the worker updates it from this event. */
async function assignmentChanged(tx: Tx, a: RoleAssignment, change: 'granted' | 'revoked') {
    await emit(
        tx,
        'role-assignment.changed.v1',
        { assignmentId: a.id, userId: a.userId, unitId: a.unitId, change },
        { unitId: a.unitId, regionId: a.regionId }
    );
}

/** The open assignments of a unit, with who holds them. */
export async function assignmentsOf(tx: Tx, unitId: string) {
    return tx
        .select({
            id: roleAssignments.id,
            userId: roleAssignments.userId,
            displayName: users.displayName,
            username: users.username,
            roleKey: roleAssignments.roleKey,
            validFrom: roleAssignments.validFrom,
            validTo: roleAssignments.validTo,
            reason: roleAssignments.reason,
            version: roleAssignments.rowVersion
        })
        .from(roleAssignments)
        .innerJoin(users, eq(users.id, roleAssignments.userId))
        .where(
            and(
                eq(roleAssignments.unitId, unitId),
                or(isNull(roleAssignments.validTo), gt(roleAssignments.validTo, sql`now()`))
            )
        )
        .orderBy(asc(users.displayName), asc(roleAssignments.roleKey));
}

const USERNAME = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, 'lower-case letters, digits and . _ -');

/** Seed users and their roles (generated people, never real ones): `seed users <file.yaml>`. */
export const userImportSchema = z.strictObject({
    region: z.string().min(1),
    users: z.array(
        z.strictObject({
            username: USERNAME,
            displayName: z.string().min(1).max(120),
            keycloakSub: z.uuid(),
            home: z.string().min(1),
            roles: z.array(z.strictObject({ unit: z.string().min(1), role: z.string().min(1) })).default([])
        })
    )
});
export type UserImport = z.output<typeof userImportSchema>;

/** Creates the users and grants their roles; what exists already is left as it is (idempotent). Installer only. */
export async function importUsers(tx: Tx, doc: UserImport) {
    const [region] = await tx
        .select()
        .from(orgUnits)
        .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, doc.region)));
    if (!region) return invalid('region', 'unknown_region', `no region has the code ${doc.region}`);
    const created = { users: 0, assignments: 0 };
    for (const [i, input] of doc.users.entries()) {
        const home = await findUnitByCode(tx, region.id, input.home);
        if (!home) return invalid(`users.${i}.home`, 'unknown_unit', `no unit has the code ${input.home}`);
        let [user] = await tx.select().from(users).where(eq(users.keycloakSub, input.keycloakSub));
        if (!user) {
            user = await insertAudited(tx, users, {
                regionId: region.id,
                homeUnitId: home.id,
                keycloakSub: input.keycloakSub,
                username: input.username,
                displayName: input.displayName
            });
            created.users++;
        }
        for (const [j, role] of input.roles.entries()) {
            const unit = await findUnitByCode(tx, region.id, role.unit);
            if (!unit)
                return invalid(`users.${i}.roles.${j}.unit`, 'unknown_unit', `no unit has the code ${role.unit}`);
            const [open] = await tx
                .select({ id: roleAssignments.id })
                .from(roleAssignments)
                .where(
                    and(
                        eq(roleAssignments.userId, user.id),
                        eq(roleAssignments.unitId, unit.id),
                        eq(roleAssignments.roleKey, role.role),
                        isNull(roleAssignments.validTo)
                    )
                );
            if (open) continue;
            await grantRole(tx, INSTALLER, {
                userId: user.id,
                unitId: unit.id,
                roleKey: role.role,
                reason: 'seed'
            });
            created.assignments++;
        }
    }
    return created;
}
