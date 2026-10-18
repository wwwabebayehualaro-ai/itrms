# ADR 0031: Hardening from the design review of 2026-10-18

* Status: accepted (2026-10-18). It **amends** ADRs 0003, 0004, 0005, 0006, 0011, 0012, 0014, 0023, 0024 and 0027 where
  noted. Review record: `docs/reviews/2026-10-18-design-review.md`.

## Context
An independent review of all design documents (before any code) found 1 critical, 10 high and 19 medium/low issues, mostly
in RLS and identity details, the money path, backups and exposure. Fixing them now costs a document edit. Fixing them after
the build would cost a rewrite.

## Decisions
1. **RLS without a bypass flag** (amends 0003, 0011).
   * Policies are `TO itrms_app`, and settings are read null-safely (`nullif(current_setting(…, true), '')`). A reused
     pooled connection therefore fails closed.
   * System work uses a separate pool and the role `itrms_system` (BYPASSRLS), only in the worker.
   * FORCE RLS is not set: it affects only the owner, and the owner runs migrations.
   * DB roles: `itrms_owner`, `itrms_app`, `itrms_system`, `itrms_backup`.
   * A fourth policy class, **P** (party-scoped), covers external participants.
   * Class R writes require the record's handling path to be in scope. Search runs through scoped SECURITY DEFINER
     functions.
2. **Authorization in ITRMS, authentication in Keycloak** (amends 0004).
   * `role_assignments` (user × unit × role, validity, granted by) is the source of roles for the active unit.
   * Token role claims are not used for authorization.
   * Hardware TOTP tokens are supported.
3. **Personal data separated and encrypted.**
   * `person_sensitive` and similar tables are field-encrypted (envelope keys, the KEK outside the database) with HMAC blind
     indexes, and revealed through an audited `reveal()`.
   * Medical certificates are class T.
   * Audit diffs HMAC-mask classified fields. LUKS encrypts the volumes.
4. **Audit:** class T, hash-chained, a signed daily digest off-site, and sensitive events (denials, reveals, exports) in their
   own transaction.
5. **Money path:** `external_payment_refs` are unique per issuer + reference + fiscal year, and must be verified by a second
   person or matched to an imported statement before they settle a case. Cashier closing reconciles controlled stationery
   serials.
6. **Workflow:** `wait` states with event and timeout transitions run by system actors; `rejectRoles` from listed states
   only; automatic parent routing when separation of duties leaves no actor. Licences stay `pending_national` until the
   national platform accepts them.
7. **Numbering** (amends 0014): counters only for documents ITRMS legally issues; federal plate serials; national licence
   numbers when available; counters seeded above migrated maxima; case numbers use a plain sequence.
8. **Idempotency** (amends 0024): stored as (user, method, route, key, request hash) in the business transaction; kept 7
   days; the client asks before replaying anything older.
9. **Jobs** (amends 0005): outbox states pending → enqueued → done with a sweep; Valkey configured with AOF and
   `noeviction`; separate instances for queues and sessions.
10. **Documents** (amends 0006): a separate `worker-documents` service; escaped LiquidJS output; Chrome with JavaScript
    disabled; **Ed25519-signed QR payloads verifiable offline**, plus online revocation status on a separate public host.
11. **Exposure:** three hostnames (public `verify`, staff `app`, internal Keycloak admin); CSP, HSTS, `frame-ancestors`;
    an egress allowlist proxy; integration endpoints only from ops configuration.
12. **Uploads:** presigned POST with size conditions, bounded multipart, a quarantine prefix, a lifecycle clean-up, quotas,
    and no bucket-level operations through Nginx.
13. **Backups** (amends 0012): a pull-mode pgBackRest repository host, encrypted repositories, SeaweedFS `filer.sync` +
    append-only restic, restore drills that check files against database rows, a cold spare, UPS and generator as contract
    items.
14. **Operations** (amends 0023): Tempo and GlitchTip become an optional profile; real-user web vitals per office; chrony;
    a maintenance window with read-only mode; N/N-1 API compatibility between installations; a rehearsed `pg_upgrade`
    runbook.
15. **Configuration:** one resolver walks the actual ltree ancestors, then the unit type, then the unit. Service keys live
    only in service overrides.
16. **Entitlements** (amends 0027): all registries belong to `itrms.core`. An expired licence file gives a grace period, then
    read-only with banners, and never blocks mid-day.
17. **Scale:** filterable JSONB fields get indexes when a form is published; queries carry a service filter;
    `statement_timeout`; EXPLAIN under RLS is part of "done" for search tasks.
18. **Domain additions:** appeals (30 days, Proclamation 1074/2018 Art. 24), a correspondence register, controlled
    stationery stock, working calendars (hours, lunch, half days).
19. **Training** is a separate installation on the same host, never a region inside production.

## Consequences
* `docs/architecture.md` §3–§18, the platform documents and the phase tasks are updated to match.
* The isolation matrix gains the reused-connection case and class P. The "done when" of search tasks includes EXPLAIN under
  RLS.
