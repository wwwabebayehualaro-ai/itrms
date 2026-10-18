# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Digital File Cabinet: a dynamic form/template builder with file uploads and form submissions, structured as **hybrid feature
delivery** (Option 3 of the Teller Portal Architecture Strategy): complex work is written as code in feature modules, simple
standard forms are built with the Form Builder, both on one reusable platform. Read `Docs/architecture/README.md` (overview,
rules), `Docs/architecture/capability-catalog.md` (what the platform offers) and `features/README.md` (coded or form?) before
adding a feature. Restructure progress and open items: `Docs/architecture/PROGRESS.md`. What the form builder still lacks for
enterprise grade (17 gaps, in order, with status): `Docs/architecture/form-builder-gaps.md`.

Monorepo with two independent apps (no root-level build) plus shared contracts:

- `Backend/app` — FastAPI + async SQLAlchemy (PostgreSQL, JSONB/UUID columns), Alembic in `Backend/alembic`.
- `Frontend` — Next.js 16 (App Router, Turbopack) + React 19; design system on shadcn/ui + Radix + Tailwind 4 + lucide icons
  (PrimeReact was removed, see `Docs/architecture/ui-migration.md`), Zustand, TanStack Query/Table/Form, Zod, dnd-kit.
- `contracts/openapi.json` — the API contract, generated from the backend; the frontend's types are generated from it.
- `features/<id>/feature.yaml` — feature registry (delivery path, owner, wiring).

Tests: backend pytest (`Backend/tests`); frontend Vitest (`Frontend/tests/unit`) and Playwright (`Frontend/tests/e2e`).

## Commands

Frontend (run from `Frontend/`):
- `npm run dev` (port 3000), `npm run build`, `npm run lint` (ESLint 9 flat config, `eslint.config.mjs`), `npm run typecheck`, `npm run format`
- `npm test` (Vitest, happy-dom), `npm run e2e` (Playwright; starts its own dev server on :3100 with `NEXT_DIST_DIR=.next-e2e`;
  needs a backend at `E2E_API` with the demo data, runs with one worker)
- `npm run api:types` (regenerate `platform/lib/api/schema.d.ts` from `../contracts/openapi.json`), `npm run api:check` (fails on drift)
- `npm run check:engine` (form engine extension points), `npm run check:runtime` (data layer), `npm run form:schema` (writes `contracts/form-config.schema.json` from the engine; `-- --check` fails on drift), `npx tsx scripts/checkDesignerRoundTrip.mts <fixtures.json>` (the builder round-trips real forms unchanged)
- Add a design-system primitive: `npx shadcn@4.21.0 add <name>` (writes to `platform/ui/primitives`), then export it from `platform/ui/index.ts`.
- Requires `NEXT_PUBLIC_BACKEND_API` (used by `platform/lib/api/client.ts`). `pdfjs-dist` is pinned to 3.11.174 to match the PDF viewer's worker (`next.config.js` aliases its optional `canvas` import for Turbopack).
- If a route answers 404 in `next dev` after route files were moved, delete the stale dev cache (`.next`, `.next-e2e`) and restart.
- If Turbopack's dev server fails with `0xc0000142` (it cannot start its PostCSS worker processes, e.g. while another dev server runs), start the second server with `next dev --webpack` (`next.config.js` covers both bundlers); webpack compiles each page slowly on first visit.
- If `npm install` of a new package crashes with `Cannot read properties of null (reading 'edgesOut')` (npm 10 resolver bug), install it with `npx npm@11.6.2 install ...`; plain `npm install` works afterwards.

Backend (run from `Backend/`, see `Backend/README.md`): `pip install -r requirements-dev.txt`, copy `.env.example` to `app/.env` (untracked; `JWT_SECRET` required outside development), `alembic upgrade head`, `python -m app.cli create-tenant ...`, `uvicorn app.main:app --reload`, `pytest` (SQLite) or `TEST_DATABASE_URL=postgresql+asyncpg://... pytest` (adds RLS/migration tests; it drops the schema of that database — use a throwaway one). After any API change: `python -m app.cli export-openapi` (a test fails otherwise) and `npm run api:types`. `python -m app.cli purge-idempotency` deletes expired idempotency records.

