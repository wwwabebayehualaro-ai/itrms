/**
 * Granting and revoking roles (roles-and-permissions.md §3, security.md SEC-AC-7). A role is granted in a unit only
 * - if the unit's type lists it in its role catalogue, and only inside the granter's subtree (RLS: class T);
 * - never to oneself (an administrator cannot give themselves cashier and finance rights);
 * - if the catalogue marks it not delegable (`bureau_admin`, `unit_admin` in the seeds), only by a bureau admin;
 * - `unit_admin` only in a unit below the granter's own (never at their own level or above, §3.6);
 * - from now on, never backdated (it would rewrite who held a role when).
 * Revoking follows the same rules, never ends one's own assignment, and never the region's last bureau admin.
 * A revocation ends the assignment; nothing is deleted.
 *
 * Maker-checker (SEC-AC-6, task 0.21e): an administrator only asks for a grant; it takes effect when a second
 * administrator with authority over the unit confirms it (in a small office, one of a unit above: their subtree holds
 * it, ADR-0031). The checker is never the maker nor the person granted, every rule is checked again with the checker's
 * authority, and a request not decided within REQUEST_DAYS can only be refused. A revocation takes rights away and needs
 * no second person: one administrator ends an assignment at once.
 */
import { and, asc, count, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import type { Principal } from '../context';
import { insertAudited, updateAudited } from '../db/audit';
import type { Tx } from '../db/types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldError } from '../errors';
import { emit } from '../outbox/outbox';
import { withinScope } from '../org/org-admin.service';
import { findUnitByCode, getUnit, type OrgUnit } from '../org/org-tree';
import { orgUnits, unitTypeRoles } from '../org/org.table';
import { roleAssignments, roleGrantRequests, users } from './iam.table';

export type RoleAssignment = typeof roleAssignments.$inferSelect;
export type User = typeof users.$inferSelect;
export type RoleGrantRequest = typeof roleGrantRequests.$inferSelect;

/** How long a grant request waits for its confirmation. */
export const REQUEST_DAYS = 14;

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

/** Whether this granter may give this grant now: who, where, which role, from when. */
async function checkGrant(tx: Tx, granter: Granter | typeof INSTALLER, grant: Grant): Promise<OrgUnit> {
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
    return unit;
}

/** Grants at once: the installation's seeds, and a confirmed request (`requestedBy`: who asked for it). */
async function grantRole(
    tx: Tx,
    granter: Granter | typeof INSTALLER,
    grant: Grant,
    requestedBy?: string | null
): Promise<RoleAssignment> {
    const unit = await checkGrant(tx, granter, grant);
    try {
        const assignment = await insertAudited(tx, roleAssignments, {
            regionId: unit.regionId,
            userId: grant.userId,
            unitId: grant.unitId,
            roleKey: grant.roleKey,
            // the database's clock, not this process's: validity is checked against now() in the database
            ...(grant.validFrom ? { validFrom: grant.validFrom } : {}),
            validTo: grant.validTo ?? null,
            grantedBy: requestedBy !== undefined ? requestedBy : granter === INSTALLER ? null : granter.userId,
            confirmedBy: granter === INSTALLER ? null : granter.userId,
            reason: grant.reason
        });
        await assignmentChanged(tx, assignment, 'granted');
        return assignment;
    } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === '23505') throw alreadyHeld();
        throw error;
    }
}

/** Whether the person holds the role in the unit (an assignment open now or later). */
async function holds(tx: Tx, userId: string, unitId: string, roleKey: string): Promise<boolean> {
    const [open] = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
            and(
                eq(roleAssignments.userId, userId),
                eq(roleAssignments.unitId, unitId),
                eq(roleAssignments.roleKey, roleKey),
                or(isNull(roleAssignments.validTo), gt(roleAssignments.validTo, sql`now()`))
            )
        );
    return open !== undefined;
}

function alreadyHeld(): ConflictError {
    return new ConflictError('duplicate_reference', { detail: 'The person already holds this role here.' });
}

/** Asks for a grant (the maker): refused now if the maker could not give it, else it waits for a second administrator. */
export async function requestGrant(tx: Tx, maker: Granter, grant: Grant): Promise<RoleGrantRequest> {
    const unit = await checkGrant(tx, maker, grant);
    if (await holds(tx, grant.userId, grant.unitId, grant.roleKey)) throw alreadyHeld();
    // one left past its time can no longer be confirmed: it is closed as expired, so asking again is possible
    const stale = await tx
        .select({ id: roleGrantRequests.id, version: roleGrantRequests.rowVersion })
        .from(roleGrantRequests)
        .where(
            and(
                eq(roleGrantRequests.userId, grant.userId),
                eq(roleGrantRequests.unitId, grant.unitId),
                eq(roleGrantRequests.roleKey, grant.roleKey),
                eq(roleGrantRequests.state, 'pending'),
                sql`${roleGrantRequests.createdAt} <= now() - make_interval(days => ${REQUEST_DAYS})`
            )
        );
    for (const old of stale)
        await updateAudited(tx, roleGrantRequests, old.id, old.version, {
            state: 'expired',
            decidedAt: sql`now()` as unknown as Date
        });
    try {
        return await insertAudited(tx, roleGrantRequests, {
            regionId: unit.regionId,
            userId: grant.userId,
            unitId: grant.unitId,
            roleKey: grant.roleKey,
            validFrom: grant.validFrom ?? null,
            validTo: grant.validTo ?? null,
            reason: grant.reason
        });
    } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === '23505')
            throw new ConflictError('duplicate_reference', {
                detail: 'This grant is already waiting for confirmation.'
            });
        throw error;
    }
}

