# Audit of the existing project (Digital File Cabinet → ITRMS)

Written 2026-10-17, before any code was changed. It covers what the copied project contains, what each part becomes in
ITRMS (KEEP / PORT / DROP), and what the form builder lacks for ITRMS. The target stack and rules are fixed (see
[`decisions/`](decisions/README.md)); this audit does not re-open them.

## 1. Summary

- The copy is a working **dynamic form platform**: a Next.js 16 / React 19 frontend with its own design system and a
  form engine (builder, renderer, data viewer), and a FastAPI backend with a reusable "foundation" layer (multi-tenancy with
  RLS, audit, approvals, numbering, idempotency, problem+json errors). It was built for a bank teller portal, and the
  banking and demo parts are product-specific.
- **The most valuable asset is the frontend:** `platform/ui` (design system) and `platform/form-engine` (25 field types,
  repeating rows, safe formulas, data sources, lookups, versioned publishing, a server-driven data viewer). It is TypeScript
  and moves almost unchanged into `packages/ui` and `packages/form-engine`.
- **The backend is Python and is retired.** Its *designs* are good and are ported to NestJS: tenant guard + RLS, audit in
  the same transaction, gapless counters, idempotency keys, problem+json, "effects are code" approvals, the allow-listed JSON
  query compiler behind the data viewer.
- **Main gaps for ITRMS:** forms are validated only in the browser. Labels have one language, and dates are Gregorian
  `en-US`. There are no lookup-to-registry fields, no multi-step workflow, no PDF output and no jobs. Tenancy is flat (one
  tenant id), with no org tree. That last one is the largest structural change.
- **Repo hygiene:** the source code is untracked in git. Only `Documents/` is committed (1 commit). There is no CI. Two env
  files with secrets are not ignored.
- **Ethiopian context** (laws and national systems, researched): [`ethiopia-context.md`](ethiopia-context.md). The
  biggest findings: vehicle registration became national (Directive 1050/2025); MoTL is centralising driver licensing and
  traffic penalties; personal data must stay in Ethiopia; and the office payroll list is in scope (ADR-0016).
- **Domain material:** `Documents/` holds the Wolaita Zone service list (the 54 services, with stakeholders) and 25 scans.
  The scans are **staffing tables (Civil Service "Form 15")**, not service forms. No paper form of a licensing service
  (application, inspection checklist, receipt) is in the repo yet.

## 2. Inventory

| Area | Path | Stack and versions | Notes |
|---|---|---|---|
| Frontend app | `Frontend/` | Next.js 16.3.8 (App Router, Turbopack), React 19.3, TypeScript 5.9, Tailwind 4.3, ESLint 9 flat config, npm (`package-lock.json`) | Package name `digital-file-cabinet` 10.1.0. Route groups `(forms)`, `(coded)`, `(platform)`, `(full-page)` |
| Design system | `Frontend/platform/ui` | shadcn/ui 4.21 (copied source) on `radix-ui` 1.6.7, lucide, sonner, Recharts 3.8, react-day-picker 10, cmdk | 30 primitives + composite controls (`Combobox`, `DatePicker`, `TagsInput`, `Pager`, `DataGrid`, ...), forms kit (`useZodForm`: TanStack Form 1.33 + Zod 4.6), `NotifyProvider`, `QueryProvider`. Exported only through `@platform/ui` (ESLint-enforced) |
| Form engine | `Frontend/platform/form-engine` | TanStack Form, Zod 4, Zustand 5, immer, dnd-kit | `core/` (UI-free model, conditions, Zod validation, stored contract), `renderer/` (field kit, 25 types), `designer/` (builder with undo/redo), `viewer/` (table, cards, board, calendar, pivot, dashboard), `Runtime/` (data sources, `{{…}}` bindings, own formula parser, no `eval`) |
| Frontend lib | `Frontend/platform/lib` | axios client, TanStack Query 5 | Auth store and refresh logic for the FastAPI JWTs; `format.ts` fixed to `en-US` |
| Backend | `Backend/` | Python 3.12, FastAPI ≥0.115, SQLAlchemy 2 async, asyncpg, Alembic (10 migrations), Pydantic 2, PyJWT, argon2, jsonschema | `app/foundation` (platform) + `app/modules/{form_builder, form_submission, files, core_banking}` |
| Contracts | `contracts/` | `openapi.json` (backend → TS types), `form-config.schema.json` (engine → backend check) | Drift checks on both sides |
| Feature registry | `features/` | `feature.yaml` per feature | Bank/demo features (cash transaction, core banking, expense, leave, equipment) |
| Docs (old) | moved to `docs/legacy/` | | Architecture, ADRs 0001–0003, 17-gap form-builder register, progress log |
| Domain material | `Documents/` | `.docx`, scanned PDFs, photos | See §9 |
| CI | `.github/` | **CODEOWNERS only, no workflows** | |

