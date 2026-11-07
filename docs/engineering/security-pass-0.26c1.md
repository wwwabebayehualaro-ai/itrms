# Security pass, Phase 0 (task 0.26c1)

2026-11-07. Two reviewers read the code against [security.md](../platform/security.md) and the
[threat model](threat-model.md). One covered authentication, sessions and the public verification. The other covered tenant
isolation (RLS) and files. Each finding below is fixed with a regression test, or recorded with a decision and a follow-up. A high-level code review of the fixes then corrected A1, A6, A10 and A11; this table shows their final form.
No high finding was raised.

| Id | Severity | Finding | Outcome |
|---|---|---|---|
| A1 | medium | The app's polling every minute restarted the 30-minute idle timeout (SEC-SE-2), and its token refreshes kept Keycloak's session alive | **Fixed.** The HTTP client marks every read made with no keyboard or pointer input in the last minute (`x-itrms-background`), whichever page or poll makes it, and the BFF does not restart the idle timeout for it. While the person types without making requests, a ping every few minutes (`/auth/activity`, CSRF-checked) keeps their session. Every sign-in asks for the credentials again (`prompt=login`), so a Keycloak session that refreshes kept alive never lets anyone in by itself. Tests: client and BFF unit tests. A browser idle warning is Phase 1. |
| A2 | medium | The audit rows never carried the client's address (SEC-LG-1) | **Fixed.** `request.ip`, from the trusted proxies, goes into the request context, the denial event, the sign-in lookup and the idempotency scope. The BFF's unit switch forwards it. Integration test: the denial row has the address. |
| A3 | medium | Self-service password reset by e-mail was on (SEC-ID-8) | **Fixed.** `resetPasswordAllowed: false`, so recovery is an administrator's, confirmed by a second one (`tools/keycloak-realm.test.mjs`). |
| A4 | low | Keycloak believed a client-written `X-Forwarded-For` | **Fixed.** The edge overwrites it with `$remote_addr`, and `KC_PROXY_TRUSTED_ADDRESSES` is set to the stack's subnet (exposure test). |
| A5 | low | On the verify host, the client chose the request id | **Fixed.** The edge sets `X-Request-Id` to its own `$request_id` (exposure test). |
| A6 | low | Verification tokens were written to the logs (SEC-SC-2) | **Fixed.** The API's logger masks the token in every path and logs a request as its method, path and peer. On the verify host, the access log writes both token paths (the QR's `/<token>` and the API's) as their route, and only critical errors are logged there, because an error line quotes the request (logger and exposure tests). |
| A7 | low | No session list and no "sign out everywhere" (SEC-SE-4) | **Decided: Phase 1** (follow-up). The idle timeout and back-channel logout cover Phase 0. |
| A8 | low | The verify host sent no COOP or CORP header | **Fixed.** Both are `same-origin`, always (exposure test). |
| A9 | low | TLS 1.2 still offered CBC suites | **Fixed.** ECDHE with AES-GCM or ChaCha20-Poly1305 only, on both hostnames (exposure test). |
| A10 | low | The last-bureau-administrator guard counted administrators who had not started yet, and two revocations racing each other could both pass | **Fixed.** A per-region advisory lock is taken before anything is read for the decision. The checks after it use `clock_timestamp()`, not the transaction's start. The revoker must still be in office after the lock. Integration test: when two administrators revoke each other at once, one gets 201 and the other 403. |
| A11 | low | The sessions' Valkey had no password and shared the stack's network | **Fixed** (production profile). A password, read from a file at start (never on the command line), and a `sessions` network shared with the BFF only. |
| F1 | low | `/files/:id` and its download check the unit's scope, not the record the file is linked to | **Decided: Phase 1** (follow-up). The ids are UUIDv7, RLS limits them to the unit's subtree, and `file:read` is held only by office staff. In Phase 1 a linked file is served only through its record's endpoint, after that record's read and field checks (ADR-0037). |
| F2 | low | The processes' S3 identity was an administrator | **Fixed** (production profile). Read, Write and List on the bucket only, and the bucket is made from inside the store. Smoke check: an object can be written and removed, and a new bucket is refused (403). |
| R1 | low | The audit log has no hash chain or signed digest, yet the threat model called it proven | **Decided: Phase 1** (ADR-0018, follow-up). Threat-model row 5 now says "partly in place". The restore drill compares the audit rows and an ordered digest (0.26b1). |
| R2 | low | Request code could give a counter not numbered by year a period, and so a new start at 1 | **Fixed.** Migration 0061: the trigger refuses it for the app's role. Integration test. |
| R3 | low | A role assignment or grant request could name a user of another region past the application | **Fixed.** Migration 0060: composite keys `(user_id, region_id) → users(id, region_id)`. Integration test. |

The reviewers also confirmed six open follow-ups. They are not fixed here: the administrators' phishing-resistant factor
and acr/amr checks (SEC-ID-2), `manage-users` on the identity-admin client, `resolve_principal` taking the subject from app
code, rate-limiting `access.denied` rows, per-user and per-IP API rate limits (SEC-AP-2), and Trusted Types in report-only
mode.

Each reviewer also recorded what they checked and found sound: the cookies and sealing, CSRF, the return paths,
back-channel logout, the proxy's header allow-lists, the API's token checks and default deny, the RLS policies, grants,
SECURITY DEFINER functions and context settings, the upload, confirm, download and purge pipeline, and the Nginx `/files`
rules. Those notes are in the task's progress notes (`node tools/progress/cli.mjs show 0.26c1`).
