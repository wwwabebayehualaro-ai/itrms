# Security standard

The security rules every part of ITRMS follows: platform slices, modules, apps, infrastructure and the way we build and
ship. Decision: [ADR-0033](../decisions/0033-security-baseline.md). It sits beside the [threat model](../engineering/threat-model.md)
(what we defend against), the [NFRs](../engineering/nfr.md) (the targets) and the [architecture](../architecture.md) §18
(the design summary).

* **Rules are mandatory.** "Must" means a reviewer rejects the change without it. Each rule has an id (`SEC-AC-3`) that
  code reviews, tests, the [ASVS checklist](#18-verification-and-evidence) and the INSA evaluation pack refer to.
* **Exceptions** need an ADR that names the risk, the compensating control, an owner and an expiry date. There are no
  silent exceptions and no "temporary" bypass flags.
* **Every control has evidence:** a test, a scan, a configuration file in the repository, or a record. A control without
  evidence counts as missing in the INSA evaluation ([Audit and Evaluation Guideline][insa-aeg] §8.3, §9: auditors test
  that practice matches the documents).

## 1. Baseline: standards and laws

| Source | What we take from it | Level |
|---|---|---|
| **OWASP ASVS 5.0** (May 2025) | The verification checklist for the application | **Level 2** everywhere; **Level 3** for authentication, sessions, authorization, cryptography, the money path and audit |
| **OWASP Top 10:2025** and **API Security Top 10:2023** | The risk list every review and test plan covers (§19) | All items |
| **NIST SP 800-63-4** (July 2025) | Authentication assurance, passwords, phishing resistance | Staff AAL2; administrators AAL3 |
| **NIST SP 800-218 (SSDF)** | Secure development practices (§16) | All practice groups |
| **SLSA** | Build integrity and provenance of released images | Build L2 from the first release, L3 target |
| **CIS Benchmarks** | Host, Docker and PostgreSQL hardening (§14) | Level 1 profiles |
| **ISO/IEC 27001:2022** | The vendor's own security management (§17), and the vocabulary bureaus' auditors use | Annex A as a checklist |
| **INSA Critical Mass Cyber Security Requirement Standard (CMCSRS) v2.0** | The national mandatory controls; the INSA audit criteria ([guideline][insa-aeg] §4) | Mapped in §20 |
| **INSA Cyber Security Audit and Evaluation Guideline v1.0** | How INSA audits: documents, then compliance and substantive tests, findings and a 0–100 maturity score | Target ≥ 76 ("Mature") |
| **Critical Infrastructure Cybersecurity Proclamation 1426/2026** | Transport and Government Services are critical-infrastructure sectors. A designated owner must get INSA security clearance before integrating new or upgraded ICT systems (Art. 7(12)) and report incidents within 48 hours (Art. 7(14)) | Applies when a bureau is designated |
| **Personal Data Protection Proclamation 1321/2024** | Personal data duties: security, records, DPIA, DPO, breach notice within 72 hours; reportedly also storage in Ethiopia (to be confirmed with the authority; ITRMS stores in Ethiopia anyway, ADR-0012) | All personal data (§10) |
| **IT Products Security Clearance and Control Proclamation 1310/2023** | INSA clearance and control of technology products | Release and installation |

Where a national rule and international guidance differ, the installation follows the national rule and the
difference is written down here (for example, SEC-ID-6).

## 2. Principles
1. **Deny by default.** Every route, query, network flow and file is closed until a rule opens it.
2. **Defence in depth.** No single control protects data alone: guards and RLS, encryption and access rules, signatures
   and audit.
3. **Least privilege**, for people, services, database roles, containers and the vendor's own staff.
4. **Fail closed.** A missing setting, an unknown role or a failed check denies; it never falls back to "allow".
5. **Assume breach.** Tamper-evident audit, off-site digests, encrypted backups, restore drills.
6. **Minimise data.** Collect what the service needs, mask by default, reveal with a reason.
7. **Secure by default in the installation:** the shipped configuration is the hardened one; weakening it is visible.
8. **Only open, maintained cryptography and libraries.** No home-made crypto, no abandoned dependencies.
9. **Evidence first.** If it isn't tested, scanned or recorded, it isn't done.

## 3. Data classification

ITRMS labels data with five levels. CMCSRS Annex B's CONFIDENTIAL, SECRET and TOP SECRET levels cover harm to national
security; ITRMS data sits below them. **Data a bureau has classified CONFIDENTIAL or higher must not be stored in ITRMS**
unless INSA approves the cryptography for it (CMCSRS 6.18).

| Level | Examples | Handling |
|---|---|---|
| **Public** | Verification result (masked), published tariffs, service list | May be shown without sign-in |
| **Internal** | Cases, registry records, reports, configuration | Signed-in staff of the unit's subtree; RLS |
| **Personal** | Names, addresses, licence and vehicle links | Internal rules + masked in exports and logs; PDP duties |
| **Sensitive personal** | Fayda FIN/FAN, phone, full birth date, medical results, salary, bank account | Field-encrypted tables; `reveal()` with a reason, audited; never in logs, URLs or search engines |
| **Secret** | Passwords, keys, tokens, session ids, signing keys | Never stored in plain text, never logged, never in the repository; rotated |

* **SEC-DC-1** Every new table and every new form field is given a level in its slice's `contracts/` (a `classification`
  on the Zod schema or the form field). An unlabelled field is a review failure (CMCSRS 6.17(d): unclassified assets are
  not released).