## 3. How the form builder works today

**Definitions.** A form is one JSON document in `form_templates.form_config` (JSONB). It holds
`{ schemaVersion: 2, fields: FormField[], runtime? }`: a flat list of fields linked by `parentId`, plus an optional runtime
block (data sources, variables, submit settings). A field has `id` (its key), `type` (a kit name), `label` (one string),
`props`, `data` (options binding, computed expression), `behavior` (rules, visibility/enable conditions, remote check,
actions) and `visibleToRoles`.

**Versions.** Every distinct content is stored once in `template_versions` (content-hashed, immutable). The template points
at `published_version_id`. Publishing can need maker-checker approval (flag `forms.require_approval`). **Each submission
records `template_version_id`**, and the record page shows the form as it was filled in, with a "form changed" notice.

**Submissions.** `form_submissions.submission_data` (JSONB) + `status` + `submitted_by` + version. Files are separate
(`stored_files`, local disk). The data viewer queries through `POST /form/submissions/query`, compiled by
`foundation/db/json_query.py` (allow-listed fields, bound parameters, JSONB on PostgreSQL). It answers 200k rows in under
170 ms.

**Validation.**
- *Client:* `core/validate.ts` compiles field rules to Zod (required, lengths, pattern, ranges, dates, files, options, row
  counts, per-row rules) and prunes hidden values.
