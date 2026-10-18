# Option 3 restructure: progress log

Branch: `restructure/option-3-hybrid`. Plan: hybrid feature delivery (Teller Portal Architecture Strategy, Option 3),
a portable foundation, and a modern frontend stack. One entry per step: what changed, how it was verified, and the commit.

Status legend: ✅ done · 🚧 in progress · ⏳ pending · ⚠️ needs attention

## Baseline (before any change)
- Backend `pytest`: 97 passed, 3 skipped (PostgreSQL-only tests).
- Frontend `npx tsc --noEmit`: clean.

## Steps
| # | Step | Status | Verified by | Commit |
|---|------|--------|-------------|--------|
| 0 | Commit work in progress (viewer, auth store, auth hooks) | ✅ | n/a | WIP commit |
| 1 | Stop tracking Python bytecode | ✅ | `git status` clean of .pyc | 0679490 |
| 2 | Backend: feature modules (`app/modules/*`), auth moved into foundation | ✅ | pytest 97 passed / 3 skipped; no stale imports | 409f755 |
| 3 | Frontend: `(forms)` / `(coded)` / `(platform)` route groups | ✅ | `tsc --noEmit` clean; URLs unchanged | 2f5683f |
| 4 | Next.js 16.3.8 + React 19.3 + ESLint 9 flat config + TS 5.9 | ✅ | tsc clean; lint 0 errors; `next build` same routes; check:engine ok; check:canvas 152 snapshots (20 pre-existing ERR) | fe41871 |
| 5 | Typed API contract (OpenAPI → TS) + Vitest + Playwright | ✅ | contract test passes; `api:check` fails on drift (verified); `npm test` 2/2; `npm run e2e` forms path passes on isolated SQLite backend | 6afd727 |
| 6 | Design system stage A (Tailwind 4 + shadcn/ui + Radix, TanStack Form + Zod) | ✅ | tsc clean; lint 0 errors (vendor zones probed: error/warn as designed); vitest 7/7; `next build` ok, prefixed utilities emitted | 1785ecc |
| 7 | Module registry + feature flags | ✅ | pytest 104 passed / 3 skipped (+flags, architecture); vitest 10/10; e2e 3/3 (flag toggle hides menu + API) | dd5dbd4 |
| 8 | Approval engine (maker-checker) | ✅ | pytest 108 passed / 3 skipped (+4 approval scenarios: self-approval refused, permission, double decision 409, failing effect rolls back, isolation); vitest 12/12 | see git log |
| 9 | Document numbering + idempotency | ✅ | pytest 116 passed / 3 skipped (+5 numbering, +3 idempotency); vitest 15/15 (client keeps the key on refresh retry) | dc2a175 |
| 10 | Form publish workflow | ✅ | pytest SQLite 119 passed / 3 skipped and **PostgreSQL 122 passed** (RLS + migrations); migration 0008 backfill checked on PG; e2e 4/4 (editor publishes → admin approves → form takes requests); canvas renderers 0/152 changed | 2522a9e |
| 11 | Migrations 0005–0008 | ✅ | upgrade from 0007 with data, downgrade/upgrade round trip, RLS on the 4 new tables (PostgreSQL 17, throwaway DB) | 2522a9e |
| 12 | Feature registry, architecture docs, CODEOWNERS | ✅ | docs reviewed against the code; CLAUDE.md, READMEs updated | see git log |

## Notes per step
- **Step 4**: versions pinned to releases at least two weeks old (Next 16.4 was too new). `eslint-plugin-react-hooks` 7
  brings React Compiler rules (`refs`, `immutability`, `purity`, `static-components`, `set-state-in-effect`,
  `preserve-manual-memoization`, `use-memo`): 43 findings in existing code, set to *warn* as a backlog. `check:canvas` was already
  broken by a CSS import; fixed with `scripts/lib/ignore-styles.cjs`.

- **Step 5**: `contracts/openapi.json` is the shared contract (backend `export-openapi`, test `test_openapi_contract`;
  frontend `api:types` / `api:check`). Vitest uses happy-dom (jsdom's optional `canvas` peer crashes npm 10's resolver);
  vitest itself had to be installed with npm 11 (`npx npm@11 install ...`), plain `npm install` works afterwards. E2E runs
  against any backend (`E2E_API`); for an isolated run use SQLite: `DATABASE_URL=sqlite+aiosqlite:///e2e.db`,
  `python -m app.cli init-db`, `create-tenant`, then `scripts/e2e/expense-report/seed.cjs` + `demo/seed-demo.cjs`.
  Next 16's dev server writes `Frontend/AGENTS.md` + `CLAUDE.md` (agent hints); they are committed.