* **SEC-DC-2** The level drives masking in exports, audit diffs (HMAC-masked) and logs automatically; slices do not
  hand-mask.

## 4. Identity and authentication

Keycloak authenticates; ITRMS authorizes (ADR-0004, ADR-0031).

* **SEC-ID-1** Every staff account has **multi-factor authentication** (AAL2): a TOTP app, a hardware TOTP token, or a
  passkey (WebAuthn), and the phishing-resistant passkey option is always offered, as NIST 800-63-4 asks of AAL2
  verifiers. No SMS codes (800-63-4 classes SMS as a restricted authenticator; offices share phones) and no e-mail codes
  (e-mail is not an authenticator).
* **SEC-ID-2** **Administrators** (bureau IT, unit administrators with role-granting rights, vendor support) use a
  phishing-resistant factor. For AAL3 it must be **non-exportable**: a hardware security key or a device-bound passkey. A
  synced passkey counts as AAL2. This makes WebAuthn mandatory for administrators, where ADR-0004 offered it as optional
  (ADR-0033 amends it).
* **SEC-ID-3** Passwords: at least **12 characters**, up to at least 64; any characters, including Ethiopic; no
  composition rules; checked against a bundled breached-password list (works offline); hashed with **Argon2id**
  (Keycloak's default hashing).
* **SEC-ID-4** **Brute force:** Keycloak lockout with increasing delays; rate limits on `/auth` in Nginx; alerts on
  bursts (§12).
* **SEC-ID-5** **Accounts are provisioned and removed through an approved request** (who asked, who approved, which unit
  and role). No shared or generic accounts. Accounts **unused for 45 days are disabled**; leaving staff are disabled the same
  day (CMCSRS 5.7(e)(1), (7)).
* **SEC-ID-6** Staff passwords do not expire on a schedule (NIST 800-63-4). **Administrator passwords are changed every 90
  days**, as CMCSRS 5.7(e)(5) requires; administrators also hold a passkey, so the password is never their only factor.
* **SEC-ID-7** **Privileged access is reviewed every quarter**: a generated report of every role with granting,
  configuration or reveal rights, signed off by the bureau (CMCSRS 5.7(e)(3)).
* **SEC-ID-8** MFA reset and account recovery need a second administrator and are audited; the user is notified.
* **SEC-ID-9** External participants (applicants, associations) never get staff accounts; their access is class P and
  separately authenticated when added (ADR-0031).

## 5. Sessions

The BFF holds the session (ADR-0021). The browser never sees an access or refresh token.

* **SEC-SE-1** The session cookie is `__Host-itrms_sid`: HttpOnly, Secure, SameSite=Lax, Path=/, 128-bit random, opaque.
* **SEC-SE-2** **Idle timeout 30 minutes, absolute timeout 12 hours**; the refresh token rotates and reuse revokes the
  session family.
* **SEC-SE-3** The session id is rotated at sign-in and at every privilege change (unit switch, role change).
* **SEC-SE-4** "Sign out everywhere", a list of the user's sessions, and back-channel logout from Keycloak.
* **SEC-SE-5** **Step-up:** revealing sensitive data, granting roles and changing security settings need MFA within the
  last 5 minutes. Approving money and issuing documents, which a clerk does all day, need MFA within the last 30 minutes
  (one step-up covers a cashier's or an issuing clerk's batch).
* **SEC-SE-6** CSRF: SameSite=Lax **plus** a double-submit token (ADR-0021) **plus** an `Origin` check on every
  state-changing BFF route (added by ADR-0033).

## 6. Authorization and tenancy

* **SEC-AC-1** **Default deny.** Every controller handler has `@Require('resource:action')`; a handler without it fails
  the build (lint rule and a route-inventory test).
* **SEC-AC-2** **Two independent layers:** guards (role and unit) **and** PostgreSQL RLS, policies `TO itrms_app`, null-safe
  settings and no bypass setting (ADR-0011, ADR-0031). Every query runs in `db.scoped(ctx, …)`.
* **SEC-AC-3** **Object-level checks** (OWASP API1, BOLA): record ids from the client are never trusted; the scoped query
  returns nothing for a record outside the user's read scope: the subtree for local records, the region for class R
  registries (ADR-0011). A record outside scope answers 404 and a missing permission 403, with
  no detail about the record ([API guidelines](../engineering/api-guidelines.md)), so ids can't be probed.
* **SEC-AC-4** **Function-level checks** (API5, BFLA): permissions name actions, not screens; the menu hides what a user
  can't do, but the API decides.
* **SEC-AC-5** Roles come only from ITRMS `role_assignments` for the active unit; token claims are never used for
  authorization.
* **SEC-AC-6** **Separation of duties:** maker-checker on payments, issuance, reversals, role grants and configuration
  publication; the same person can't be both. Small offices route the check to the parent unit (ADR-0031).
* **SEC-AC-7** A unit administrator can grant only roles of their unit type's catalogue, only inside their subtree.
* **SEC-AC-8** **Vendor support access** is a read-only "view as user", time-limited, approved by the bureau and audited.
  There is no hidden super-user and no vendor back door.
* **SEC-AC-9** Code checks services and capabilities of the active unit, never unit names (ADR-0026).
* **SEC-AC-10** Every new or changed tenant table is in the isolation matrix: own, child, parent, sibling, other zone,
  other region, no context, reused connection.

## 7. Input, output and injection

* **SEC-IN-1** Every boundary validates with **Zod** schemas from the slice's `contracts/`: HTTP bodies, query strings,
  headers that matter, job payloads, events, imports and integration responses. Objects are **strict** (unknown keys
  rejected), so mass assignment is impossible.
* **SEC-IN-2** Limits on everything: body size, string length, array length, page size, file size, nesting depth, regex
  input. Patterns written by form authors (validation `pattern`, the `regex` condition) run on **RE2** (`re2js`), never
  on JavaScript's backtracking engine. RE2's time is bounded by input length × pattern size, so both are capped: patterns
  of at most 200 characters with at most 100 counted repetitions, and input of at most 4096 characters. Fixed patterns
  in code have no nested quantifiers; Semgrep checks.
* **SEC-IN-3** SQL only through Drizzle with bound parameters. `sql.raw` and string-built SQL with any input are forbidden
  (lint rule); identifiers come from allow-lists.
* **SEC-IN-4** Form submissions are validated on the server with `form-engine/core`; the browser check is a convenience.
* **SEC-IN-5** **Output encoding:** React escapes by default. `dangerouslySetInnerHTML` is forbidden except in reviewed,
  listed files that render only constants (lint rule with an allow-list). Rich text, if ever added, is sanitised on the
  server with an allow-list sanitiser.
* **SEC-IN-6** Document templates use LiquidJS with `outputEscape: 'escape'`; the renderer has JavaScript and network off
  (ADR-0006, ADR-0031).
* **SEC-IN-7** **SSRF:** the server fetches only endpoints from ops configuration, through the egress allow-list proxy.
  A URL from a user, a form or a template is never fetched (form data sources go through the API's allow-listed
  connectors).
* **SEC-IN-8** CSV and spreadsheet exports neutralise formula prefixes (`=`, `+`, `-`, `@`, tab, CR) in every cell.
* **SEC-IN-9** File names, paths and object keys are generated by the server; user-supplied names are display-only.
* **SEC-IN-10** Errors: `AppError` with a stable code, rendered as problem+json **without** stack traces, SQL, paths or
  internal ids. Unexpected errors get a generic message and a request id (OWASP A10:2025, exceptional conditions).

## 8. Web, BFF and browser

* **SEC-WB-1** **Security headers** on every response (Nginx and Next.js):
  * `Content-Security-Policy`: nonce-based with `'strict-dynamic'` for the app; hash-based for the static verify app
    (ADR-0032); `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`;
  * `Strict-Transport-Security: max-age=63072000; includeSubDomains`;
  * `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
    `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`, a restrictive
    `Permissions-Policy` (camera only where photo capture is used).
  * An e2e test asserts the headers on the shell, the API and the verify host.
* **SEC-WB-2** **Trusted Types** run in report-only mode from the first release and are enforced once the reports are
  clean.
* **SEC-WB-3** No token, secret or Sensitive field is ever in the browser's storage (localStorage, IndexedDB, Cache
  Storage) or in a URL. This refines ADR-0024 (ADR-0033 amends it):
  * local drafts keep the non-sensitive answers; fields classified Sensitive (SEC-DC-1) are kept only on the server and
    re-entered if the draft was never saved there;
  * a command that carries a Sensitive field is **not queued offline**: the form says it needs a connection to submit,
    so nothing in the queue is ever incomplete;
  * what is stored is encrypted with a non-extractable WebCrypto AES-GCM key bound to the user. An idle or expired
    session keeps the key, so the queue resumes after the same user signs in again. An explicit sign-out with queued
    commands warns first, then deletes the key, which makes the local data unreadable.
* **SEC-WB-4** Pages showing Personal or Sensitive data send `Cache-Control: no-store`.
* **SEC-WB-5** No CORS on the staff app: the browser talks only to its own origin (the BFF). The API rejects cross-origin
  calls.
* **SEC-WB-6** Third-party scripts, fonts, analytics and CDNs are not used; everything is served from the installation
  (task 0.4b: self-hosted fonts).
* **SEC-WB-7** Inline scripts are allowed only with the CSP nonce, and only for pre-paint code that reads fixed keys
  (theme, density).

## 9. API

* **SEC-AP-1** The OpenAPI contract is the inventory: an endpoint not in it doesn't exist (OWASP API9). Old versions are
  deprecated with `Sunset` and removed.
* **SEC-AP-2** **Rate limits** per user and per IP (Valkey) on sign-in, search, exports, reveals and public verification
  (OWASP API4); `429` with `Retry-After`.
* **SEC-AP-3** Every POST is idempotent (`Idempotency-Key`, ADR-0031); replays return the stored result.
* **SEC-AP-4** Heavy work (exports, PDFs, imports, reports) runs as jobs with quotas, never in the request (OWASP API4,
  API6).
* **SEC-AP-5** Responses return only the fields of the response DTO (Zod output schema), so internal columns never leak
  (OWASP API3).
* **SEC-AP-6** Integration responses are untrusted input (OWASP API10): validated, size-bounded, time-bounded.

## 10. Personal data (PDP 1321/2024, CMCSRS 6.36)

* **SEC-PD-1** Sensitive personal fields live in separate, field-encrypted tables, read only through the audited
  `reveal()` with a reason (ADR-0031).
* **SEC-PD-2** **Masked by default** in lists, exports, audit diffs and logs.
* **SEC-PD-3** **Retention per record type** with automatic deletion or anonymisation jobs; legal holds stop deletion.
* **SEC-PD-4** Data-subject requests: a "what we hold about you" report and a "who accessed my data" report from the
  audit.
* **SEC-PD-5** **Data stays in Ethiopia:** the installation and every backup copy are on servers in Ethiopia (ADR-0012).
* **SEC-PD-6** Each installation records the controller (the bureau), the DPO contact, the records of processing and a
  **DPIA per service** (template in the INSA pack, §20).
* **SEC-PD-7** A breach is reported to the data protection authority within **72 hours** (PDP) and handled by the incident
  runbook (§13).
* **SEC-PD-8** Seed, demo, test and training data are generated. Real people's data never leaves production, never goes
  into a test or a ticket, and is never used to train or test models.

## 11. Cryptography, keys and secrets

| Use | Algorithm | Notes |
|---|---|---|
| Transport | **TLS 1.3**; TLS 1.2 with AEAD ciphers only for old office browsers | Certificates from the bureau, ACME, or the national PKI (INSA) |
| Field encryption | **AES-256-GCM** envelope encryption; data keys per region | The key-encryption key is outside the database (sops-delivered) |
| Searchable sensitive fields | **HMAC-SHA-256** blind indexes | Separate key from encryption |
| Document and QR signatures | **Ed25519** | Offline verification; key rotation with overlapping validity |
| Passwords | **Argon2id** (Keycloak) | Parameters per OWASP guidance |
| Disks and backups | **LUKS2**; encrypted pgBackRest and restic repositories | Keys held by the bureau |
| Random values | `crypto.randomUUID`, `randomBytes`, `getRandomValues` (CSPRNG) | SEC-CR-5 |

* **SEC-CR-1** Only the platform's crypto module calls cryptographic primitives; slices call its functions
  (`encryptField`, `sign`, `verify`). No custom algorithms, modes or padding.
* **SEC-CR-2** A **cryptographic inventory** (algorithm, key, purpose, owner, rotation) is kept as a CycloneDX CBOM per
  release. It is part of the INSA pack: CMCSRS 6.18 requires INSA-approved cryptographic systems, so INSA sees exactly what
  is used.
* **SEC-CR-3** **Key rotation** schedule: session key and signing keys yearly, field KEK yearly with re-wrapping, S3 and
  database credentials every 90 days and on staff change, immediately after any suspected exposure.
* **SEC-CR-4** **Crypto agility:** algorithms are configuration, not constants, so a post-quantum or national algorithm
  can replace them without a data migration beyond re-wrapping.
* **SEC-CR-5** Every security-relevant random value (ids that must not be guessed, keys, tokens, idempotency keys, nonces)
  comes from the CSPRNG. `Math.random` is never used for them (Semgrep checks now; a lint rule from task 0.6).
* **SEC-SC-1** **Secrets are never in the repository** (gitleaks on every commit and in CI). Each installation generates
  its own secrets; operations keep them sops-encrypted; containers read them from files, not environment variables, where
  the image supports it.
* **SEC-SC-2** Secrets, tokens, session ids and Sensitive fields are never logged. The logger redacts a fixed key list,
  and a test fails if a known secret pattern reaches a log line.

## 12. Logging, audit and monitoring

* **SEC-LG-1** **The audit log** records every write (who, unit, action, record, before/after with masking, request id,
  IP) in the same transaction as the write. Sensitive events (denials, reveals, exports) are written in **their own
  committed transaction**, so they survive when the request's transaction rolls back (ADR-0031 item 4). The log is
  append-only, hash-chained, with a signed daily digest off-site (ADR-0018, ADR-0031).
* **SEC-LG-2** **Security events** are logged and alerted: failed and successful sign-ins, lockouts, MFA changes, role
  and permission changes, reveals, exports, configuration publication, vendor support sessions, denied requests in bursts,
  integrity-check failures.
* **SEC-LG-3** Logs are structured (JSON through OpenTelemetry to Loki), carry the request and trace id, and are protected
  from tampering (CMCSRS 6.28(d)).
* **SEC-LG-4** **Retention:** security and access logs 12 months, application logs 90 days, Nginx and egress-proxy logs at
  least 30 days. CMCSRS 6.28(e) asks for at least one month; the longer windows let an incident be reconstructed (CMCSRS
  6.26(n)).
* **SEC-LG-5** Monitoring covers at least the bureau's operating hours (CMCSRS 6.25(b)): Grafana alerts to the
  installation's on-call contacts (Telegram alerts carry no personal data).
* **SEC-LG-6** Logs and alerts can be forwarded (syslog or OTLP) to the bureau's or INSA's security operations centre
  (Proclamation 1426/2026 Art. 7(13)).
* **SEC-LG-7** Time is synchronised (chrony, drift < 1 s); all timestamps are UTC in storage.

## 13. Incident response

* **SEC-IR-1** Each installation has an **incident runbook** with severities, roles, contacts and the steps below, tested
  in a yearly exercise.
* **SEC-IR-2** **Deadlines:**
  * the vendor tells the bureau within **24 hours** of detecting an incident affecting its installation (CMCSRS 6.26(g)),
    and within 24 hours of confirming that a reported vulnerability affects it ([SECURITY.md](../../SECURITY.md));
  * the bureau reports to **Ethio-CERT within 48 hours** (Proclamation 1426/2026 Art. 7(14), for designated critical
    infrastructure; CMCSRS 6.26(f) for every organisation);
  * personal-data breaches go to the data protection authority within **72 hours** (PDP 1321/2024).
* **SEC-IR-3** **Evidence first, then recovery:** before anything that could change evidence (rebuilding, wiping,
  restoring over), the host is isolated, its volumes are snapshotted and the logs and audit chain are exported, and
  Ethio-CERT is told (CMCSRS 6.26(m)). The service may then be restored on a clean host while the evidence is examined,
  so a bureau is not kept offline waiting. The runbook gives the commands for each step.
* **SEC-IR-4** Data spills (data reaching someone not entitled to it) are incidents (CMCSRS 6.26(j)).
* **SEC-IR-5** Every incident ends with a post-incident review, a regression test and a threat-model update.

## 14. Infrastructure and hosting

* **SEC-IF-1** **Containers:** non-root user, read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, the
  default seccomp profile, CPU and memory limits, health checks, images pinned by digest, minimal or distroless bases.
* **SEC-IF-2** **Networks:** only Nginx publishes ports. The database, Valkey, SeaweedFS, Keycloak admin and observability
  are on internal networks; SeaweedFS has its own network (task 0.3). Egress goes through the allow-list proxy.
* **SEC-IF-3** **Host:** CIS Level 1 for Ubuntu LTS and Docker (checked with `docker-bench-security` and Lynis), a
  default-deny host firewall, SSH with keys only and no root login, administration only over VPN or the office network,
  unattended security updates, LUKS2, chrony.
* **SEC-IF-4** The firewall rules and network design are reviewed **every six months** and every rule has a written
  reason (CMCSRS 5.7(c)(1), (5)).
* **SEC-IF-5** An optional **WAF** in front of Nginx (OWASP CRS, or INSA's Gasha WAF where a bureau uses it). The
  application never relies on it.
* **SEC-IF-6** Default passwords never survive installation: the installer generates every credential and refuses to
  start with a known default.
* **SEC-IF-7** Disks that held installation data are destroyed or crypto-erased before reuse or sale (CMCSRS 6.28(g)).

## 15. Backup and recovery
* **SEC-BK-1** Backups follow ADR-0012 and ADR-0031: pull-mode pgBackRest, append-only restic, encrypted, a second site
  **inside Ethiopia**, 30 daily and 12 monthly copies.
* **SEC-BK-2** A monthly automated **restore drill** verifies row counts, file checksums and the audit hash chain; a
  failed drill is a severity-2 incident.

## 16. Secure development lifecycle (NIST SSDF)

| Stage | What happens | Evidence |
|---|---|---|
| Design | Each task that touches data, money, access or an external surface updates the threat model and names its SEC rules | `threat-model.md`, the task's notes |
| Code | The rules above, enforced by lint, dependency-cruiser and the slice checks | CI logs |
| Review | Every change is reviewed by the reviewer agent and approved by the product owner; once the team has a second developer, security-, money- or tenancy-sensitive changes also get a human code review | PR record, `progress.json` |
| Test | Unit and integration tests for authorization and isolation; a regression test for every security finding | CI test reports |
| Scan, on every change | Semgrep (SAST), gitleaks (secrets), Trivy (dependencies, IaC, images), `pnpm audit`, the licence report | CI artefacts |
| Release | CycloneDX **SBOM** and **CBOM**, image scan, **cosign** signatures, SLSA provenance, OWASP ZAP baseline against staging | Release artefacts |
| Verify | External **penetration test** before the pilot and then yearly or after major changes; the ASVS checklist | Pentest report, `docs/security-evidence/` |

* **SEC-DV-1** **Dependencies:** only from `tech-stack.md`; pinned exact versions; at least 14 days old
  (`minimumReleaseAge`); lockfile integrity; Renovate. A security fix may skip the age rule through
  `minimumReleaseAgeExclude`, recorded in the PR.
* **SEC-DV-2** **Fix deadlines** for findings in our code or dependencies, from when the fix is available: critical or
  actively exploited **7 days** (a mitigation within 72 hours), high **14 days** (CMCSRS 5.7(g)(4)), medium 30 days, low 90
  days. A deadline that can't be met needs an ADR exception.
* **SEC-DV-3** The repository has branch protection on `main`, required checks, no force-push, and 2FA for every account
  with write access. Commits are signed once CI can verify signatures. **Exception (ADR-0034):** without GitHub Actions
  there are no required checks to enforce. The compensating control is a complete local Linux CI record for every
  merged commit, checked by `/task-review` and the task verifier before the merge; owner: the product owner; it expires
  when hosted CI is available again, and is reviewed on 2027-06-30 at the latest.
* **SEC-DV-4** AI-assisted changes follow the same rules and reviews. Generated code is never trusted because it compiles.

## 17. People and the vendor (CMCSRS 6.37–6.39)

The bureau must make sure its supplier meets CMCSRS (6.39(a)). ABANEXUS therefore holds itself to these rules:
* **SEC-VN-1** Only named vendor staff may access a production installation, through the bureau's approved channel, with
  personal accounts, MFA and audit. Where the bureau requires it, they hold a security clearance (CMCSRS 6.37,
  Proclamation 1426/2026 Art. 7(17)).
* **SEC-VN-2** Developer machines: full-disk encryption, a supported OS with updates, malware protection, a screen lock,
  and no production data.
* **SEC-VN-3** The support contract commits to security updates and maintenance for the agreed life of the product
  (CMCSRS 6.38(e)) and to the incident deadlines of §13.
* **SEC-VN-4** Yearly security training for everyone who builds or supports ITRMS.

## 18. Verification and evidence

* **SEC-VE-1** The **ASVS 5.0 checklist** lives in `docs/security-evidence/asvs.md` (from Phase 1, task 1.19). Each
  requirement links to the rule, test or record that meets it, or is marked not applicable with a reason.
* **SEC-VE-2** Scan reports, SBOMs, CBOMs, pentest reports and drill reports are kept per release.
* **SEC-VE-3** CI is the record of what passed. While hosted CI is unavailable, the local Linux CI run is the record
  (ADR-0034).

## 19. OWASP Top 10:2025 coverage

| Risk | Main rules |
|---|---|
| A01 Broken Access Control (including SSRF) | SEC-AC-1…10, SEC-IN-7 |
| A02 Security Misconfiguration | SEC-WB-1, SEC-IF-1…6, the shipped hardened defaults |
| A03 Software Supply Chain Failures | SEC-DV-1, §16 release stage |
| A04 Cryptographic Failures | §11 |
| A05 Injection | SEC-IN-1…6, SEC-IN-8 |
| A06 Insecure Design | Threat model per task, maker-checker, §16 design stage |
| A07 Authentication Failures | §4, §5 |
| A08 Software or Data Integrity Failures | Signed images and QR payloads, hash-chained audit, SEC-IN-1 |
| A09 Security Logging and Alerting Failures | §12 |
| A10 Mishandling of Exceptional Conditions | SEC-IN-10, fail-closed principle |

## 20. INSA evaluation readiness

**What INSA does** (from its own documents):
* It audits organisations against CMCSRS and evaluates technology products against Common Criteria and other frameworks
  it accepts ([guideline][insa-aeg] §1, §4).
* An audit reviews documents first (policies, standards, procedures, flowcharts), then tests that practice matches them,
  with compliance and substantive tests and automated tools (§8.2–8.3, §9).
* Findings are major nonconformities, minor nonconformities or observations, and the result is a maturity score: 0–35
  immature, 36–75 developing, 76–90 mature, 91–100 advanced (§8.5, §9).
* CMCSRS 6.14(f) says the **requirements and design of an information system should be evaluated by INSA before it is
  procured or developed**, and systems INSA has not certified should not be deployed. CMCSRS 6.38(f)–(g) say locally
  developed ICT products and services should be evaluated and certified by INSA before they are made available on the
  market.
* For web applications, INSA's Cyber Security Audit Division takes requests with its *Web Applications Audit Request*
  requirements form (OF/AEAD/001, 2025). The form's opening text, as indexed by a search engine, gives a response within
  five working days; the full form could not be read from outside Ethiopia, so the procedure is to be confirmed with
  the Division.

**When:** ITRMS goes through INSA's audit **after development, before the pilot** (task 1.19; product owner,
2026-10-19). The design documents are kept current, so an earlier look at the requirements and design (CMCSRS 6.14(f))
is possible whenever INSA or a bureau asks.

**The evaluation pack** (assembled in task 1.19; most items exist from Phase 0):

| Item | Source |
|---|---|
| Requirements and design | `docs/architecture.md`, the ADRs, `docs/service-catalogue.md`, data-flow diagrams |
| Security standard and threat model | this document, `docs/engineering/threat-model.md` |
| Data classification and privacy | §3, §10; records of processing and DPIAs per service |
| Policies and procedures for the installation | access control and account lifecycle (§4, §6), cryptography and keys (§11), logging and monitoring (§12), incident response (§13), backup and recovery (§15), change and vulnerability management (§16), supply chain (§17) |
| Product evidence | ASVS checklist, SBOM and CBOM, scan reports, signed images, hardening reports (CIS, Lynis), pentest report with closed findings |
| Operation evidence | Audit-log demonstration, restore-drill reports, access-review reports, incident exercise record |

**CMCSRS process → ITRMS**

| CMCSRS process | Where ITRMS covers it |
|---|---|
| 5.7 Technology capability (network, configuration, accounts, malware, updates) | §4, §14, SEC-DV-2, ClamAV (ADR-0022) |
| 6.10 Asset management, 6.17 Classification and access control | §3, §6, SBOM |
| 6.11 Risk assessment | threat model; DPIAs |
| 6.14 Security engineering, 6.38 Procurement, development and maintenance | §16, this document, the INSA audit after development (task 1.19) |
| 6.18 Cryptography management | §11, CBOM |
| 6.19 Business continuity, 6.28 Backup, recovery and destruction | §15, SEC-IF-7, ADR-0012 |
| 6.25 Monitoring and vulnerability management | §12, §16, SEC-DV-2 |
| 6.26 Incident management, 6.27 Investigation | §13 |
| 6.36 Information privacy | §10 |
| 6.37 Security clearance, 6.39 Supply chain | §17 |

## 21. Where each rule is enforced

| Rule | Enforced by | From task |
|---|---|---|
| SEC-AC-1 (`@Require` on every handler) | `RouteInventory` stops a process with an unmarked handler; `AccessGuard` denies by default (`platform/kernel/api/iam/access.spec.ts`) | 0.8 |
| SEC-AC-2, SEC-AC-10 (RLS, isolation matrix) | `apps/api/test/integration/isolation.int.spec.ts` on PostgreSQL 16: every class × own, child, parent, sibling, other zone, other region, no context on a reused connection; every table with `region_id` declared, RLS on, exactly its class's policies `TO itrms_app` | 0.9 |
| SEC-IN-1, SEC-AP-5 (Zod in and out) | controller base + contract tests | 0.6 |
| SEC-IN-3, SEC-IN-5, SEC-CR-5 (no raw SQL, no unlisted `dangerouslySetInnerHTML`, no `Math.random` for security) | ESLint rules in `packages/config` (Semgrep already reports `Math.random` and unsafe regexes) | 0.6 |
| SEC-IN-2 (author patterns on RE2, bounded) | `safePattern.test.ts`; Semgrep's ReDoS rule for fixed patterns | now |
| SEC-AC-5, SEC-AC-7 (roles from `role_assignments` only; grants within the unit type's catalogue) | `apps/api/test/integration/iam.int.spec.ts`: roles in the token ignored, per-unit roles, revocation at the next request, catalogue and `bureau_admin` checks | 0.10 |
| SEC-LG-1 (denials on record) | `iam.int.spec.ts`: a missing permission and a unit without a role write `access.denied`; refusals before a unit is known go through `kernel.record_context_free_event` | 0.10 |
| SEC-WB-1 (headers, CSP) | `apps/web/proxy.ts` (nonce CSP with 'strict-dynamic', HSTS, frame-ancestors); asserted in `apps/web/tests/e2e/sign-in.spec.ts` (headers, nonced scripts, no CSP violation) and `tests/unit/bff.test.ts`; Nginx rules in `infra/compose/nginx` checked by `tools/exposure/nginx.test.mjs` | 0.10a |
| SEC-SE-1…4, SEC-SE-6 (sessions, CSRF) | `apps/web/tests/e2e/sign-in.spec.ts`: HttpOnly `__Host-itrms_sid`, no token in the browser (every response watched), rotation on unit switch, CSRF token and Origin, sign-out and back-channel logout end the Keycloak and BFF sessions; `tests/unit/bff.test.ts`: sealed records, idle and absolute timeouts, indexes | 0.10a |
| SEC-SE-5 (step-up) | `@Require(…, { recentAuth })` and `StepUpRequiredError` (RFC 9470); role grants and revocations need a factor in the last 5 minutes (`iam.int.spec.ts`) | 0.10a |
| SEC-ID-1, SEC-ID-3 (second factor, breached passwords) | the realm's `itrms browser` flow (TOTP required) and `passwordBlacklist`; the e2e signs in with TOTP twice | 0.10a |
| SEC-LG-1 (audit in the same transaction) | the audit test of every write path | 0.7 |
| SEC-AP-3 (idempotent POSTs) | `IdempotencyInterceptor` (key required on every POST, claimed in the business transaction); `apps/api/test/integration/jobs.int.spec.ts`: replay, 422 mismatch, 409 in progress | 0.11 |
| SEC-SC-1, SEC-SC-2 (secrets) | gitleaks; log-redaction test | 0.2; 0.6 |
| SEC-DV-1 (dependencies) | pnpm settings, Renovate, `pnpm audit` | 0.2 |
| SEC-IF-1, SEC-IF-2 (containers, networks) | a Compose policy test (Trivy has no Compose scanner; it checks Dockerfiles once there are any) | 0.26 |
| SEC-PD-1, SEC-PD-2, SEC-CR-1 (encrypted fields, masked by default, one crypto module) | `@itrms/kernel/crypto`: AES-256-GCM per region (data keys wrapped by `FIELD_KEYS`), HMAC blind indexes (`BLIND_INDEX_KEY`), `reveal()` recording who and why first; `apps/api/test/integration/parties.int.spec.ts`: no clear value in the tables, the audit log or the idempotency records, a viewer never sees FIN or phone, reveal needs `pii:reveal`, a reason and a factor in the last 5 minutes | 0.14 |
| SEC-IN-9 and uploads (server keys, declared size and type, quarantine) | `@itrms/kernel/files`: keys `quarantine/<region>/<id>` and `files/<region>/<id>`; POST policy and signed part lengths, so S3 refuses more bytes or another type; size, first bytes and SHA-256 checked before a file leaves quarantine; `apps/api/test/integration/files.int.spec.ts` (sibling unit 404, type mismatch, too large, parts, quota, purge) and `files-nginx.int.spec.ts` (listing and unsigned requests refused by Nginx) | 0.15 |
| SEC-DC-1 (classification of fields) | slice check (`check:slices`); until then the audit policy's `omit`/`mask` per table | 0.21 |

[insa-aeg]: https://www.insa.gov.et/pdf/cyber-security-audit-and-evaluation

**Sources**
* INSA documents: [Cyber Security Audit and Evaluation Guideline v1.0][insa-aeg];
  [Critical Mass Cyber Security Requirement Standard v2.0](https://www.insa.gov.et/pdf/critical-mass-cyber-security-requirement-satandard);
  [Critical Infrastructure Cybersecurity Proclamation 1426/2026](https://www.insa.gov.et/pdf/critical-infrastructure-cybersecurity-proclamation-no-14262026-1786083598);
  [INSA documentation list](https://www.insa.gov.et/documentations);
  [Web Applications Audit Request requirements](https://cyberaudit.insa.gov.et/guidelines/Web_Application_Security_Testing_Requirements_Document_4_5.pdf)
  (not reachable from outside Ethiopia when checked on 2026-10-19).
* OWASP: [ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/),
  [Top 10:2025](https://owasp.org/Top10/), [API Security Top 10](https://owasp.org/API-Security/);
  NIST: [SP 800-63-4](https://pages.nist.gov/800-63-4/), [SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final);
  [SLSA](https://slsa.dev/); [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks).
