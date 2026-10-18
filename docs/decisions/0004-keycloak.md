# ADR 0004: Keycloak for identity, 2FA and org-unit groups

* Status: accepted (2026-10-17, fixed)

## Context
Government staff need strong authentication and user administration delegated per zone and woreda, and ITRMS should not
handle passwords itself. The legacy backend had its own JWT, refresh and argon2 implementation.

## Decision
* **Keycloak**, with one realm per installation. The Next.js server (BFF) runs the OIDC authorization code flow with PKCE,
  and tokens stay server-side (amended by [ADR-0021](0021-bff-sessions-in-valkey.md): an opaque session cookie + a session
  store in Valkey).
* **2FA is required for staff**: TOTP, with WebAuthn optional.
* Org units are mirrored as **Keycloak groups**. ITRMS is the source of truth and syncs them through the Admin API.
  **Authorization comes from ITRMS `role_assignments` (user × unit × role)**, not from token role claims (ADR-0031).
* In the API, a global **AuthGuard** verifies the JWT against the realm's JWKS. A **PermissionGuard**
  (`@Require('res:action')`) and a **unit-scope check** run on every route.
* Routes are denied by default: a route without `@Require` or `@Public` fails a startup test.

## Consequences
* Keycloak runs in the Compose stack with its own database, and its realm export is part of the backups.
* The sign-in, 2FA and password-reset screens are a Keycloak theme with Amharic and English messages and an Ethiopic font.
* User administration in ITRMS calls Keycloak, and a zone admin manages only the users of their own subtree.

## Licences
Keycloak: Apache-2.0. `jose`: MIT. SMS OTP needs a third-party extension, so check its licence before adopting one. TOTP is
preferred.
