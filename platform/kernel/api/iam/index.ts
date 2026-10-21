/**
 * @itrms/kernel/iam: who may call what (security.md §6). `@Require` / `@Public` on every handler, the default-deny guard and
 * the caller's principal. Keycloak sign-in and `role_assignments` arrive in task 0.10 as an Authenticator.
 */
export {
    AccessGuard,
    AUTHENTICATOR,
    Public,
    Require,
    requestDbContext,
    RouteInventory,
    unmarkedRoutes,
    type Authenticator,
    type Principal
} from './access';
