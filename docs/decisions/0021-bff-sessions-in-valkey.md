# ADR 0021: BFF sessions stored server-side in Valkey

* Status: accepted (2026-10-18). It **amends ADR-0004**: there, tokens were to be kept in an encrypted httpOnly cookie.

## Context
Keycloak access, refresh and ID tokens carry role and group-path claims. Together, encrypted, they exceed the 4 KB browser
cookie limit for users with several units. Cookie-held sessions also cannot be revoked server-side ("sign out everywhere",
or disabling a user immediately).

## Decision
* The Next.js server runs the OIDC code flow with PKCE using **openid-client 6** (MIT).
* The browser gets only an **opaque session id** cookie: `__Host-itrms_sid`, httpOnly, Secure, SameSite=Lax, 128-bit random.
* The session record lives in **Valkey**: user id, active unit, tokens encrypted with AES-256-GCM (key from Compose
  secrets), idle timeout 30 minutes, absolute timeout 12 hours. It is refreshed on use, and the refresh token rotates.
* Sign-out deletes the record and calls Keycloak's end-session endpoint. Keycloak back-channel logout deletes the session
  record too.
* CSRF: SameSite=Lax plus a double-submit token on state-changing BFF routes.

## Consequences
* Valkey now holds sessions. Losing it signs everyone out, which is acceptable, and it still needs no backup (ADR-0005).
* Tokens never reach browser JavaScript, as ADR-0004 requires.

## Licences
openid-client: MIT. Valkey: BSD-3.
