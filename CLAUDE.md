# CLAUDE.md

Guidance for Claude Code in this repository.

## Product

**ITRMS: Integrated Transport and Road Management System** (የተቀናጀ የትራንስፖርትና የመንገድ ልማት አስተዳደር ሥርዓት). It is a
multi-tenant system sold to transport and road development bureaus, zones and woredas in Ethiopia, and it replaces paper
work. It covers 10 work processes and 54 services (list: `Documents/Transport_&_Road_Dev_Adm_Dep't_Services_&_stackholders.docx`,
Wolaita Zone):

1. Driver and vehicle competency
2. Public transport
3. Freight competency
4. Road traffic safety
5. Road quality and safety audit
6. Design and contract administration
7. Community participation
8. Logistics
9. HR (incl. the office payroll list sent to Finance)
10. Development plan and budget

**Read first:**
- [`docs/architecture.md`](docs/architecture.md): the design.
- [`docs/decisions/`](docs/decisions/README.md): fixed decisions. Do not re-open them; supersede one with a new ADR.
- [`docs/ethiopia-context.md`](docs/ethiopia-context.md): laws and national systems.
- [`docs/audit.md`](docs/audit.md): what came from the old project.
- [`docs/platform/`](docs/platform/README.md): unit types and settings, modularization, menus and shell, design system,
  enterprise capabilities.
- [`docs/phases/`](docs/phases/phase-0.md): the task list. **Work one task at a time, in order, and only when asked.**
- [`docs/engineering/workflow.md`](docs/engineering/workflow.md): definition of ready and done, evidence, branches,
  releases. Record every task's status and evidence with `node tools/progress/cli.mjs` (source:
  `docs/engineering/progress.json`; `progress.md` is generated). Skills: `/task-start`, `/task-status`, `/task-review`,
  `/phase-report`. Hooks, status line and dashboard: [`docs/engineering/dashboard.md`](docs/engineering/dashboard.md).
  Also: [NFRs](docs/engineering/nfr.md), [testing strategy](docs/engineering/testing-strategy.md),
  [API guidelines](docs/engineering/api-guidelines.md), [threat model](docs/engineering/threat-model.md).

**Vendor:** **ABA Nexus Technologies** (brand) / **ABANEXUS SOFTWARE DEVELOPMENT PLC** (licensed name;
use it exactly in legal texts) · abanexustech.com · abanexustech@gmail.com. ITRMS is the company's proprietary product.

**Business situation:** a self-built product. **No bureau has commissioned it.** It will be proposed to transport and road
bureaus across Ethiopia ([`docs/go-to-market.md`](docs/go-to-market.md)). Everything must stay region-agnostic. The demo uses
neutral "Sample Regional Bureau" branding, and real names, logos and stamps appear only with permission.

**Reference design (not a customer):** Wolaita Zone, South Ethiopia Regional State: 16 woredas and at least 8 town administrations (7 on the zone site + Bitena). Languages are
Amharic (default), English and Wolaytta (`wal-Latn`). See [`docs/tenant-wolaita.md`](docs/tenant-wolaita.md),
[`docs/service-catalogue.md`](docs/service-catalogue.md), [`docs/roles-and-permissions.md`](docs/roles-and-permissions.md),
[`docs/i18n-and-languages.md`](docs/i18n-and-languages.md) and [`docs/demo-plan.md`](docs/demo-plan.md). **Source order:**
`Documents/` first, then the national context, then a stated assumption that is asked about ([`docs/README.md`](docs/README.md)).

**Current state (2026-10-18):** planning only. The repo still holds the copied *Digital File Cabinet* (`Frontend/` Next.js,
`Backend/` FastAPI, `contracts/`, `features/`). Phase 0 turns it into the monorepo below (tasks 0.1–0.5). Its old guidance is
in `docs/legacy/CLAUDE.digital-file-cabinet.md`.

## Glossary (Amharic ↔ English)