## Frontend platform (`Frontend/platform`) — reuse, don't reimplement

Cross-cutting frontend code lives in `platform/` (see `platform/README.md`); feature code in `app/` and `layout/` may use it only through public entry points, enforced by ESLint (`eslint.config.mjs`):

- `@platform/lib/...` (no UI): `api/client` (the only HTTP client; owns auth: bearer token + one transparent refresh on 401; sends an `Idempotency-Key` with every POST), `api/types` (`ApiSchema<'Name'>`, generated API types), `api/errors` (`getApiErrorMessage`), `api/useApiRequest`, `auth/*` (session, `useAuthStore`, `useCan`), `forms/serverErrors`, `modules` (`useModules`, `useFeatureFlag`), `approval` (`useApprovals`, `useApprovalActions`), `numbering`, `format`, `download`, `logger`.
- `@platform/ui`: design-system primitives (`Button`, `Input`, `Select`, `Dialog`, `Sheet`, `Table`, `Tabs`, `Card`, `Badge`, `Field`, `Sidebar`, ...; plain Tailwind classes, tokens in `app/globals.css`), forms kit (`useZodForm` + `ZodForm` + `form.AppField` field components: TanStack Form + Zod, server field errors mapped onto fields), platform screens (`ApprovalInbox`, `FeatureFlagsAdmin`, `SequencesAdmin`, `FeatureGate`). `NotifyProvider` is mounted once in the root layout and owns the single sonner `<Toaster>` and the confirmation AlertDialog — never render your own; use `useNotify()` and `confirmAction()`. `QueryProvider` owns the single TanStack `QueryClient` (failure toasts, retry policy, cache cleared on user change). Composite controls: `Combobox` (searchable single/multiple pick), `DatePicker`, `TagsInput`, `Pager`, `IconButton` (name + tooltip), `StatusBadge`; charts via `ChartContainer` (Recharts). Also `DataGrid` (TanStack Table, server-driven), `InlineStatus`, `LabeledField`, `KeyValueEditor`, `JsonEditor`, `AuthGate`, `FileViewer`.
- UI is built only from `@platform/ui`: importing `radix-ui` outside `platform/ui/primitives`, or `primereact`/`primeflex`/`primeicons` anywhere, is an ESLint **error**.
- **Server state is TanStack Query only** (no `useEffect`+`useState` fetching): keys via `createKeys` (`@platform/lib/query/keys`); engine hooks `useTemplateList/useTemplateQuery/useTemplateMutations` (incl. `publish`), `usePublishedTemplate`, `useSubmissionList/useSubmissionMutations` (`@platform/form-engine`), `useFileUpload/useFilePreview`. Mutations invalidate their own keys and their failures are toasted centrally (`meta.errorMessage` / `meta.silent`).
- The form engine (`platform/form-engine`, see its README): `core` (UI-free model, rules, Zod validation, the stored types and the
  backend contract), `renderer` (`EngineForm` on TanStack Form + the field kit on `@platform/ui`), `designer` (the builder: document
  store with undo/redo, canvas = the field kit in design mode, inspector generated from each type's Zod settings), `viewer` (data
  viewer), `Runtime` (data sources, `{{...}}` bindings, formulas; no `eval`/`new Function`). A field type is one kit definition:
  `defineFieldType` (render) + `describeFieldType` (palette, starting settings, settings schema); then `npm run form:schema` so the
  backend accepts it. Stored forms are read as they are (no data migration); a field whose type the kit lacks is named, not rendered.
- `@platform/form-engine` (`FormRenderer`, `PublishedFormRenderer`, `DataViewer`, `TemplateStatusTag`, hooks, extension points
  `defineFieldType`, `describeFieldType`, `registerAction`) and `@platform/form-engine/builder` (`TemplateBuilder`, the builder store).
  Never import deeper paths.