- **Step 6**: Tailwind uses `prefix(tw)` and no Preflight because PrimeFlex owns the same class names with other values
  (`p-3` = 1rem, `grid` = flex grid); base styles are scoped to `[data-slot]`. 20 shadcn primitives in `platform/ui/primitives`
  (generated with `npx shadcn@4.21.0 add`), `cn` from shadcn's `cn` package (prefix-aware; verified). Forms kit:
  `useZodForm`/`ZodForm` (TanStack Form `createFormHook` + Zod), server field errors mapped onto fields. Dependencies were
  installed with `npx npm@11.6.2` (npm 10's resolver crashes on some peer sets). Stages B-D: `ui-migration.md`.

- **Step 7**: `ModuleSpec` per module (`app/modules/<m>/module.py`, listed in `app/modules/__init__.py`), the foundation's own
  `PLATFORM` spec (`app/foundation/platform.py`). The sidebar is built from `GET /platform/modules` (Home stays static; the
  `form-templates` slot is filled with the tenant's forms). Menu entries now respect permissions (e.g. submitters no longer see
  the builder). The old "Forms Pool" entry and the "Templates Pool" link pointed to routes that do not exist; "Templates Pool"
  now opens `/maker/form-intiator`, "Forms Pool" was dropped. E2E runs with one worker (specs share backend state).

- **Step 8**: policies are code (`approval.register_policy`), never configuration: the effect of a decision runs in the
  decision's transaction, so "approved" and its effect commit together or not at all. Self-approval is refused before the
  permission check (clear `self_approval` error). Rejections need a reason (422 on `comment`, shown on the field by the forms
  kit). A decision marks every cached query stale (effects can touch any resource).

- **Step 9**: numbers come from one atomic `UPDATE ... SET next_value = next_value + 1 RETURNING` in the caller's
  transaction (no read-then-write race, gapless on rollback; the first number of a period inserts the counter in a savepoint).
  Idempotency records live in their own short transactions so a concurrent duplicate sees the "running" marker at once; if the
  process dies after the business commit but before the response is stored, a retry gets 409 until the record expires (24h)
  rather than acting twice. No module declares a sequence yet (ERP modules will).

- **Step 10**: `forms.require_approval` off (the default) keeps today's behavior: every save is published at once. On: saves are
  drafts, Publish creates a `template.publish` approval; the approved *requested version* is published (later edits stay a
  draft). Requests are always recorded on the published version; the data viewer/query/export read the published form. A save
  and its publish state are written in one flush (`Repository.add/update(flush=False)`), so audit and `row_version` keep one
  step per save (two existing audit tests caught the first attempt). Migration 0008 backfills every existing template as
  published. PostgreSQL checks ran on a throwaway database `dfc_restructure_test` (dropped afterwards).

- **Step 12**: `features/` (README with the classification checklist, `_templates/`, `feature.yaml` for the three reference
  forms), `Docs/architecture/` (README with both runtime flows, capability catalog, ADR 0001 hybrid delivery, ADR 0002 portable
  foundation, ADR 0003 UI stack), `Backend/app/foundation/README.md` (how to reuse it), `.github/CODEOWNERS`, root `README.md`,
  `CLAUDE.md` and `Backend/README.md` updated.

## Major features delivered
| Feature | Where | Try it |
|---|---|---|
| Hybrid structure (coded modules / builder forms / platform) | `Backend/app/{foundation,modules}`, `Frontend/app/(main)/{(coded),(forms),(platform)}`, `features/` | `Docs/architecture/README.md` |
| Module registry + per-tenant feature flags, registry-driven menu | `foundation/registry`, `@platform/lib/modules` | `/admin/feature-flags` |
| Maker-checker approvals | `foundation/approval`, `ApprovalInbox` | `/approvals` |
| Form publish workflow (draft → approval → published) | `modules/form_builder`, `PublishedFormRenderer` | flag `forms.require_approval`, gallery "Publish" |
| Document numbers | `foundation/numbering` | `/admin/sequences` |
| Idempotent commands | `foundation/idempotency`, client `Idempotency-Key` | retry a submit |
| Typed API contract | `contracts/openapi.json`, `npm run api:types` / `api:check` | change an endpoint and run the tests |
| Design system (shadcn/ui + Radix + Tailwind 4) + forms kit (TanStack Form + Zod) | `Frontend/platform/ui` | the three platform screens |
| Next.js 16, ESLint 9, TS 5.9, Vitest, Playwright | `Frontend/` | `npm test`, `npm run e2e` |

## Step 13: everything working end to end (follow-up "make everything work")
| Item | Outcome | Verified by |
|---|---|---|
| Stray migration `fd78bd8cb50e` | Already applied to the dev database, so it is **adopted** (not deleted): rewritten as an idempotent "schema drift cleanup", chain is now `0004 → fd78bd8cb50e → 0005 … 0008`, one head | fresh PostgreSQL through the whole history: 124 passed |
| Dev database `digital_file_cabinet_system` | Backed up (`D:/Digital File Cabinet/db-backups/digital_file_cabinet_system-before-0005.dump`, `pg_restore`-able), then `alembic upgrade head` → `0008`: 12 live forms published with their version, 84 requests intact | queries + read-only smoke e2e on the real data |
| Concurrent logins answered 409 | Fixed: login bookkeeping (last login, failed attempts, lockout) are atomic SQL updates outside the optimistic lock; parallel wrong passwords are all counted | new tests: 5 parallel logins all 200; parallel failures lock the account |
| `submitter` role inside the foundation | Moved to the `form_submission` module (the foundation only knows admin/editor/viewer) | full suite |
| e2e frontend (:3100) blocked by CORS | Local default `CORS_ORIGINS` includes `http://localhost:3100` (also in `.env.example`) | smoke e2e against the real backend |
| Record page 404 in dev | Cause: stale dev caches (`.next`, `.next-e2e`) from before the route move; deleted. Production build was fine | probe + `record.cjs` 17/17 |
| Build type-checked other dev servers' generated types | `tsconfig.json` excludes `.next-e2e`, `.next/dev`, `.next-build/dev` | `next build` |
| React Compiler lint backlog | Real issues fixed: filter controls created during render in `TemplatesManager` (remounted, lost focus/open state), functions used before declaration (`layout.tsx` menus now bind/unbind listeners from state; code-UI loader), impure id generation moved to module helpers, parameter reassignment. `purity`, `immutability`, `static-components` are **errors** again; `refs`, `set-state-in-effect`, `use-memo`, `preserve-manual-memoization` stay warnings for deliberate latest-value-ref / prop-sync patterns in the form engine | lint 0 errors; canvas 0/152 changed; mobile menu e2e |

Final verification (all green): pytest SQLite 121 passed / 3 skipped (PostgreSQL-only); pytest PostgreSQL 124 passed; Vitest
15/15; Playwright 6/6 (incl. read-only smoke on every screen and the phone menu); legacy data-viewer scripts run 13, modes 28,
record 17, views 10 checks, 0 failures; `tsc`, `next build`, `api:check`, contract test, `alembic heads` = one head.

## Form Engine v2 (follow-up: "the builder, renderer and viewer are the main feature")
Goal: rebuild the core feature on the design system with a modern architecture, **without rewriting saved forms**. Finding that
made this safe: the backend reads stored forms by type name and a few generic settings (`options`, `multiple`, `showTime`,
`range`; `submission_fields.py`), and those names are not PrimeReact-specific, so the new engine reads every stored version as it
is and simply ignores PrimeReact-only props (`unstyled`, `pt`, ...). Real data checked (dev DB): 13 forms, 35 versions, only 20
field types in use.

| Phase | What | Status | Verified by |
|---|---|---|---|
| 1 | `core/`: UI-free document reader, conditions, values, Zod validation | ✅ | Vitest 8 tests; parity vs Formik/Yup runtime on every dev-DB version + request: 69 cases, 101 errors compared, **0 differences** |
| 2 | `renderer/`: TanStack Form + field kit on `@platform/ui` (18 input types, Panel/Card/Fieldset/FormSection/Divider, FormArray, DataTable); flag `forms.engine_v2`; falls back per form | ✅ | Vitest 5 tests (submit, hidden values, rows, read-only, fallback, API-list race); e2e `engine-v2.spec.ts`; all 35 stored versions supported; canvas 0/152 changed; old renderer suites unchanged with the flag off |
| 3 | Data viewer on the design system: toolbar, filter builder, saved views, table (+ column chooser), cards, board, calendar, pivot; dashboard on shadcn charts (Recharts); shared controls in `@platform/ui` (`Combobox`, `DatePicker`, `TagsInput`, `Pager`, `IconButton`, `StatusBadge`); `DataGrid`/`InlineStatus` ported | ✅ | Vitest 3 new tests (filter builder, condition text, pager) — 31/31; data-viewer scripts run 13, modes 28, views 10, record 17 all pass; Playwright 7/7; canvas 0/152 changed; parity 0 differences; build ok; phone width without overflow |
| 4 | Builder v2 (`designer/`, flag `forms.builder_v2`): document store with undo/redo (immer, coalesced typing), canvas = field kit in design mode with nested drag-and-drop, inspector generated from per-type Zod settings, keyboard shortcuts, live preview on `EngineForm`, saves `schemaVersion: 2` (same flat list) | ✅ | Vitest 9 new tests (document, store, undo/redo, keys, component flow) — 40/40; round trip on every dev-DB version: 35 versions, 337 fields, **0 differences**, every field drawable; e2e `builder-v2.spec.ts` (palette, real drag incl. into a panel, options, undo/redo keys, preview, save, filled in with the current renderer); Playwright 8/8; canvas 0/152; parity 0; pytest 121/3 skipped; build ok |
| 5 | Cut-over: the new renderer and builder are the only ones (flags `forms.engine_v2` / `forms.builder_v2` removed); the original PrimeReact/Formik/Yup renderer, builder, field editor, palette and the generated `FIELD_TYPES` deleted; data sources editor and template settings on the design system; new fields created from the kit's descriptions; backend validates `form_config` against `contracts/form-config.schema.json` (generated from the engine) + structure; no PrimeReact in `platform/form-engine/**` (lint error) | ✅ | Vitest 41/41 (contract drift test new); Playwright 9/9 (new `multi-row.spec.ts`: rows, formulas, conditional receipt, people picker, stored rows); data-viewer run 13, modes 28, views 10, record 17, demo check 14; pytest 126 passed / 3 skipped (5 new); every dev-DB version passes the contract (35/35) and round-trips (337 fields, 0 differences); check:engine (custom type end to end + every built-in type creates a valid, drawable field), check:runtime; build ok; lint 0 errors, warnings 353 → 88 |

Notes (phase 2):
- Fixed on the way: the shadcn `Field` primitive's variants had lost the `tw:` prefix (labels sat beside inputs);
  design-system popovers opened under PrimeReact dialog masks (global z-index rule while both exist); `.ds-root` screens get
  the scoped base styles (border colour, margins); `cellText`/`ROW_ACTION_EVENT` moved out of PrimeReact files so the new
  renderer does not pull PrimeReact in.
- A race found in the browser and covered by a test: an API-bound choice must not drop a saved value before its data source
  has answered (it cleared the approver on the record page and in the edit dialog). A disabled/read-only field never changes
  its own value; a read-only record never shows validation messages.
- Deliberate behaviour changes vs the original renderer (none occur in the stored data): `or`/`xor` condition lists work (they
  behaved as `and`); values of fields inside a hidden panel are not submitted and do not block the submit; a required single
  choice treats `""` as empty; `contains` on a list checks membership.
- `scripts/e2e/data-viewer/modes.cjs`: the pivot check now waits for names (they arrive with the directory) instead of a fixed
  pause; it was flaky.

Notes (phase 3):
- No PrimeReact is left in `platform/form-engine/{core,renderer,viewer}`, `platform/ui/{controls,data}`: these are now ESLint **error**
  zones for PrimeReact/Radix imports. The renderer's choice, date and tag fields use the same shared controls as the viewer.
- Virtualization (TanStack Virtual) was **not** added on purpose: every mode asks the server for a bounded page (table ≤ 100
  rows, cards ≤ 48, a board column ≤ 100 cards, a calendar month ≤ 100), so there is never a list long enough to need it.
  Revisit if a mode ever loads unbounded rows.
- Dashboard: Recharts 3.8.0 through the shadcn `chart` primitive, one series in the validated colour token `--chart-1`; every
  chart can be read as a table, whose rows also drill down (the keyboard path; bars are clicked with the mouse).
- CSS fixes found on the way: Tailwind prints the shadcn chart's `[stroke=#ccc]` utilities unquoted and Turbopack rejects them
  (moved to plain CSS in `globals.css`); the PrimeReact theme's unlayered heading sizes beat DS utilities (`_typography.scss`
  now skips `.ds-root`); plain buttons inside `.ds-root` get the same reset as primitives.
