/**
 * The role registry: what each role grants, from the installed modules' manifests (ADR-0027; the loader has checked every
 * granted permission exists). A role no installed module defines grants nothing.
 */
import type { ModuleManifest } from '@itrms/module-sdk';

export type RolePermissions = ReadonlyMap<string, ReadonlySet<string>>;

export function rolePermissions(manifests: readonly ModuleManifest[]): RolePermissions {
    const roles = new Map<string, Set<string>>();
    for (const manifest of manifests)
        for (const [role, permissions] of Object.entries(manifest.roles)) {
            const granted = roles.get(role) ?? new Set<string>();
            for (const permission of permissions) granted.add(permission);
            roles.set(role, granted);
        }
    return roles;
}

/** A permission a module adds to another module's role, on where its setting is (ADR-0065). */
export interface RoleGrant {
    role: string;
    permissions: readonly string[];
    setting: string;
}

/** The installed modules' role grants. */
export const roleGrantsOf = (manifests: readonly ModuleManifest[]): RoleGrant[] =>
    manifests.flatMap((m) => m.roleGrants);

/**
 * What the grants add for a person holding `held` in a unit: each grant of a held role whose setting is true there. Nothing is
 * read when no held role has a grant. A value that is not `true` (a missing or broken one too) grants nothing.
 */
export async function grantedPermissions(
    grants: readonly RoleGrant[],
    held: readonly string[],
    enabled: (setting: string) => Promise<unknown>
): Promise<ReadonlySet<string>> {
    const granted = new Set<string>();
    for (const grant of grants)
        if (held.includes(grant.role) && (await enabled(grant.setting)) === true)
            for (const permission of grant.permissions) granted.add(permission);
    return granted;
}

/** The permissions a set of roles grants together. */
export function permissionsOf(roles: RolePermissions, held: readonly string[]): ReadonlySet<string> {
    const permissions = new Set<string>();
    for (const role of held) for (const permission of roles.get(role) ?? []) permissions.add(permission);
    return permissions;
}