| Term | Amharic | Meaning in ITRMS |
|---|---|---|
| Region / kilil | ክልል | Top org unit; one installation per region. Regional **bureau** = ቢሮ |
| Zone | ዞን | Middle level (some regions have none). Zone **department** = መምሪያ |
| Woreda | ወረዳ | District; woreda office = ጽ/ቤት. Has a category: **ምድብ** 1, 2… |
| Special woreda | ልዩ ወረዳ | Woreda directly under the region |
| Town / city administration | ከተማ አስተዳደር | Town transport & logistics unit (ዩኒት), graded **ፈርጅ** 1–4 (a ፈርጅ-1 town handles licences); cities may have **sub-cities** (ክፍለ ከተማ) |
| Unit type | — | The kind of office (zone department, ፈርጅ-1 town, ምድብ-1 woreda …): its default services, roles, capabilities (ADR-0026) |
| Kebele | ቀበሌ | Lowest administrative unit; used in addresses and safety clubs |
| Work process | ሥራ ሂደት | One of the 10 functional areas (= one backend module) |
| Bolo | ቦሎ | Annual vehicle technical inspection and its certificate/sticker |
| Libre | ሊብሬ | Vehicle ownership title booklet |
| Plate | ሰሌዳ | Number plate; national format `ETH`/`ኢት` + 3 letters + 4 digits (Directive 1050/2025) |
| Driver licence | መንጃ ፈቃድ | Driver qualification certificate licence (Proclamation 1074/2018), with grades |
| Menahariya | መናኸሪያ | Bus terminal |
| Mahber | ማህበር | Association: taxi, public transport or freight; licences renewed yearly |
| Route (deployment line) | የስምሪት መስመር | Licensed public transport route |
| Tariff | ታሪፍ | Approved fare |
| Unit rate | የቁርጥ ዋጋ | Price per work item, sent by the region for designs and contracts |
| DC3 | — | Road design standard class; "roads upgraded to DC3" is a design and contract service |
| Advance payment | ቅድመ ክፍያ | Contract advance, recovered from later payment certificates |
| Form 15 | ፎርም ቁጥር 15 | Civil-service staffing establishment table (positions, job codes, grades) |
| Fayda | ፋይዳ | National digital ID (FIN/FAN) |
| E.C. / ዓ.ም | ዓ.ም | Ethiopian calendar; months Meskerem…Pagume; fiscal year (EFY) Hamle 1 – Sene 30 |
| Birr / santim | ብር / ሳንቲም | Currency; 1 Birr = 100 santim (money is stored in santim) |
| Road Fund / Insurance Fund | የመንገድ ፈንድ / መድን ፈንድ | Stakeholders receiving fee and accident data |
| MoTL | — | Federal Ministry of Transport and Logistics (national vehicle registry, driver platform, penalty system) |

## Stack (fixed: see ADRs)
- **Monorepo:** pnpm workspaces + Turborepo.
- **Web:** `apps/web`, Next.js App Router + design system; a BFF that holds the Keycloak session.
- **API:** `apps/api`, NestJS modular monolith on Fastify, one module per work process. It also runs as `worker` for
  BullMQ jobs.
- **Database:** PostgreSQL 16 + Drizzle (migrations committed), RLS.
- **Identity:** Keycloak (2FA, groups = org units).
- **Jobs:** BullMQ + Valkey.
- **Documents:** HTML (LiquidJS) → PDF with Puppeteer, QR verification, Noto Sans Ethiopic.
- **Files:** S3 API on SeaweedFS (ADR-0007, ADR-0020); ClamAV scanning from Phase 1 (ADR-0022).
- **Deployment:** Docker Compose + Nginx, one installation per region, nightly off-site backups **inside Ethiopia**.
- **Tests and CI:** Vitest, Playwright, GitHub Actions.
- **Observability:** OpenTelemetry → Grafana Alloy → Prometheus, Loki, Tempo; Grafana; errors via the Sentry SDK to GlitchTip
  (ADR-0023). **Web resilience:** Serwist, Dexie, Uppy (ADR-0024).
- **Tool choice:** capability-first; licences are recorded in a report, not a gate (ADR-0025). Every tool and version:
  [`docs/tech-stack.md`](docs/tech-stack.md).