- View modes take a lucide icon component (`icon: Table`); a PrimeIcons class string still works for older registrations.
- Test hooks: titles that open a request carry `data-open`; dashboard bars `data-bar`/`data-col` + `data-value`.

Notes (phase 4):
- Stored shape unchanged: a new field is still created from its palette entry (so the original builder and renderer read it),
  with a readable key from its label (`fullName`) instead of `field-<timestamp>`; choices start with two options whose stored
  values follow their labels. Saving writes `schemaVersion: 2`; the original builder and both renderers ignore the key.
- History is a small purpose-built one (not zundo): coalescing by edit key gives "typing a label = one step", and comparing
  documents by reference gives a correct "unsaved changes" after undo — both cheap with immer's structural sharing.
- The original builder's known bugs do not exist in v2 by construction: no nested mutation (immer), no whole-canvas re-render
  (each field subscribes to its own entry), no `JSON.stringify` dirty check.
- The Data sources editor is still the original one (PrimeReact), opened in a design-system sheet and kept in step with the
  document (so its changes are undoable); porting it is part of phase 5.
- Test infrastructure: on this machine Turbopack's dev server could not start its PostCSS worker processes (Windows 0xc0000142,
  process resources) while another dev server ran; `next.config.js` now also aliases `canvas` for webpack, so the e2e server can
  run with `next dev --webpack` (`NEXT_DIST_DIR=.next-e2e-wp`). Webpack compiles each page on first visit slowly: warm the pages
  or raise the test timeout.

