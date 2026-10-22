/**
 * @itrms/kernel/iam: who may call what (security.md §6, ADR-0031). `@Require` / `@SignedIn` / `@Public` on every handler,
 * the default-deny guard, the Keycloak authenticator, the role registry from the manifests, users and role assignments.
 */
export {
    AccessGuard,
    AUTHENTICATOR,
    currentPrincipal,
    Public,
    Require,
    requestDbContext,
    RouteInventory,
    SignedIn,
    unmarkedRoutes,
    type Authenticator,
    type Principal
} from './access';
export { OidcAuthenticator, type OidcOptions } from './oidc-authenticator';
export { permissionsOf, rolePermissions, type RolePermissions } from './roles';
// granting and revoking are the IamController's alone (they hold the delegation rules); seeds use @itrms/kernel/seed
export { assignmentsOf, type Grant, type RoleAssignment, type User } from './assignments';
export { IamController } from './iam.controller';
export {
    allowed,
    effectiveMenu,
    type Catalogues,
    type EffectiveMenuGroup,
    type EffectiveMenuItem,
    type MenuContext
} from './menu';
export { SHELL, type Shell } from './shell';
export { syncIdentity, type IdentityAdmin, type IdentityMember, type IdentityUnit } from './identity-admin';
export * from './iam.table';