## Repository layout (target)
```
apps/web                    composition root: shell, generated route files, BFF route handlers, shell messages
apps/api                    composition root: main, worker, worker-documents, migrate; the single migration history
apps/verify                 public verification page + verifier PWA (static export, no session)
platform/<key>              slice packages (ADR-0032), in this dependency order: kernel (config, errors, context, db, iam,
                            org, settings, audit, numbering, idempotency, outbox, jobs, effects, files, i18n, notifications,
                            search, ports, web runtime) → integrations → forms → fees → documents → workflow → services → reports
modules/<key>               slice packages (ADR-0027): module.ts manifest, contracts/, api/, web/, messages/, seed/, test/
                            registries: parties, vehicles, drivers, associations, road-assets
                            work processes: competency, public-transport, freight, road-safety, road-quality,
                            design-contracts, community, logistics, hr, planning
packages/schemas            shared primitives: Money, I18nText, ids, dates, problem+json, error codes, form contract
packages/form-engine        form engine: core (UI-free; also runs in the API), renderer, designer, viewer
packages/ui                 design system (shadcn/ui + Radix + Tailwind 4), incl. the Ethiopian DatePicker
packages/ethiopian-calendar conversion, formatting, fiscal year
packages/module-sdk, api-client, testing, config   manifest types · OpenAPI + typed client · test kit · lint/ts presets
infra/compose, infra/backup Compose files, nginx, keycloak realm/theme, backup and restore scripts
docs/                       architecture, audit, ethiopia-context, phases, decisions, legacy
Documents/                  domain source material (service list, scanned forms); never edit, never publish
```
What goes where, file naming and the full rules: [`docs/platform/code-structure.md`](docs/platform/code-structure.md).
Boundaries (dependency-cruiser, CI):
- `schemas` and `ethiopian-calendar` import nothing internal.
- `form-engine/core` has no React or DOM.
- `apps/api` and every `api/` entry never import `ui` or the UI parts of `form-engine`; `web/` never imports `api/`.
- Layers are folders and point downward only: `packages` → `platform` (kernel, then services) → registries →
  work-process modules. Work-process modules never import each other (use events or a registry). Imports go only through
  a slice's package exports (`contracts`, `api`, `web`, `seed`, `manifest`).
- Code checks **services and capabilities** of the active unit, never unit names or unit-type keys (ADR-0026).

## Commands
Available after task 0.2 (until then the legacy commands are in `docs/legacy/CLAUDE.digital-file-cabinet.md`):
- `pnpm i` · `pnpm dev:infra` (Compose: postgres, valkey, keycloak, S3, mailpit) · `pnpm dev` (web :3000, api :4000)
- `pnpm turbo run lint typecheck test build` · `pnpm --filter @itrms/api test:int` (real Postgres) · `pnpm e2e`
- `pnpm --filter @itrms/api db:generate` (drizzle-kit, review the SQL) · `db:migrate` · `pnpm demo:reset`
- `pnpm i18n:check` · `pnpm licences:report` · `pnpm openapi` (regenerate `packages/api-client/openapi.json`)

