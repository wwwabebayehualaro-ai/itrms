# Enterprise capabilities

These are the cross-cutting capabilities that make ITRMS a product (an ERP for transport and road bureaus) rather than a
set of forms. Each row says what it is, where it lives, and when it comes. Phase task numbers refer to
[phases/](../phases/phase-0.md). "Exists" marks legacy code that is ported.

## 1. Administration and configuration
| Capability | What | Module | Phase |
|---|---|---|---|
| Admin console | One area for: org tree and unit types, users and roles (delegated per subtree), services (catalogue, versions, overrides), fee rules, document templates, languages and translations, menus (overlay), branding, holidays, number sequences, settings, integrations, licence and entitlements | kernel + platform | 0 (core screens), 1 (complete) |
| Settings hierarchy | product → installation → region → zone → unit type → unit → user, with "inherited from" shown ([org-and-unit-types.md](org-and-unit-types.md) §4) | `org` | 0 |
| Configuration as data, versioned | services, forms, workflows, fees and templates are versioned and published, never edited in place; diff and rollback (publish an earlier version as new) | platform | 0 |
| Export and import of configuration | a service package (form + workflow + fee + templates) exported as signed JSON and imported into another installation, so a configuration built for one region can be reused for another | `org`, platform | 1 |
| Translation management | the missing-translation report, CSV round trip with the translator, review sign-off ([i18n-and-languages.md](../i18n-and-languages.md)) | `i18n` | 0 (basic), 1 |

## 2. Work management
| Capability | What | Module | Phase |
|---|---|---|---|
| Task inbox | My tasks / my unit's tasks, claim, filters, SLA colour, bulk claim | `workflow` | 0 |
| SLA and escalation | business-day calendar, due dates, overdue escalation one level up | `workflow` | 0 |
| Case conversation | a comment thread **on each case**: `@user` mentions, attachments, internal vs. applicant-visible notes, live updates (server-sent events), part of the case timeline and audit. **No general-purpose chat**: discussion about a case stays on the case, so it's governed, searchable and survives staff changes | `workflow` | 0 (comments, mentions), 1 (attachments, live updates) |
| Delegation and substitutes | a lead delegates approvals to a named person for a period (leave), audited | `iam`, `workflow` | 1 |
| **Appeals and complaints** | a decided case can be appealed within 30 days (Proclamation 1074/2018 Art. 24): an appeal sub-case routed to the next level, with its own SLA | `workflow` | 1 |
| **Correspondence register** | numbered incoming and outgoing letters (ደብዳቤ), linked to cases and units, with scans | platform | 1 |
| Bulk actions | e.g. mark a print batch as distributed, approve several renewals (with confirmation and per-item results) | modules | 1 |
| Calendar | exam sessions, inspection appointments, holidays; Ethiopian display | `workflow`, modules | 1 |

## 3. Information
| Capability | What | Module | Phase |
|---|---|---|---|
| Global search | the command palette: menu, actions, records ([navigation-and-menus.md](navigation-and-menus.md)) | `search` | 0 (menu + persons), 1 (all registries) |
| Saved views | list filters, columns and sort saved privately or shared (exists in the legacy data viewer) | platform | 0 |
| Dashboards | role homes, unit KPIs, drill-down to lists; widgets contributed by modules | `reports` | 0 (basic), 1 |
| Reports | parameterised reports (unit, period in EC/GC, service) to screen, Excel or PDF; heavy ones run as jobs and notify when ready | `reports` | 1 |
| Scheduled reports | e.g. the monthly report to the region, the quarterly performance report, sent automatically | `reports` | 2 |
| Statutory reports | the formats required by the bureau, civil service, pension agency and Finance (from the business answers) | `reports`, modules | 1–3 |
| Data export | audited CSV and Excel export of any list the user can see, row limits, PII masked unless permitted (legacy export exists) | platform | 0 |

## 4. Records and documents
| Capability | What | Module | Phase |
|---|---|---|---|
| Record history | every change, who, when, from where (audit), shown as a timeline on each record | `audit` | 0 |
| Attachments | typed attachments (medical certificate, ID, libre copy) with virus scanning (Phase 1) | `files` | 0 |
| Issued documents | numbered, QR-verifiable, reprint from storage, revoke and supersede | `documents` | 0 |
| Retention and legal hold | retention per record type (PDP), archival of closed cases, legal hold blocks deletion | `audit`, `files` | 1 |
| Paper archive linking | the paper file reference and shelf location on migrated records | registries | 1 |

## 5. Data management
| Capability | What | Module | Phase |
|---|---|---|---|
| Import framework | templates to download, upload Excel/CSV, validation with row-level errors, dry run, idempotent re-run, a report (paper-record migration and onboarding a zone use it) | platform | 1 |
| Duplicate detection and merge | persons (Fayda, name + birth date + phone), organisations, vehicles (VIN); merging needs approval and keeps history | registries | 0 (persons), 1 |
| Master data governance | which unit may create or correct which registry record; corrections through a case, not direct edits | registries | 1 |
| **Controlled stationery** | serial-range stock of licence card blanks, bolo stickers and receipt pads per unit; issued, used, spoiled; reconciled at cashier closing | `fees`, `competency` | 1 |
| Reference data | licence grades, vehicle categories, offence codes, unit rates, holidays: versioned lists with effective dates | platform | 0 |

