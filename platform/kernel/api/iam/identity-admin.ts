/**
 * The identity provider's administration, as far as ITRMS needs it (ADR-0004): every org unit mirrored as a Keycloak group,
 * nested like the tree, and each person a member of the units they hold a role in, so the realm's administrators see who
 * belongs where. Groups never decide access: roles come from `role_assignments` alone (ADR-0031). The Keycloak adapter is
 * in `@itrms/integrations`; the worker runs the sync from the outbox (task 0.11), the seed runs it on demand.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '../db/types';

export interface IdentityUnit {
    id: string;
    /** The group's name: unique among its siblings, like the unit's code. */
    code: string;
    parentId: string | null;
    /** The unit's name in the region's first language, for the group's attributes. */
    name: string;
}

export interface IdentityMember {
    keycloakSub: string;
    unitIds: readonly string[];
}

export interface IdentityAdmin {
    /** Creates, renames and moves groups to mirror the units (parents before children). Never deletes a group. */
    syncUnits(units: readonly IdentityUnit[]): Promise<{ created: number; updated: number }>;
    /** Makes the person's unit groups exactly `unitIds`; groups that mirror no unit are left alone. */
    syncMemberships(member: IdentityMember): Promise<void>;
}

interface UnitRow extends Record<string, unknown> {
    id: string;
    code: string;
    parent_id: string | null;
    name: Record<string, string>;
}

interface MemberRow extends Record<string, unknown> {
    keycloak_sub: string;
    unit_ids: string[];
}

/** What the identity provider must mirror: the active units (parents first) and each person's units. */
export interface IdentitySnapshot {
    units: IdentityUnit[];
    members: IdentityMember[];
}

/**
 * Reads the active org tree and the open role assignments of every region, so it runs only where RLS does not apply: the
 * seed (the owner role) or the worker's system context. Read first, then applied with the transaction closed: the
 * identity provider's calls take time, and no transaction waits on them.
 */
export async function identitySnapshot(tx: Tx): Promise<IdentitySnapshot> {
    const units = await tx.execute<UnitRow>(
        sql`select id, code, parent_id, name from kernel.org_units where active order by nlevel(path), code`
    );
    const members = await tx.execute<MemberRow>(sql`
        select u.keycloak_sub, coalesce(array_agg(distinct a.unit_id::text) filter (where a.id is not null), '{}') as unit_ids
          from kernel.users u
          left join kernel.role_assignments a
            on a.user_id = u.id and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now())
         where u.keycloak_sub is not null and u.active
         group by u.keycloak_sub`);
    return {
        units: units.rows.map((u) => ({
            id: u.id,
            code: u.code,
            parentId: u.parent_id,
            name: u.name.am ?? u.name.en ?? Object.values(u.name)[0] ?? u.code
        })),
        members: members.rows.map((m) => ({ keycloakSub: m.keycloak_sub, unitIds: m.unit_ids }))
    };
}

/** Makes the identity provider mirror a snapshot. */
export async function applyIdentity(
    admin: IdentityAdmin,
    snapshot: IdentitySnapshot
): Promise<{ units: number; members: number }> {
    await admin.syncUnits(snapshot.units);
    for (const member of snapshot.members) await admin.syncMemberships(member);
    return { units: snapshot.units.length, members: snapshot.members.length };
}

/** Both at once, for the seed command (one installer transaction). */
export async function syncIdentity(tx: Tx, admin: IdentityAdmin): Promise<{ units: number; members: number }> {
    return applyIdentity(admin, await identitySnapshot(tx));
}