Windows: run Docker via WSL2. Prefer pnpm over npm (npm 10's resolver crashed on this codebase).

## Design rules (fixed)
- **Tenancy:**
  - One database with a shared schema, and an org-unit tree with configurable depth and level names per region.
  - RLS policies `TO itrms_app`, null-safe settings, **no bypass setting**; system work only as `itrms_system` in the worker.
    Roles come from ITRMS `role_assignments` per unit, not token claims (ADR-0031).
  - Sensitive personal data lives in separate field-encrypted tables, read only through the audited `reveal()`.
  - A user sees their active unit's subtree. Isolation is enforced twice: guards (role + unit) **and** RLS.
  - Every query runs in `db.scoped(ctx, tx => …)`. Never use the raw pool, and never use `system_context()` in request
    code.
- **Registries are regional, transactions are local.**
  - Vehicles, plates, drivers and licences, associations, routes and people are regional records.
  - Inspections, renewals, fines, payments and documents carry `handling_unit_id`.
  - A transfer changes the handling unit and never copies the record.
  - Where a national system (MoTL) is the system of record, store its reference and never a competing value.
- **Every service is configuration:** form + workflow + fee rule + document templates, with bureau defaults and overrides
  only on allowed keys down the tree. A case freezes its resolved configuration. Code lives only in module **effects** that
  the configuration names.
- **Typed core tables; form answers in JSONB** linked to the case, the form version and record ids. Effects copy the facts
  into typed tables. Reports read typed tables; only the data viewer queries JSONB (service-filtered, indexed filterable fields).
- **Money** is `bigint` santim (`Money` type) or `numeric` for quantities and rates. **Never use JS floats for money.**
- **Numbers** (licence, plate, receipt, certificate) come from transactional counters in the business transaction:
  gapless, never reused.
- **Time:** Africa/Addis_Ababa. Store Gregorian (`timestamptz` UTC, `date`); display, enter and print Ethiopian.
- **Audit:** every write produces an append-only audit row in the same transaction. Sensitive reads are audited too.
- **i18n:** per-tenant languages, Amharic and English first (Wolaita: + `wal-Latn`). No user-visible string outside the message catalogues; data
  names are `I18nText`. Keys are **required** in `am` and `en` (CI fails); optional languages (`wal-Latn`) are reported and fall back.
- **Payroll:** ITRMS prepares, approves and sends the **office payroll list** to Finance. Finance pays and does its own
  accounting (ADR-0016). Salary scales, tax and pension rates are versioned configuration.
- **Work never done in an HTTP request:** PDFs, SMS, reports, imports and external calls go through the outbox → BullMQ.
- **Validation:** Zod schemas from the slices' `contracts` (primitives from `packages/schemas`) at every boundary. Form submissions are validated on the server with
  `packages/form-engine/core`; the browser check is a convenience.

## Coding conventions
- TypeScript `strict`. No `any` (use `unknown` + Zod). No non-null assertions in API code.
- Files are kebab-case. NestJS: `<name>.module.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`. Tables and columns
  are snake_case and plural (`driver_licences`). Domain words follow the bureau's English: `licence` (noun), `organisation`,
  `bolo`, `libre`, `mahber`.
- Errors: throw `AppError` subclasses with a stable snake_case `code` and an i18n `title` key. Never return raw errors, and
  never catch-all.
- Controllers stay thin: `@Require('resource:action')` on every handler, a Zod DTO in, a service call, a Zod DTO out.
  Business rules live in services and effects.
- Every POST is idempotent (`Idempotency-Key`). State changes on cases only through workflow transitions.
- Frontend: UI only from `packages/ui`; server state only through TanStack Query; HTTP only through the BFF client; forms
  are hand-written (`useZodForm`) or engine-rendered. Never handle tokens in the browser.
- i18n keys look like `<owner>.<area>.<key>` (owner = the slice key, `shell` or `common`; e.g. `competency.nav.applications`),
  live in the owning slice's `messages/`, and must exist in every enabled language. Amharic text lives only in catalogues,
  seeds and fixtures.
- Comments explain *why*, sparingly. Match the surrounding code.
- Seed and demo data are generated. **Never use real people's data** from `Documents/` or anywhere else.
- Commit messages: conventional commits (`feat(competency): …`).

## Definition of done
The full rules, including the definition of ready and the evidence to record, are in
[`docs/engineering/workflow.md`](docs/engineering/workflow.md). The summary: a task is done only when all of these hold, its
"Done when" items are demonstrated, and the evidence is recorded in `docs/engineering/progress.md`:
1. **Tests pass:** lint, typecheck, unit and integration (real PostgreSQL 16) and the affected e2e journeys, locally and on
   CI.
2. **Tenant-isolation tests pass:** every new or changed tenant table has RLS policies of its class, and the isolation
   matrix (own, child, parent, sibling, other zone, other region, no context) covers it.
3. **i18n keys are present** in `am` and `en` (`pnpm i18n:check`; optional languages reported), and new data names are `I18nText`.
4. **Audit entries are written** for every new write path, in the same transaction (a test asserts it).
5. Migrations are generated, reviewed and applied from zero in CI. The OpenAPI contract is regenerated if the API changed.
6. Money is integer santim, numbers come from counters, and dates are Gregorian in storage (no exceptions without an ADR).
7. Security scans are clean (gitleaks, Trivy, Semgrep; no new high findings), and there are no secrets in the diff. New
   dependencies come from [`docs/tech-stack.md`](docs/tech-stack.md) or are added to it in the same PR.
8. The docs are updated: the phase task is marked done, and ADRs, architecture and READMEs changed if the design changed.
9. Security- or money-sensitive changes are reviewed (reviewer agent) before they are declared done.