- *Server:* only the **form definition** is checked (`contracts/form-config.schema.json` + structure,
  `form_builder/services/form_config.py`). **Submitted values are not validated on the server** (legacy gap #1). Only a
  server action's own Pydantic input model checks its fields.
- In a TypeScript backend this gap closes by running the *same* `core/validate.ts` on the server. This is the single biggest
  benefit of the move to NestJS.

**Extension.** `defineFieldType` + `describeFieldType` (render + palette/settings from a Zod schema), `registerAction`,
`registerViewMode`. `npm run check:engine`, `check:runtime` and `form:schema --check` guard these extension points.

## 4. Backend platform (what it does well, to port)

| Capability | Today (`Backend/app/foundation`) | Port to NestJS as |
|---|---|---|
| Tenancy | `EntityBase.tenant_id`, session hook filters every query (fail-closed) + PostgreSQL RLS policy on `app.tenant_id` (`db/rls.py`) | Org-tree scope (`ltree` path) set per transaction with `set_config(..., true)`; RLS policies generated per table; NestJS guard. Flat tenant → **tree** is new work |
| Audit | Automatic field-level diff of every entity change, same transaction, append-only (trigger) | Drizzle write wrapper + `audit_log` with the same trigger |
| Errors | RFC 9457 problem+json with `code` and `trace_id` | Global exception filter + `AppError` classes in `packages/schemas` |
| AuthN/AuthZ | Own JWT + rotating refresh, argon2, lockout; `require("res:action")`, default-deny routers | **Replaced by Keycloak** (OIDC); keep default-deny + `@Require('res:action')` + unit scope |
| Approvals | Single-step maker-checker, effects are code in the decision's transaction | Generalised into the multi-step workflow engine (keep "effects are code") |
| Numbering | Gapless counter row, `UPDATE … RETURNING` in the caller's transaction | Same design (see ADR-0014) |
| Idempotency | `Idempotency-Key` records, 24 h | Same, as a NestJS interceptor |
| Query compiler | `json_query.py`: filters, search, group, aggregate on JSONB, allow-listed | Port to TypeScript (Drizzle `sql` fragments); the viewer depends on it |
| Observability | JSON logs with request/tenant/actor ids, Prometheus `/metrics`, `/healthz`, `/readyz` | pino + `prom-client` + Terminus |
| Module registry, flags | `ModuleSpec` (routers, menu, flags) | NestJS modules + a menu/flag registry |

Tests: 111 pytest tests (SQLite, with PostgreSQL-only RLS/migration tests). They are a useful **checklist of behaviours** to
re-create in Vitest, especially `test_tenancy_audit_features.py`, `test_postgres.py`, `test_numbering.py`,
`test_idempotency.py`, `test_approval.py`, `test_submission_query.py` and `test_field_access.py`.

## 5. Tests and CI

- Frontend: Vitest 5 (happy-dom) with 14 unit files (engine core, designer store, renderer, data viewer, client, forms kit),
  plus Playwright 1.63 with 8 e2e specs (builder, fill form, multi-row, publish approval, smoke). Plus script checks
  (`check:engine`, `check:runtime`, `form:schema --check`, designer round-trip).
- Backend: pytest, 111 tests.
- **No CI pipeline exists.** The progress log records manual runs only.

## 6. Configuration and environment

- Frontend: `NEXT_PUBLIC_BACKEND_API`, `NEXT_PUBLIC_FILES_API`, `AUTH_URL`, `REDIS_URL`, `AUTH_SECRET` (a NextAuth
  leftover), session timeout. **`Frontend/.env` (contains `AUTH_SECRET`) and `Frontend/.env.production` are not
  git-ignored.** Only `.env*.local` is. Fix this before the first commit of the code, and treat that secret as exposed.
- Backend: typed settings (`foundation/config.py`), `Backend/app/.env` (ignored), `JWT_SECRET`, `CORS_ORIGINS`, `UPLOAD_DIR`,
  `OTLP_ENDPOINT`. `Backend/uploads/` holds 22 dev upload files (ignored).
- `docs/legacy/test.md` lists dev demo accounts and a shared demo password. It is dev-only, but it should not travel into
  the new repo's docs.
- Windows dev quirks recorded by the old CLAUDE.md: Turbopack `0xc0000142` with two dev servers, the npm 10 resolver crash.
  pnpm removes the second one.

## 7. Repository state

- `git log`: one commit (`b3e108e docs added`) with the domain documents at the root. Those files were since moved into
  `Documents/`, so they show as deleted plus untracked. **Backend, Frontend, contracts, features and docs are untracked.**
  The legacy progress log cites commits that live in another repository.
- `.next`, `.next-e2e`, `.next-e2e-wp`, `test-results`, `__pycache__` folders exist in the working tree. Ignore them.
- The task list (Phase 0, task 0.1) starts by committing a clean baseline, so the restructure is reviewable as diffs.

## 8. Licences (current dependencies)

> **Update 2026-10-18:** the permissive-only rule was superseded by ADR-0025 (capability-first; licences recorded, not a gate).
> Resulting actions: `@react-pdf-viewer` → react-pdf (paid licence and stale); `sharp` kept; MinIO → SeaweedFS (unmaintained);
> Grafana, Loki and ClamAV adopted. See [tech-stack.md](tech-stack.md).

Original rule at the time of the audit: only MIT/BSD/Apache/PostgreSQL-style licences; flag GPL/AGPL/source-available. From `Frontend/package-lock.json`
(1,077 packages):

| Finding | Licence | Action |
|---|---|---|
| `@react-pdf-viewer/*` 3.12 (18 packages) | **Custom / source-available** (`react-pdf-viewer.dev/license`; commercial use needs a paid licence) | **Remove.** Render PDFs with `pdfjs-dist` (Apache-2.0) directly, or the browser's viewer |
| `@img/sharp-libvips-*`, `@img/sharp-win32-*` (optional, via Next.js image optimisation) | LGPL-3.0-or-later | Flag. Avoid by not using `next/image` optimisation (`images.unoptimized`) or by excluding `sharp`. Decide in task 0.4 |
| `lightningcss` (build tool, dev), `axe-core` (dev) | MPL-2.0 | Weak copyleft, used unmodified at build/test time. Accept and record it in the licence allowlist |
| `dompurify` | MPL-2.0 OR Apache-2.0 | Use under Apache-2.0 |
| `caniuse-lite` | CC-BY-4.0 (data) | Accept |
| Everything else | MIT, ISC, Apache-2.0, BSD, BlueOak, 0BSD, CC0 | OK |

Stack decisions with licence flags (details in the ADRs):
- **MinIO is AGPL-3.0.** The upstream repository was put in maintenance mode (Dec 2025) and archived (2026). No official
  binaries or Docker images have been published since Oct 2025. See [ADR-0007](decisions/0007-object-storage-minio.md). **It
  needs your decision.**
- Other flagged items: Docker Desktop (proprietary, dev machines only; Docker Engine/Compose are Apache-2.0), ClamAV (GPL-2.0,
  if virus scanning is added), Grafana and Loki (AGPL-3.0, if dashboards are added). Noto Sans Ethiopic is under the SIL Open
  Font License 1.1 (permissive for fonts; embedding in PDFs is allowed).
- OK: NestJS, Fastify, Next.js, Turborepo, pnpm, BullMQ (MIT); Drizzle, Keycloak, Puppeteer, Playwright (Apache-2.0);
  Valkey (BSD-3); PostgreSQL (PostgreSQL licence); Nginx (BSD-2).

## 9. Domain material (`Documents/`)

- `Transport_&_Road_Dev_Adm_Dep't_Services_&_stackholders.docx` (Amharic; numbered lists, no tables: per process the
  services, then the stakeholders, each with bulleted roles; fully transcribed in [service-catalogue.md](service-catalogue.md)): the **Wolaita Zone Transport and Road
  Development Department** services per work process, with stakeholders. It lists exactly **54 services** (public transport 6,
  road safety 7, driver and vehicle competency 11, freight 3, quality audit 2, design and contract 7, community
  participation 5, logistics 3, HR 6, plan and budget 4). Stakeholders: regional bureau (directives, tariffs, unit rates,
  **supplies plates, prints licences**, collects fees), training schools, health facilities (medical certificates),
  transport associations, revenue offices, Road Fund, garages, insurers and the insurance fund, traffic police, Ethiopian
  Roads Administration, the regional roads authority's Sodo district, consultants and contractors, the Finance and Plan
  department, civil service offices, the pension agency, media and schools.
- 25 CamScanner PDFs: **Civil Service Commission "Form 15" staffing establishments** (dated 10/07/2018 E.C., South Ethiopia
  Regional State). There is one per directorate of the zone department and per town administration (e.g. Boditi = ፈርጅ 1
  town, Gesuba = level-3 town). Each row holds the position title, job code (e.g. `16/ወሶ-06-33`), grade (I–XV) and count.
  Useful for: the **org tree** (zone → directorates, woreda offices, graded town administrations), **roles**, and the HR
  module's position register and payroll list (Phase 3, ADR-0016).
- 5 photos (one is a duplicate): handwritten **organisation charts** (the regional bureau with transport and road sectors;
  zone departments, town units and woreda offices; city administrations with sub-cities and kebeles) and the list of
  the department head's support positions. Fully analysed in [tenant-wolaita.md](tenant-wolaita.md) §3.
- **Missing:** the paper forms of the services themselves (licence application, medical certificate, exam result sheet,
  bolo inspection checklist, libre, plate register, association renewal file, traffic ticket, accident report, payment
  certificate, receipt pad). These are needed for the Phase 0 demo. See the open questions in the phase-0 plan.

## 10. KEEP / PORT / DROP

KEEP = moves into the monorepo (adapted, not rewritten). PORT = re-implemented in NestJS/TypeScript from the existing
design. DROP = not carried over (it stays in git history after task 0.1).

| Part | Path today | Verdict | Target / reason |
|---|---|---|---|
| Design system primitives, composite controls, forms kit, notify/query providers, `DataGrid`, charts, `FileViewer` | `Frontend/platform/ui` | **KEEP** | `packages/ui`. Replace the react-pdf-viewer parts with `pdfjs-dist` |
| Form engine core (model, conditions, validation, contract) | `platform/form-engine/core` | **KEEP** | `packages/form-engine/core`, which also runs **on the server** for validation. The stored-form Zod schema moves to `packages/schemas` |
| Renderer + field kit, designer (builder), data viewer, Runtime (bindings, formulas, data sources) | `platform/form-engine/{renderer,designer,viewer,Runtime}` | **KEEP** | `packages/form-engine`. HTTP calls go through an injected client, not the app's client |
| Form engine TanStack Query hooks | `platform/form-engine/api` | **KEEP** (adapt) | `platform/forms/web/queries`, typed from the new OpenAPI contract (`packages/api-client`) |
| HTTP client, query keys, format, download, logger | `platform/lib` | **KEEP** (adapt) | `packages/api-client` (HTTP) and `@itrms/kernel/runtime` (format, download, logger). Auth is redone for Keycloak; `format.ts` becomes locale- and Ethiopian-calendar-aware |
| Auth store, session, refresh, sign-in page | `platform/lib/auth`, `app/(full-page)/auth` | **DROP** | Keycloak login (OIDC code flow + PKCE); the sign-in screen is a Keycloak theme |
| App shell, sidebar, dashboard, status screens | `Frontend/layout`, `app/(main)` | **KEEP** (adapt) | `apps/web`: menu from the service catalogue and permissions; org-unit switcher |
| Forms routes (builder, gallery, data viewer, record page, requests lists) | `app/(main)/(forms)` | **KEEP** (adapt) | `platform/forms/web` (builder, data viewer) and `platform/workflow/web` (case screens) |
| Platform screens (approval inbox, feature flags, sequences) | `platform/ui/screens` | **KEEP** (adapt) | The inbox becomes the workflow task inbox |
| Core banking screens, code-UI playground (Monaco), demo pages | `app/(main)/(coded)/core-banking`, `dynamic-template/code-UI` | **DROP** | Bank-specific; the playground loads PrimeReact from a CDN |
| Frontend tests and engine checks | `Frontend/tests`, `scripts/check*.mts` | **KEEP** | Move with their packages; the e2e specs are rewritten for ITRMS flows |
| Demo/e2e seed scripts (bank, expense, equipment, leave) | `Frontend/scripts/e2e/*` | **DROP** | Replaced by Amharic ITRMS seed data |
| FastAPI app, CLI, settings | `Backend/app/main.py`, `cli.py`, `foundation/config.py` | **DROP** (design ported) | `apps/api` (NestJS + Fastify) |
| Tenancy guard + RLS, audit, errors, idempotency, numbering, observability | `Backend/app/foundation/*` | **PORT** | `platform/kernel`; tenancy extended to the org tree |
| Approvals (maker-checker) | `foundation/approval` | **PORT** | Folded into the workflow engine |
| Module registry + feature flags | `foundation/registry` | **PORT** (slim) | NestJS modules; per-unit feature flags |
| Own JWT auth, users, tenants, refresh tokens, people directory | `foundation/auth`, `security/` | **DROP** (directory **PORT**) | Keycloak; a directory endpoint over synced users |
| Template + version + publish endpoints, form-config check | `modules/form_builder` | **PORT** | `platform/forms` (definitions, versions, publish) |
| Submissions, query compiler, saved views, export, history, field-level access, server actions | `modules/form_submission`, `foundation/db/json_query.py` | **PORT** | `platform/forms`; server actions become workflow/service effects |
| Files (upload, type/signature checks, local storage) | `modules/files`, `foundation/storage.py` | **PORT** | `@itrms/kernel/files` on S3-compatible storage (presigned URLs) |
| Core banking module | `modules/core_banking` | **DROP** | Bank-specific. Its gateway pattern is the model for integration adapters |
| Alembic migrations, SQLAlchemy models | `Backend/alembic`, `models/` | **DROP** | New Drizzle schema; there is no production data to migrate |
| pytest suite | `Backend/tests` | **DROP** (as a checklist to **PORT**) | Behaviours re-created as Vitest integration tests |
| OpenAPI contract + drift check | `contracts/openapi.json` | **KEEP** (concept) | Generated from NestJS (`@nestjs/swagger`) into `packages/api-client`; most types are shared directly via Zod |
| `form-config.schema.json` | `contracts/` | **DROP** | Not needed: the API imports the engine's Zod schema directly |
| Feature registry (`features/*.yaml`) | `features/` | **DROP** | Replaced by the **service catalogue** (54 services as configuration, in the database) |
| CODEOWNERS | `.github/` | **KEEP** (rewrite paths) | |
| Old architecture docs, gap register | `docs/legacy/` | **KEEP as reference** | The gap register informs §11 |
| Domain documents | `Documents/` | **KEEP** | Source material; store it in git LFS or outside the repo if it grows |

## 11. Form-builder gaps for ITRMS

"Legacy #" refers to `docs/legacy/architecture/form-builder-gaps.md`. "Task" refers to the phase plans.

| # | Capability | Today | Needed for ITRMS | Task |
|---|---|---|---|---|
| G1 | **Versioned definitions, each submission records its version** | ✅ Content-hashed immutable versions; submissions store `template_version_id`; publish approval | Keep it. Also link the service version (form + workflow + fee + document) to each case | 0.16a, 0.21 |
| G2 | **Server-side validation via shared Zod schemas** | ❌ Browser only (legacy #1) | `packages/form-engine/core` validation runs in the API on submit and on each workflow step. One code path, so there is no parity problem. Hidden-field pruning on the server too | 0.16a |
| G3 | **Conditional fields** | ✅ Visibility/enable conditions (and/or/xor/not), hidden containers hide children; ✅ `requiredWhen` and `validWhen` (formula + message in every language) in core, enforced in the browser and the API, refused at save when a formula cannot run on the server (0.17b) | Keep. `today()` in rules (0.18a) | 0.17b |
| G4 | **Repeating sections** | ✅ `FormArray` with per-row rules, formulas, min/max rows; ✅ printed as a table or one block per row (`printLayout`, 0.17c) | Keep | 0.17c |
| G5 | **File uploads** | ⚠️ Local disk, type/size/signature checks, no scanning | S3-compatible storage with presigned uploads, per-form limits, document type tags (medical certificate, photo, libre copy) | 0.15, 0.18 |
| G6 | **Lookup fields** (pick an existing vehicle, driver, association) | ⚠️ `behavior.validation.remote` + GET data sources can verify a number; no searchable record picker; `{{data.*}}` holds lookups | A `RegistryLookup` field type: searchable picker over a registry (vehicle by plate/chassis, person by name/Fayda, licence, association), stores the **typed record id** (not a copy). The picked record's facts are shown read-only; server-side existence and scope check | 0.18 |
| G7 | **Computed fee fields** | ⚠️ Formulas exist (client-side, `{{= … }}`), no server trust | A `Fee` field showing the **server-computed** fee from the service's fee rule (preview while filling, authoritative on submit). The formula evaluator moves to `packages/form-engine` and runs on both sides | 0.18, 0.22 |
| G8 | **Translatable labels** (Amharic, English, Afaan Oromo, Tigrinya, …) | ❌ One string per label; `en-US` formatting (legacy #11) | `I18nText = Record<lang, string>` for label/help/placeholder/options/messages; the default language is the fallback; builder translation table with "missing" hints; per-tenant language list; Ethiopic-script-safe fonts | 0.13, 0.17a |
| G9 | **Ethiopian-calendar date field** | ✅ `EthDate` on the Ethiopian picker, stored as the ISO Gregorian day, min/max bounds, an E.C. column beside the G.C. day in exports, Ethiopian dates in the viewer and filters (0.17b); the viewer's date buckets stay Gregorian (0.25) | `EthDate` field + `DatePicker` Ethiopian mode: entry and display in the Ethiopian calendar, stored as a Gregorian ISO date; min/max rules in either calendar; fiscal-year helpers | 0.12, 0.17b |
| G10 | **Read-only and print rendering** | ⚠️ Read-only renderer exists (record page); ✅ print rendering in 0.17c (`printModel` + `PrintForm`, plain SSR-safe HTML, page breaks, Ethiopian dates, texts in the chosen language); ⏳ the PDF itself comes with the worker in 0.23 | A `print` mode of the renderer (no controls, page breaks, Ethiopic fonts, Ethiopian dates) used by the PDF worker for application copies; issued certificates use document templates (ADR-0006) | 0.17c, 0.23 |
| G11 | **Workflow per form** | ❌ Single-step publish approval only (legacy #7) | Multi-step workflow from the service configuration (states, approver role per step, SLA) | 0.19–0.20 |
| G12 | **Server-controlled status** | ❌ A submitter can set any status (legacy #2) | Status only moves through workflow transitions | 0.19 |
| G13 | **Per-form and per-unit access** | ❌ Any submitter sees all requests (legacy #3) | Cases are visible by org-unit scope (RLS) and role; the applicant's own cases only, if citizen access comes later | 0.9, 0.19 |
| G14 | **Drafts** | ⚠️ Backend only (legacy #4) | Save draft at the counter (applicant fetches a missing document) | 0.20 |
| G15 | **Multi-step forms** | ❌ (legacy #6) | Useful for long applications; optional for Phase 0 | 1.x |
| G16 | **Overrides down the tree** | ❌ | A zone may override allowed parts of a bureau form (extra field, help text) without forking it; resolution at publish time | 0.21 |
| G17 | **Back-capture mode** | ❌ | Entering old paper records: relaxed rules, an "original date" and paper reference, marked as migrated | 1.13 |

## 12. Risks seen in the audit

1. **Org-tree tenancy is new.** The legacy RLS isolates flat tenants. Subtree visibility plus region-wide registries needs a
   careful policy design and an isolation test matrix (ADR-0011, tasks 0.8–0.9).
2. **The form engine is coupled to the app's HTTP client and auth** (`@platform/lib/api/client`). Extracting it into a
   package needs an injected client. Do it early, while the existing tests still pass (task 0.5).
3. **No real service forms yet.** The demo depends on getting the licence application, exam and fee papers from the bureau.
4. **Connectivity at woreda offices.** The fixed architecture is online-only. If offices are often offline, Phase 1 needs a
   decision (open question).
5. ~~MinIO's licence and maintenance status~~ Resolved: SeaweedFS (ADR-0020).
6. **Receipt numbering.** Government receipts may be controlled pre-printed pads (finance office series). Confirm before
   building receipts (task 0.22).