/** A request still waiting, with what the database's clock says of it. */
async function pendingRequest(tx: Tx, id: string) {
    const [row] = await tx
        .select({
            request: roleGrantRequests,
            expired: sql<boolean>`${roleGrantRequests.createdAt} <= now() - make_interval(days => ${REQUEST_DAYS})`,
            started: sql<boolean>`coalesce(${roleGrantRequests.validFrom} <= now(), true)`,
            ended: sql<boolean>`coalesce(${roleGrantRequests.validTo} <= now(), false)`
        })
        .from(roleGrantRequests)
        .where(eq(roleGrantRequests.id, id));
    if (!row) throw new NotFoundError();
    if (row.request.state !== 'pending')
        throw new ConflictError('invalid_transition', { detail: `The request is already ${row.request.state}.` });
    return row;
}

/** Confirms a request (the checker): every rule again, with the checker's authority; the assignment names both. */
export async function confirmGrant(
    tx: Tx,
    checker: Granter,
    id: string,
    version: number
): Promise<{ request: RoleGrantRequest; assignment: RoleAssignment }> {
    const { request, expired, started, ended } = await pendingRequest(tx, id);
    // maker ≠ checker: whoever asked cannot also confirm (SEC-AC-6)
    if (request.createdBy === checker.userId) refuse('own_request');
    if (expired)
        throw new ConflictError('invalid_transition', {
            detail: `The request waited more than ${REQUEST_DAYS} days: ask for the grant again.`
        });
    if (ended) throw new ConflictError('invalid_transition', { detail: 'The period asked for has already ended.' });
    if (await holds(tx, request.userId, request.unitId, request.roleKey)) throw alreadyHeld();
    const assignment = await grantRole(
        tx,
        checker,
        {
            userId: request.userId,
            unitId: request.unitId,
            roleKey: request.roleKey,
            // a start asked for that has passed while the request waited: from now
            validFrom: started ? undefined : (request.validFrom ?? undefined),
            validTo: request.validTo,
            reason: request.reason
        },
        request.createdBy
    );
    const decided = await updateAudited(tx, roleGrantRequests, id, version, {
        state: 'confirmed',
        decidedBy: checker.userId,
        decidedAt: sql`now()` as unknown as Date,
        assignmentId: assignment.id
    });
    return { request: decided, assignment };
}

/** Refuses a request (another administrator with authority over it), or withdraws it (the one who asked). */
export async function rejectGrant(
    tx: Tx,
    actor: Granter,
    id: string,
    version: number,
    reason: string
): Promise<RoleGrantRequest> {
    const { request } = await pendingRequest(tx, id);
    const own = request.createdBy === actor.userId;
    if (!own) {
        if (request.userId === actor.userId) refuse('self_grant');
        await checkAuthority(tx, actor, await getUnit(tx, request.unitId), request.roleKey);
    }
    return updateAudited(tx, roleGrantRequests, id, version, {
        state: own ? 'withdrawn' : 'rejected',
        decidedBy: actor.userId,
        decidedAt: sql`now()` as unknown as Date,
        decisionReason: reason
    });
}

/** The grant requests waiting in the caller's scope (RLS: the subtree), oldest first, with whom they name. */
export async function pendingRequests(tx: Tx, unitId?: string) {
    const maker = alias(users, 'maker');
    return tx
        .select({
            id: roleGrantRequests.id,
            userId: roleGrantRequests.userId,
            displayName: users.displayName,
            username: users.username,
            unitId: roleGrantRequests.unitId,
            unitCode: orgUnits.code,
            unitName: orgUnits.name,
            roleKey: roleGrantRequests.roleKey,
            validFrom: roleGrantRequests.validFrom,
            validTo: roleGrantRequests.validTo,
            reason: roleGrantRequests.reason,
            requestedBy: roleGrantRequests.createdBy,
            requestedByName: maker.displayName,
            requestedAt: roleGrantRequests.createdAt,
            expiresAt: sql<string>`${roleGrantRequests.createdAt} + make_interval(days => ${REQUEST_DAYS})`,
            version: roleGrantRequests.rowVersion
        })
        .from(roleGrantRequests)
        .innerJoin(users, eq(users.id, roleGrantRequests.userId))
        .innerJoin(orgUnits, eq(orgUnits.id, roleGrantRequests.unitId))
        .leftJoin(maker, eq(maker.id, roleGrantRequests.createdBy))
        .where(and(eq(roleGrantRequests.state, 'pending'), unitId ? eq(roleGrantRequests.unitId, unitId) : undefined))
        .orderBy(asc(roleGrantRequests.createdAt), asc(roleGrantRequests.id));
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
