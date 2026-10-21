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

/** The permissions a set of roles grants together. */
export function permissionsOf(roles: RolePermissions, held: readonly string[]): ReadonlySet<string> {
    const permissions = new Set<string>();
    for (const role of held) for (const permission of roles.get(role) ?? []) permissions.add(permission);
    return permissions;
}
