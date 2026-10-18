# Design review, 2026-10-18

* **Scope:** every design document (CLAUDE.md, docs/*, docs/platform/*, ADRs 0001–0030, phases 0–3). No code existed yet.
* **Reviewer:** an independent senior-review agent, read-only. Its findings were verified against the text by the main
  session before being accepted.
* **Result:** 1 critical, 10 high and 19 medium/low findings. **All were accepted**, two with an adapted fix. They were
  resolved in the documents the same day, mainly through [ADR-0031](../decisions/0031-design-review-hardening.md) and the
  rewrite of `architecture.md` §3–§18.

| # | Severity | Finding | Resolution | Where |
|---|---|---|---|---|
| 1 | critical | RLS bypass via a setting any session can change; FORCE RLS misunderstood | No bypass branch; policies `TO itrms_app`; `itrms_system` BYPASSRLS on a separate worker pool; FORCE not set; DB roles defined | architecture §5; ADR-0003, 0011, 0031; task 0.9 |
| 2 | high | Pooled connections return `''` → class-C policies match everything | `nullif(current_setting(…, true), '')`; region check in every class; no-context test on a reused connection | architecture §5; task 0.9 |
| 3 | high | Keycloak realm roles can't be tied to a unit | ITRMS `role_assignments` (user × unit × role, validity) as the only authorization source | architecture §4–§5; ADR-0004, 0031; roles doc; task 0.10 |
| 4 | high | Registry writes unchecked; personal data readable region-wide | Class-R writes limited to handled records; `person_sensitive` field-encrypted with blind indexes and `reveal()`; medical certificates class T | architecture §5–§6; tasks 0.9, 0.14 |
| 5 | high | "Paid at the revenue office" reference could be faked or reused | `external_payment_refs` unique per issuer, reference and year; verification by a second person or statement match | architecture §9; demo plan; task 0.22 |
| 6 | high | Task 0.24 contradicted the demo (woreda intake, zone decides) | Rewritten: zone or a town with a competency team; `approval_unit` override | task 0.24 |
| 7 | high | No system/wait states; a licence could compete with the national record | `wait` states, system actors, `pending_national` licences | architecture §8; tasks 0.19, 0.24 |
| 8 | high | Audit diffs leaked personal data; audit had no RLS class; denials rolled back | HMAC-masked diffs; audit class T; sensitive events in their own transaction; hash chain + signed daily digest | architecture §15; ADR-0031 |
| 9 | high | Backups deletable from the main host; no encryption; files vs database recovery points | Pull-mode pgBackRest repository host, encrypted; `filer.sync` + append-only restic; restore drill checks files; cold spare, UPS, generator | architecture §17; ADR-0012; task 0.26 |
| 10 | high | No encryption at rest or key management | LUKS volumes; field envelope encryption with the KEK outside the database; rotation schedule | architecture §18 |
| 11 | high | Public exposure undefined (Keycloak admin, staff app, verification on one host) | Three hostnames; Keycloak admin internal; CSP, HSTS, frame-ancestors; brute-force detection | architecture §17; task 0.10 |
| 12 | med-high | RLS defeats index use for search | No OR branch; scoped SECURITY DEFINER search functions; EXPLAIN under RLS in "done" | architecture §5; tasks 0.9, 0.14, 0.16 |
| 13 | med-high | Idempotency window shorter than the PWA retry queue | (user, method, route, key, hash) in the business transaction; 7 days; client asks before replaying old commands | architecture §15; ADR-0024; task 0.11 |
| 14 | medium | Outbox/Valkey durability unspecified | pending → enqueued → done + sweep; AOF, noeviction; separate instances | architecture §12; ADR-0005; task 0.11 |
| 15 | medium | Upload size not enforceable with presigned PUT; S3 exposed | Presigned POST with conditions; bounded multipart; quarantine; lifecycle; quotas; object-level-only proxy | architecture §14; task 0.15 |
| 16 | medium | JSONB viewer has no indexing strategy | Service filter required; filterable fields indexed on publish; statement timeout; async exports | architecture §11; task 0.16 |
| 17 | medium | Two configuration mechanisms; fixed levels | One resolver over the real ltree ancestors + unit type; service keys only in service overrides | architecture §7; org-and-unit-types §4 |
| 18 | medium | Entitlements didn't match registry dependencies; licence file as a kill switch | All registries in `itrms.core`; warnings, grace period, then read-only | modularization §6 |
| 19 | medium | Training region inside production leaks into real channels | A separate training installation on the same host | enterprise-capabilities; architecture §17; task 1.12c |
| 20 | medium | PDF rendering not isolated; templates not escaped | `worker-documents` service; `outputEscape`; JavaScript disabled; CSP | architecture §10; task 0.23 |
| 21 | medium | External participants and service accounts had no policy class | Class P; separate Keycloak client; service accounts bound to a unit and a permission subset | architecture §5; roles doc |
| 22 | medium | Gapless counters used for numbers ITRMS shouldn't generate | Counters only for documents ITRMS issues; federal plates; national licence numbers; `start_after`; plain sequence for cases | architecture §15; ADR-0014 |
| 23 | medium | Separation of duties could deadlock small offices; reject wildcard too broad | Automatic parent routing (recorded); `rejectRoles` from listed states | architecture §8; roles doc; task 0.19 |
| 24 | medium | Upgrades across installations underspecified | Maintenance window with read-only mode; N/N-1 API; rehearsed `pg_upgrade` runbook | architecture §17 |
| 25 | medium | Missing appeals, correspondence register, stationery stock | Added (Phase 1 tasks 1.12a, 1.12b) | enterprise-capabilities; phase-1 |
| 26 | medium | Outbound SSRF not considered | Egress allowlist proxy; split networks; endpoints only from ops configuration | architecture §16 |
| 27 | medium | Operations footprint too large | **Adapted:** Tempo and GlitchTip moved to an optional profile, not dropped (capability-first, ADR-0025); visual regression limited to am/en, light, comfortable; licence file only when a subset is sold | ADR-0023, 0031; task 0.4a; modularization |
| 28 | low-med | Working hours, business-date timezone and clock sync missing | `working_calendars`; one application helper for business dates; chrony with a drift alert | architecture §6.3, §8, §17; task 0.20 |
| 29 | low-med | Module package build and migration mechanics | One `drizzle.config` across schemas; `nest build -b swc` | modularization §7; tech-stack T25a |
| 30 | low | Smaller contradictions (`parties` layer, town count, task count, ADR statement, Leaflet vs MapLibre, i18n required languages, reports vs JSONB) | All corrected | several |

## Reviewer's suggested additions, adopted
| Addition | Where |
|---|---|
| Offline-verifiable signed QR + verifier PWA | architecture §10; task 0.23; value proposition #4 |
| Ethiopic phonetic input in every field; hardware TOTP tokens | design system; task 0.13; architecture §5 |
| Tamper-evident audit + "who accessed my data" | architecture §15; enterprise capabilities |
| Anomaly rules for auditors | enterprise capabilities (Phase 2) |
| Controlled stationery, correspondence register, appeals | Phase 1 tasks 1.12a–b |
| Lite mode from real-user measurements | architecture §17; task 1.12c |
| Road and safety GIS (MapLibre + PMTiles) | phase-2 |
| PAdES signatures + e-correspondence | ADR-0006 hook; enterprise capabilities |
| Citizen self-service (status lookup, booking) | value proposition §3 (Phase 1 booking; USSD optional) |
| Bureau command dashboard across zones | value proposition #7; enterprise capabilities |