Notes (phase 5):
- What was removed: `FieldEditor/`, `FieldPalette/`, `FormBuilder/`, `Live-Preview/`, `FieldTypes/` (incl. the 16k-line catalogue
  generated from PrimeReact's `.d.ts`), `Template-Builder/`, the Formik runtime (`Runtime/RuntimeForm`, `validation`, `initialValues`,
  `useFieldOptions`, `cellFormat`, `readOnly`, `rowScope`, `builder/`), `Runtime/autoTable.ts` (superseded by the data viewer),
  `registerFieldRenderer` / `registerFieldType` (replaced by the kit's `defineFieldType` / `describeFieldType`), the scripts that
  tested them (`check:canvas`, `checkEngineParity`, `generateFieldTypes`, ...) and the e2e scripts that drove the old UIs
  (`equipment-request/*`, `expense-report/build|render`, `leave-request/run`). Dependencies removed: formik, yup, ts-morph,
  @dnd-kit/sortable, @dnd-kit/modifiers, react-toastify. All of it is in git history.
- Kept and moved: field key helpers → `designer/fieldKeys.ts`; width helper → `renderer/span.ts`; field actions → `renderer/actions.ts`
  (conditions through the core); stored types → `core/storedTypes.ts`; `getRuntimeConfig` → `Runtime/types.ts`.
- A form with a field type the kit does not have still opens: `FormRenderer` names the field above the form, the builder shows it as
  a placeholder that can be moved, deleted or edited as JSON; saving such a form is refused by the backend until it is replaced.
- Backend: `form_builder/services/form_config.py` (`jsonschema` 4.23); `invalid_form_config` 422 with one entry per problem
  (`form_config.fields[3].type`: "… is not a field type this version knows"). Updates without `form_config` are not checked.
  A new field type needs `npm run form:schema` (a unit test fails on drift).
- Found on the way: design-system dialogs and sheets sat under the layout's fixed top bar (z-index 50 < 997; now 1000, below
  PrimeReact's own dialogs); a read-only Files field kept its file input enabled; the fill-form e2e test left requests behind
  (they crowded the calendar check); two data-viewer checks used fixed pauses (now wait for the result).

## UI migration stages B and D (follow-up: "go ahead" after Form Engine v2)
PrimeReact, PrimeFlex, PrimeIcons and the Sass layout are gone; every screen is on the design system (`ui-migration.md`).

| Step | What | Status | Verification | Commit |
|---|---|---|---|---|
| B1 | Shared widgets: `NotifyProvider` on sonner + AlertDialog (`confirmStore`), `AuthGate`, `MonacoEditor`, `FileViewer`/PDF viewer on the DS; `FileUploader`/`RichTextEditor` removed; `RuntimeProvider` reworked, so the four React Compiler rules are **errors** again | ✅ | vitest 43/43 (notify tests); lint 0 errors | ea0dcaf |
| B2 | App shell: shadcn Sidebar (`layout/AppShell.tsx`, `AppNav.tsx`, collapsible to icons, phone sheet), top bar with theme toggle (next-themes) and user menu; menu icons are lucide names (`navIcons.ts`); Sakai layout files and partials removed | ✅ | smoke (incl. phone menu), feature-flags e2e | ab080ee |
| B3 | Template gallery / Templates Pool (`TemplatesManager`, manage + start modes), preview dialog, code editor chrome, record page, request editor; **requests across forms**: by status, My Submissions (`GET /form/submissions?mine=true`), Recent (7 days) on `RequestsList` (DataGrid) | ✅ | pytest (+ `mine` test); Playwright 9/9; record 17, check-demo 14 | f4ed420 |
| B4 | Dashboard with real data (published forms, waiting requests, my requests, approvals to decide, latest requests, forms), permission-aware | ✅ | smoke checks the stats and the recent list; phone layout without overflow | b9bd99f |
| B5 | Sign-in on DS tokens/components (same design and e2e ids), `StatusScreen` for 403 / error / 404 (`app/not-found.tsx`); Sakai `/landing` and `/pages/notfound` removed | ✅ | failed sign-in message, password toggle, 404 status checked in a browser | 3043093 |
| D | Removed `primereact`, `primeflex`, `primeicons`, `chart.js`, `quill`, `framer-motion`, `sass`; Sass layout, `public/themes` (29 MB), `public/demo`, Sakai types; Preflight on, `tw:` prefix and `.ds-root` dropped by codemod (89 files); Inter served from `public/fonts`; PrimeReact z-index overrides removed; ESLint: PrimeReact/Radix imports are errors everywhere | ✅ | tsc clean; lint 0 errors / 2 warnings (was 65); vitest 43/43; Playwright 9/9; data-viewer run 13, modes 28, views 10, record 17; check-demo 14; `next build` ok | 46975fd |

Notes:
- Found on the way: the status menu icons were PrimeIcons classes the new menu did not know (shown as circles); the shadcn sidebar
  brought two React Compiler errors (`useIsMobile` now on `useSyncExternalStore`, a stable skeleton width).
- The code editor's playground still loads PrimeReact from a CDN inside its sandboxed iframe (it previews snippets written with it).

## Open items / attention
- ✅ UI migration done (stages A–D); the four React Compiler rules are errors again.
- ✅ Unused legacy files and dependencies removed (see "Legacy clean-up" below).
- ⏳ Option 4 tooling (feature.yaml schema + `feature validate` in CI) when the organization is ready.
- ⏳ Form builder to enterprise grade: 17 gaps documented in [form-builder-gaps.md](form-builder-gaps.md), closed one at a time on request (first: server-side validation of requests).
- ✅ Form Engine v2 done (phases 1–5). The system is in development (no production data), so no migration path for forms
  built elsewhere is planned; a form whose types are missing from the kit is named by the renderer and refused on save.

## Legacy clean-up (2026-10-17)
The system is in development with no production data, so leftovers kept "for review" were removed instead of kept compatible:
- Deleted unused files: `app/context/LocalizationContext.tsx` and `app/locales` (never mounted; i18n gets a proper design when
  needed), `app/hooks/useLocalStorage.ts`, `app/store/templateStore.ts`, `app/utilis/serverInfo.ts`, `app/api/upload.ts`.
- Removed unused dependencies: `firebase`, `pino-lambda`, `ts-node`.
- The menu no longer maps PrimeIcons class names (`pi pi-...`): the registry sends lucide names only.

## Cash deposit / withdrawal: a complex form on the platform (2026-10-17)
Request: "prepare a complex form: input an account number, validate the account and fetch its details into the form, then
perform a transaction". Decisions: a simulated core banking module (swappable), cash deposit / withdrawal first, a supervisor
approves above a limit. The user asked why not dynamic forms: the form is dynamic (template JSON, built and edited in the
builder, no form-specific code); only the posting is code, and the coded Transactions list was dropped in favour of the cash
form's own data viewer.

| Part | What | Commit |
|---|---|---|
| Server actions (platform) | `form_submission/services/server_actions.py`: a form names coded work (`runtime.submit.serverAction`); permission, input model (422 per field), handler in the request's transaction, request locked; `GET /form/server-actions`; saving checks the action and its fields (`form_config.register_check`) | ca762e9 |
| Core banking (coded module) | `modules/core_banking`: `CoreBankingGateway` + `SimulatedCoreBanking` (accounts, ledger, row lock, status/currency/balance checks), lookup `GET /core-banking/accounts/{n}`, teller transactions `TXN-yyyy-nnnnnn`, action `core_banking.cash_transaction`, approval `bank_txn.post` above `CORE_BANKING_APPROVAL_LIMIT` (default 100000), roles `teller` / `teller_supervisor`, migration 0009 (RLS) | ca762e9 |
| Engine | `behavior.validation.remote` (Checking… / Verified / the lookup's error on the field, blocks submit), `status.<ds>` in scope, server 422 field errors shown on fields, `{{response.*}}` in the submit message, builder: Server action + message, "Checked by a data source"; custom range messages | 4e4d500, this step |
| The form + screens | `scripts/e2e/cash-transaction/cash-transaction.template.json` (18 fields: lookup, computed details, type, amount enabled for ACTIVE accounts, projected balance with a "more than available" rule, depositor fields for deposits, posting result), `seed.cjs`, `features/cash-transaction`, `features/core-banking`; `(coded)/core-banking/accounts` (read-only list) | this step |

Verified: pytest 139 passed / 3 skipped (new: `test_server_actions.py` 5, `test_core_banking.py` 7); Vitest 46/46 (new
`remoteCheck.test.tsx`); tsc, lint 0 errors; `form:schema --check`, `api:check`, `check:engine`; Playwright 11/11 incl.
`cash-transaction.spec.ts` (lookup, "Account not found", deposit posts and shows the reference; a 150,000 withdrawal waits,
the supervisor approves in the inbox, the balance moves and the request is completed).

Merged into `main` (f3b1c22) and pushed.

### Dev environment made ready (2026-10-17, follow-up "touch and make everything ready")
- Backend environment `knowval` (runs `uvicorn app.main:app --reload` on :8000): `jsonschema` installed (needed since Form
  Engine v2 phase 5; the backend hung at startup without it).
- Dev database (PostgreSQL `digital_file_cabinet_system`): backed up with `pg_dump -Fc` to the session scratchpad
  (`backup/digital_file_cabinet_system-before-0009.dump`; restore with `pg_restore`), then migrated 0008 → 0009.
- Cash demo seeded (`seed.cjs`): six accounts — `1000000000001` and `…006` active with large balances, `…002` low balance,
  `…003` USD, `…004` dormant, `…005` blocked; users `teller@acme-corp.org` (role teller) and `supervisor@acme-corp.org`
  (role teller_supervisor) with the demo password; the form "Cash deposit / withdrawal" published.
- Checked on the real app (:3000 → :8000): Playwright `cash-transaction.spec.ts` 2/2. It left two transactions as demo history:
  a 1,500 deposit to `…001` and a 150,000 withdrawal from `…006` (approved by the supervisor).
- Try it: sign in as `teller@acme-corp.org` → Templates Pool → "Cash deposit / withdrawal" → account `1000000000001`; above
  100,000 (`CORE_BANKING_APPROVAL_LIMIT`) `supervisor@acme-corp.org` decides under Approvals; posted transactions appear in the
  form's requests (data viewer).

## Form builder gap register (2026-10-17, follow-up "anything left to make an enterprise-grade form builder?")
An audit of the builder, renderer, data viewer and request backend found 17 gaps. They are documented one by one, each with the
problem, why it matters, what exists today (file references), the proposed solution, size and status, in
[form-builder-gaps.md](form-builder-gaps.md). Only documentation for now (the user's decision); gaps are implemented one at a
time when asked, in the listed order: trust and correctness first (server-side validation, server-controlled status, per-form
access, drafts), then workflow and notifications, then breadth.