- Never use `fetch`/`axios` directly or handle tokens in features.

## Architecture

**Backend platform** (`Backend/app/foundation`, owned by the platform team, portable to other systems — it never imports `app.modules`/`app.main`, enforced by `tests/test_architecture.py`; see its README): typed settings, one error model (raise `AppError` subclasses; RFC 9457 problem+json; never `HTTPException`/catch-all in features), auth (`foundation/auth`: JWT + rotating refresh), default-deny authorization (`secure_router()`, `require("res:action")`), row-level multi-tenancy (`EntityBase`, enforced by session hooks + PostgreSQL RLS), automatic append-only audit, soft delete, optimistic locking, generic `Repository`/`CrudService` (`add/update(flush=False)` to fold follow-up changes into one write), observability (JSON logs with request ids, `/metrics`, `/healthz`, `/readyz`), plus:
- `registry/`: module registry (`ModuleSpec`: routers, menu, flags, dependencies) and per-tenant feature flags (`/platform/modules`, `/platform/flags`; switched-off modules answer 404 `feature_disabled`).
- `approval/`: maker-checker (`approval.register_policy(key, approver_permission, on_approved=...)` — effects are code and run in the decision's transaction; the maker can never decide; `/platform/approvals`).
- `numbering/`: gapless per-tenant document numbers (`numbering.register`, `next_number(session, key)`; `/platform/sequences`).
- `idempotency/`: `Idempotency-Key` guard for commands (`Depends(idempotency())`, `await idem.run(...)`).
- `api/contract.py`: the OpenAPI contract file. `platform.py`: the foundation's own `ModuleSpec`.

**Feature modules** (`Backend/app/modules/<feature>/`): `module.py` (`SPEC = ModuleSpec(...)`) + `routers/` → `services/` → `models/`, with Pydantic `schemas/`; listed in `app/modules/__init__.py` (`INSTALLED_MODULES`), mounted by the registry; models imported in `app/models.py`; new tables get `enable_rls_sql` in their migration. Current modules: `form_builder` (`/template`, publish workflow), `form_submission` (`/form`: submissions, `/query`, `/export`, `/views`, server actions), `files` (`/files`), `core_banking` (`/core-banking`: simulated core behind `CoreBankingGateway`, accounts, teller transactions, the `core_banking.cash_transaction` server action, approval policy `bank_txn.post` above `CORE_BANKING_APPROVAL_LIMIT`, roles `teller` / `teller_supervisor`).
**Server actions** (form + code): a module registers `register_server_action(key, permission, input_model, handler)` (`form_submission/services/server_actions.py`); a form names it in `form_config.runtime.submit.serverAction`; on submit (not draft) the permission is checked, the values validated by the input model (422 per field) and the handler run in the request's transaction; the request is then locked (409 `submission_locked`), later outcomes via `settle_submission`. Saving a form checks the action exists and the form has its required fields (`form_config.register_check`). `/auth` (incl. `GET /auth/directory`, a tenant-scoped people picker for every role) lives in the foundation. Permissions registered with `sensitive=True` (e.g. `user`, `feature_flag`, `approval`, `sequence`) are never matched by `*:action` wildcards. Every route except `/auth/login|refresh|logout` and the ops endpoints requires a bearer token. Files go through the `Storage` abstraction.

**Data model**: `FormTemplate` stores the whole builder output in `form_config` (JSONB; checked on save against `contracts/form-config.schema.json` + structure, `form_builder/services/form_config.py`) plus `file_relations` (JSONB) and a publish state (`status`: draft / pending_approval / published; `published_version_id` → the `TemplateVersion` people fill in). `FormSubmission` holds user submissions, always recorded on the published version (`409 form_not_published` before the first publish). Without the flag `forms.require_approval` every save publishes at once; with it, `POST .../templates/{id}/publish` creates a `template.publish` approval. The form schema is therefore defined by the frontend builder, not by DB columns.

**Frontend flow** (under `app/(main)/`, route groups do not change URLs):
- `(forms)/` — the builder path. `dynamic-template/`: routes `builder` (renders the engine's `TemplateBuilder`), `saved-templates` (gallery with publish state and Publish action), `code-UI` (a JSX playground, not a form editor). The engine itself is `platform/form-engine` (above); `PublishedFormRenderer` renders fill screens on the published version.
- `(forms)/submitted-forms/` — requests of ONE form, for any form (`template/[templateId]`): the **data viewer** (`DataViewer` from `@platform/form-engine`, see `platform/form-engine/viewer/README.md`: table, cards, board, calendar, pivot, dashboard; filters, search, saved views, CSV export; the view lives in the URL), New request / Edit in a dialog (`RequestEditorDialog`, on the published form), and each request opens as a page (`[submissionId]`: the form as it was filled in, "form changed" notice, history). A hand-built `<slug>-table` template stays available as the default "Report" view. Data comes from the server query API (`POST /form/submissions/query`, schema at `GET .../query/schema`); modes never filter in the browser. Proof: `scripts/e2e/data-viewer` (`run.cjs`, `modes.cjs`, `record.cjs`, `views.cjs`, run `../demo/seed-demo.cjs` first).
- `(forms)/submitted-forms/status/[status]` and `filter/[param]` (`my-submissions`, `recent` = last 7 days) — requests of every form (`RequestsList`, server-filtered: `GET /form/submissions?status=|mine=true|created_after=`).
- `(forms)/(actors)/maker/form-intiator` — Templates Pool (`TemplatesManager mode="start"`). `app/(main)/page.tsx` — the dashboard (`DashboardScreen`).
- `(coded)/<feature>/` — coded features (`core-banking`; rules in its README). `(platform)/` — thin pages for platform screens: `/approvals`, `/admin/feature-flags`, `/admin/sequences`.
- Route files (`page.tsx`) must not take props: reusable screens live beside them (e.g. `saved-templates/TemplatesManager.tsx`) or in `@platform/ui`.
- Reference multi-record form (template JSON, builder + real-data e2e scripts): `Frontend/scripts/e2e/expense-report/`.
- Reference form + server action: `Frontend/scripts/e2e/cash-transaction/` (account lookup with `behavior.validation.remote`, computed details, posting by `core_banking.cash_transaction`; `node seed.cjs` adds accounts, `teller@` / `supervisor@` and the form; Playwright `tests/e2e/cash-transaction.spec.ts`).
- `(coded)/core-banking/accounts` — read-only accounts list (teller menu). Teller transactions are the cash form's requests (its data viewer).
- Demo data for showing the product (three forms + 15 requests in the DB, click path): `Frontend/scripts/e2e/demo/` (`node seed-demo.cjs`).
- Multi-record forms: `FormArray` field (rows of child fields, per-row validation/visibility, `{{= formula }}` with `row`/`root` scopes) — see `platform/form-engine/Runtime/README.md`.
- App frame: `layout/AppShell.tsx` (shadcn Sidebar, top bar with theme toggle and user menu). The menu (`layout/AppNav.tsx`) is built from the module registry's menu (`useModules()`; `NavItem.icon` is a lucide name mapped in `layout/navIcons.ts`); its `form-templates` slot is filled with the tenant's forms.
- State: the builder's Zustand store is `platform/form-engine/store/formStore`; API access via `useTemplates`/`useSubmissions` (form-engine) and `platform/lib/api/useFileUpload`, all using the platform client.
- Path aliases: `@/*` → `Frontend/*`, `@platform/*` → `Frontend/platform/*`.
- `(full-page)/` holds pages outside the app frame: sign-in, `/auth/access` (403), `/auth/error` (`StatusScreen`); `app/not-found.tsx` is the 404.