## 6. Communication
| Capability | What | Module | Phase |
|---|---|---|---|
| In-app notifications | bell, read state, deep links | `notifications` | 0 |
| SMS | case updates, ready-for-pickup, renewal reminders; templates per language; delivery status | `notifications` | 0 (fake) / 1 |
| Email | optional, for staff | `notifications` | 1 |
| Preferences | per user and event type; mandatory events can't be switched off | `notifications` | 1 |
| Announcements | the bureau posts notices to all users or a subtree (e.g. "new fee schedule from Meskerem 1") | `notifications` | 1 |
| Telegram notifications (opt-in) | a bot sends **content-free** alerts ("3 tasks waiting") with a link; no case or personal data (Telegram servers are abroad; PDP 1321/2024) | `notifications` | 1 |

## 7. Security and compliance (beyond tenancy and RLS)
| Capability | What | Phase |
|---|---|---|
| Delegated administration | zone and unit admins manage only their subtree; role assignment limited to the unit type's catalogue | 0 |
| Separation of duties | per workflow step; maker ≠ checker on money and issuance | 0 |
| Sensitive-data controls | masking, reveal with reason (audited), export masking (PDP 1321/2024) | 0–1 |
| Session security | 2FA, idle timeout, concurrent-session list and revoke, back-channel logout | 0 |
| **Anomaly rules for auditors** | external reference used twice, approvals outside working hours, reversal rates per cashier, the same actor across steps, licences issued without the usual time gaps | 2 |
| Tamper-evident audit | hash-chained audit, signed daily digest off-site, "who accessed my data" report per person | 0 (chain), 1 (report) |
| Access reviews | a periodic report of who has which role where, for unit heads to confirm | 1 |
| Support access | "view as user", read-only, time-limited, needs the user's or head's approval, fully audited; no hidden super-user | 1 |
| Security evaluation | INSA evaluation pack: threat model, pentest, SBOM, scan reports | 1 |

## 8. Help and adoption
| Capability | What | Phase |
|---|---|---|
| **Ethiopic input everywhere** | phonetic transliteration typing (Latin keys → Ethiopic, e.g. `selam` → ሰላም) in every text field, because many office PCs have no Amharic keyboard layout | 0 |
| **Lite mode** | automatic on slow links (from real-user measurements): no images, smaller pages, SMS fallback for notifications | 1 |
| Contextual help | a help panel per screen (Markdown, am/en/wal), maintained by the bureau's trainers in the admin console | 1 |
| Guided tours | first-use walkthrough per role (a small library on the design system) | 1 |
| Training environment | **a separate training installation on the same host** (own database, realm, bucket and hostname; same configuration, generated data; reset nightly; SMS and payments forced to fakes; documents verify as "TRAINING – not valid"; a "ስልጠና / TRAINING" banner) | 1 |
| What's new | release notes per version, shown once after an upgrade, in am/en | 1 |
| Feedback | "report a problem" with an automatic screenshot, page, version and request id, to the support queue | 1 |

## 9. Integration and API
| Capability | What | Phase |
|---|---|---|
| Versioned API | `/api/v1/…`, OpenAPI published, deprecation policy (2 releases notice) | 0 |
| API clients | service accounts (Keycloak client credentials) with scoped permissions for other government systems | 1 |
| Webhooks and outbound events | signed, retried, per subscriber | 2 |
| Adapters | national vehicle registry, driver platform, penalty system, SMS, payments, Fayda, other ITRMS installations ([architecture.md](../architecture.md) §16) | 1–3 |

## 10. Operations and lifecycle
| Capability | What | Phase |
|---|---|---|
| Release management | semver; one release for all customers; changelog; migrations forward-only (expand/contract); feature flags for gradual enablement | 0 |
| Upgrades per installation | a signed bundle (images + migrations + notes), a pre-upgrade backup and checks, one command to upgrade, rollback guidance | 1 |
| Fleet overview | opt-in heartbeat from each installation (version, health, backup age, no personal data) to the vendor's support dashboard | 2 |
| Observability | OpenTelemetry, Grafana stack, GlitchTip (ADR-0023); a system status page for admins | 0–1 |
| Backup and DR | nightly off-site in Ethiopia, monthly restore drill (ADR-0012); documented RPO 24 h / RTO 8 h (to agree per contract) | 0–1 |
| Licensing | a signed licence file per installation: products, validity (ADR-0027) | 1 |
| Performance budgets | p95 < 300 ms for reads and < 800 ms for commands at regional load; ≤ 250 KB JS per screen; checked in CI and nightly k6 | 0 |

## 11. Quality
| Capability | What | Phase |
|---|---|---|
| Test pyramid | unit (Vitest), integration (Postgres, Testcontainers), e2e journeys (Playwright, with axe), visual regression (Storybook stories), load (k6) | 0 |
| Isolation matrix | every tenant table, every role scope (ADR-0011) | 0 |
| Contract tests | adapters (fake ↔ real), S3, OpenAPI drift | 0 |
| Seeded demo and training data | generated, never real people | 0 |
