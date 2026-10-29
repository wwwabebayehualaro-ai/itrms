# Phase 0: Core and demo

## Goal
Build the platform every service runs on, and prove it with a **driver-licence demo in Wolaita Zone (Boditi town unit and the zone department handle licences;
Damot Gale woreda proves isolation), in Amharic, English and Wolaytta** ([demo-plan.md](../demo-plan.md)) that the
bureau approves.

**Gate: the demo is validated by officials of at least two bureaus or zones** (feedback recorded in `docs/discovery/`,
with what to change for Phase 1). ITRMS is self-built and not commissioned ([go-to-market.md](../go-to-market.md)).

## Scope
In:
- Monorepo restructure (KEEP/PORT from [`../audit.md`](../audit.md)).
- Platform: org tree and tenancy, Keycloak, RLS with isolation tests, audit, numbering, idempotency, outbox and jobs,
  files, Ethiopian calendar, i18n.
- People and organisations register.
- Forms platform ported to NestJS, with server-side validation.
- Workflow engine, service configuration, fees and receipts, document templates with PDF and QR.
- The driver-licence slice (new licence + renewal) with a **fake** national driver-platform adapter.
- A demo installation with generated seed data for Wolaita Zone (16 woredas and every known town; [tenant-wolaita.md](../tenant-wolaita.md)).

Out (later phases): vehicles and plates, the other 52 services, real SMS and payment providers, paper-record migration,
production hardening for a pilot (INSA evaluation), HR and payroll.

**Demo framing** (from [`../ethiopia-context.md`](../ethiopia-context.md) §3): the Ministry of Transport and Logistics is
centralising driver licensing. The demo therefore shows ITRMS as the zone's **workflow, configuration, fees, documents and
reports** layer, connected to the national platform through an adapter. It is not a competing licence register.

## How tasks are written
Each task fits one Claude Code session and ends green on CI. "Done when" are the acceptance checks, and "Tests" are the tests
the task must add. The [definition of done](../../CLAUDE.md#definition-of-done) applies to every task.

## Tasks (in order)

### 0.1 Baseline commit and repo hygiene
- **Do:**
  - Add `.gitignore` rules for every `.env*` except `*.example`, `.next*`, `test-results`, `__pycache__` and `uploads`.
  - Move `Frontend/.env` and `.env.production` values into `.env.example` files with placeholders, and rotate
    `AUTH_SECRET`.
  - Move the demo password out of `docs/legacy/test.md`.
  - Commit the copied project as it is (`chore: import Digital File Cabinet baseline`) on a branch, then tag `legacy-dfc`.
  - Add the ownership notices: `LICENSE` (proprietary: "Copyright © 2026 ABANEXUS SOFTWARE DEVELOPMENT PLC. All rights
    reserved."), a `NOTICE` file for third-party licences, and the product/vendor line in the root `README.md`. Git author: the
    current identity (the product owner is the company's General Manager).
- **Done when:** `git status` is clean, no secret is in any tracked file (gitleaks scan), and the tag exists.
- **Tests:** a gitleaks run in a pre-commit hook and in CI (added in 0.2).

### 0.2 Monorepo skeleton, CI, security scans
- **Do:**
  - Set up pnpm workspaces + Turborepo:
    - the layout of [code-structure.md](../platform/code-structure.md) (ADR-0032): `apps/{web,api,verify}`,
      `platform/*`, `modules/*`, `packages/{schemas,form-engine,ui,ethiopian-calendar,module-sdk,api-client,testing,config}`
      (empty skeletons with their `exports`);
    - `modules/_template` (manifest, contracts, api, web, messages, seed, test) and the `turbo gen` generators (`module`,
      `feature`, `screen`, `effect`); a CI check that every slice's `package.json` has the same `exports` and scripts;
    - shared tsconfig, ESLint 10 and Prettier, lefthook (Prettier, ESLint, gitleaks on staged files), `.gitattributes`
      (`* text=auto eol=lf`), `.nvmrc` and `packageManager`, CODEOWNERS.
  - dependency-cruiser rules for the layers ([code-structure.md](../platform/code-structure.md) §3): `packages` →
    `platform` in its fixed order (kernel → integrations → forms → fees → documents → workflow → services → reports) →
    registries → work-process modules, with no sideways imports between work-process modules; isomorphic `contracts`;
    `web` never imports `api`; `@itrms/kernel/db/system` only from worker code; `apps/verify` limited to its allow-list.
  - Add the GitHub Actions PR workflow: lint, typecheck, test, build, dependency-cruiser boundaries, gitleaks, Trivy,
    Semgrep, and a licence report artefact (not a gate, ADR-0025). Renovate config.
  - Pin the toolchain from [tech-stack.md](../tech-stack.md) (Node 24 LTS, pnpm 12, TypeScript 6.0, ESLint 10, Vitest 5; updated in task 0.2 to the current releases at least two weeks old).
- **Done when:** `pnpm i && pnpm turbo run lint typecheck test build` passes on an empty skeleton, and CI is green on a PR.
  A deliberate boundary violation fails dependency-cruiser: `packages/schemas` importing `packages/ui`, or one
  work-process module importing another.
- **Tests:** the dependency-cruiser rules have a failing fixture.

### 0.3 Dev stack (Docker Compose)
- **Do:**
  - Write `infra/compose/docker-compose.yml`: postgres 16 (with ltree), valkey 8, keycloak 26 (+ its database),
    **SeaweedFS** ≥ 4.30 (ADR-0020), mailpit for dev email.
  - Add an optional `observability` profile: Alloy, Prometheus, Loki, Tempo, Grafana, GlitchTip (ADR-0023).
  - Write `pnpm dev:infra` scripts and seed users.
  - Write the S3 contract test suite (presigned PUT/GET, size limits, multipart, delete, list) against SeaweedFS.
- **Done when:** `pnpm dev:infra` brings everything up healthy on Windows (WSL2) and Linux, and the S3 contract suite
  passes.
- **Tests:** the S3 contract test suite (also the gate for SeaweedFS upgrades).

### 0.4 Move the web app and the design system
- **Do:**
  - Move `Frontend` to `apps/web` and `platform/ui` to `packages/ui`.
  - Replace `@react-pdf-viewer/*` (paid licence, stale) with **react-pdf** in `packages/ui` (`PdfViewer`); keep `next/image`.
  - Replace axios with **openapi-fetch** behind the existing client interface (tech-stack T10).
  - Remove the bank-specific routes and the code-UI playground (audit §10).
  - Keep the existing unit tests passing.
- **Done when:** `apps/web` builds; `packages/ui` has its own tests; there are no imports of the removed packages.
- **Tests:** the moved Vitest suites (formKit, notify, client and others) pass from their new places.
- **Split (2026-10-19):** the design tokens and themes moved to 0.4b, because the move alone fills a session (267 files,
  about 23,000 lines).

### 0.4b Design tokens, themes and Ethiopic typography
- **Do:**
  - Design tokens in three tiers and themes (ADR-0029, [design-system.md](../platform/design-system.md)):
    - light, dark and **high contrast** themes; **comfortable/compact** density;
    - **Noto Sans Ethiopic + Noto Sans + Noto Sans Mono** replace Inter, self-hosted;
    - the Ethiopic typography rules;
    - the 7-tone status vocabulary in `StatusBadge`;
    - a contrast test over every theme.
- **Done when:** every component reads only semantic tokens; the three themes and both densities switch at runtime; the
  fonts load from the app itself, never from a CDN; `StatusBadge` shows the 7 tones with text and icon, not colour alone.
- **Tests:** the token contrast test passes in all three themes (WCAG AA for text, 3:1 for UI parts); Ethiopic line-height
  and label-wrap checks; the moved suites still pass.

### 0.4a Design-system documentation and visual tests
- **Do:**
  - Storybook in `packages/ui`: every component, with toolbar switches for am / en / wal-Latn, light/dark/high contrast and
    comfortable/compact, plus the a11y addon.
  - Playwright visual regression over the stories in **am and en, light theme, comfortable density** (a fixed font set in
    CI); the other combinations are checked by axe and contrast tests, not screenshots.
  - Browser checks of the Ethiopic rules from 0.4b: labels wrap to two lines, line boxes, the 14 px floor.
- **Done when:**
  - Storybook builds in CI with no axe violations, in every theme and density;
  - the visual baselines are committed.
- **Tests:** axe on every story in every theme and density; visual snapshots; the Ethiopic layout checks in a browser.
- **Split (2026-10-19):** the page templates, the new controls and the `DataGrid` extensions moved to 0.4c. Storybook
  with stories for about 45 components, axe and Linux visual baselines fill a session on their own.

### 0.4c Page templates, money and person controls, DataGrid extensions
- **Do:**
  - Page-template components: `PageHeader`, `FilterBar`, `EmptyState`, `DescriptionList`, `KpiTile`, `WidgetCard`, plus
    the list, record, form, dashboard, settings and print layouts. The case template comes in 0.20.
  - New controls: `MoneyInput`/`MoneyText` (bigint santim), `PersonName`, `UnitBadge`.
  - Extend `DataGrid` with column pinning and resizing, keyboard row navigation and bulk selection.
  - Stories, axe checks and visual baselines for all of them (the 0.4a setup).
- **Done when:**
  - a list page and a record page are built only from templates;
  - the new components have stories with no axe violations and committed baselines.
- **Tests:** `MoneyInput` never produces floats (property test); keyboard row navigation and bulk selection in a
  browser; axe and visual snapshots of the new stories.

### 0.5 Extract the form engine and shared schemas
- **Do:**
  - Move `platform/form-engine` to `packages/form-engine` with entry points `core` (UI-free), `renderer`, `designer`,
    `viewer` (ADR-0032).
  - Replace the hard import of the app's HTTP client with an injected `FormsClient`.
  - Move the stored-form Zod schema and the shared DTO types to `packages/schemas`.
  - Move `check:engine`, `check:runtime` and the designer round-trip check along with it.
- **Done when:** `packages/form-engine/core` has no React or DOM imports (lint rule); every engine check passes; and the web app
  renders, builds and fills a form exactly as before (engine e2e specs against the legacy backend, for the last time).
- **Tests:** existing engine unit tests; a new test that `core` imports cleanly in a Node environment without a DOM.

### 0.6 API skeleton
- **Do:** `platform/kernel` (the first kernel subsystems) and `apps/api` as the composition root with NestJS + Fastify
  (code-structure.md §5):
  - typed config (Zod), **one variant per process**, that fails at startup; `main` refuses system-pool credentials;
  - the API bundled with Nest's webpack builder + `swc-loader` (workspace packages bundled in), and `unplugin-swc` in
    the Vitest preset;
  - the `AppError` hierarchy + problem+json filter;
  - the request context (AsyncLocalStorage: request id, user, unit);
  - pino JSON logs with secret masking, `/healthz`, `/readyz`, `/metrics`;
  - the Zod validation pipe;
  - `worker.ts` and `migrate.ts` entry points (`worker-documents.ts` comes in 0.23).
- **Done when:** the API starts in both modes; an unknown route answers 404 problem+json; a request body that fails its
  Zod schema answers 422 with `errors[]`.
- **Tests:** error-filter tests (validation → 422 with `errors[]`, unknown error → 500 without internals), a config
  failure test, a health test.
- **Split (2026-10-21):** the module manifest loader and the OpenAPI pipeline moved to 0.6a: the process skeleton alone
  fills a session.

### 0.6a Module manifest loader and OpenAPI pipeline
- **Do:**
  - the **module manifest loader** (`defineModule`, ADR-0027). It registers enabled modules' NestJS modules and validates
    every manifest at startup: dependencies present, unique permission and role keys, effects exist, events have schemas.
    A broken manifest stops the start, with a clear message;
  - OpenAPI generated from the Zod schemas.
- **Done when:** a broken manifest stops the start with a message naming the module and the problem; OpenAPI is written to
  `packages/api-client/openapi.json` and the web types are generated from it (drift check in CI).
- **Tests:** manifest validation (each rule has a failing case); the OpenAPI drift check.

### 0.7 Database foundation and audit log
- **Do:**
  - Drizzle setup, migrations folder, roles (`itrms_owner`, `itrms_app`, `itrms_system`, `itrms_backup`; see 0.9 and ADR-0031).
  - `db.scoped(ctx, fn)` (transaction + `set_config` locals).
  - Base columns (ids UUIDv7, created/updated by/at, `row_version`), with optimistic locking → 409.
  - The `audit_log` table with an append-only trigger; repository write helpers that write the audit row **in the same
    transaction**; `recordEvent()` for non-row events.
- **Done when:** a sample table's insert, update and delete each produce exactly one audit row in the same transaction, and
  a rollback leaves neither row nor audit. UPDATE/DELETE on `audit_log` fails. A stale `row_version` returns 409.
- **Tests:** integration tests on a real Postgres (Testcontainers); a test that every table is audited unless allowlisted.

### 0.8 Org tree
- **Do:**
  - Tables `org_level_definitions`, `org_units` (ltree path maintained by triggers, `category`), and `org_departments`.
  - **Unit types** (ADR-0026, [org-and-unit-types.md](../platform/org-and-unit-types.md)):
    - `unit_types` with default services, teams, role catalogue and capabilities;
    - `unit_service_overrides`;
    - an effective-services resolver;
    - Wolaita's types seeded (`zone_department`, `town_unit_f1`, `woreda_office_m1`, `town_unit_f3/f4` provisional).
  - Org import from CSV/Excel (name am/en/local language, kind, category, parent, code, unit type).
  - Admin API: create, rename, move (audited), deactivate.
  - Seed (data file `apps/api/seed/org/south-ethiopia.wolaita.yaml`): South Ethiopia Region → Wolaita Zone → its 16 woredas
    and every known town administration (8 so far), as siblings under the zone ([tenant-wolaita.md](../tenant-wolaita.md) §2). Categories and
    grades where known (Damot Gale ምድብ 1; Boditi ፈርጅ 1, Gesuba ፈርጅ 3, Bitena ፈርጅ 4); the zone can add towns. Names in `am`/`en`/`wal-Latn`, with
    missing ones marked for the zone to confirm.
  - Test-only fixtures: a synthetic "Test Zone B" (for the isolation matrix) and a region **without zones** (to prove
    configurable depth).
- **Done when:**
  - a subtree query uses the GiST index (EXPLAIN in the test log);
  - moving a unit updates its descendants' paths;
  - level names come from the region's definitions;
  - Boditi's effective services include DVC-03 and Damot Gale's don't, and a unit override changes that for one unit
    only;
  - importing a second, synthetic zone from a file creates its units and types with no code change.
- **Tests:** tree operations; path triggers; depth variants (3 levels, 2 levels, a city with sub-cities).

### 0.9 Row-level security and the isolation test matrix
- **Do:**
  - `rlsPolicies(table, 'registry' | 'transaction' | 'config' | 'party')` migration helper (policies `TO itrms_app`,
    null-safe settings `nullif(current_setting(…, true), '')`, region check in every class, class-R writes limited to
    records the unit handles), and policies on every tenant table built so far (ADR-0031).
  - DB roles `itrms_owner`, `itrms_app`, `itrms_system` (BYPASSRLS, worker pool only), `itrms_backup`. **No bypass
    setting.**
  - The `org_path` denormalisation trigger for transaction tables.
  - `systemContext()`: a separate pool as `itrms_system`, exported only from `@itrms/kernel/db/system` and importable
    only by worker code (dependency-cruiser). Every use is logged.
  - A test harness that runs a function as a user of a given unit.
- **Done when:**
  - the matrix passes for every table class: own unit, child, parent, sibling, other zone, other region, and no context;
  - the **no-context case also passes on a pooled connection that has just served a scoped transaction** (sees nothing);
  - `set_config('app.bypass_rls', …)` or any other setting from `itrms_app` grants nothing;
  - EXPLAIN shows the GiST index on `org_path` under RLS;
  - the matrix runs in CI against Postgres 16.
- **Tests:** generated per-table isolation tests (adding a tenant table without policies fails the suite).

### 0.10 Identity and permissions in the API
Split on 2026-10-21 (scope too large for one session): the BFF sign-in moved to 0.10a, the application shell to 0.10b.
- **Do:**
  - Realm export in `infra/compose/keycloak` (TOTP required, password policy, brute-force detection, the `itrms-web`
    client with PKCE and an `itrms-api` audience), imported by the dev stack.
  - API: an `Authenticator` that verifies Keycloak access tokens (JWKS via `jose`: issuer, audience, expiry) and takes
    the active unit from `X-Org-Unit`; `@Require(res:action)`, `@Public`, `@SignedIn`.
  - **`users`** and **`role_assignments`** (user × unit × role, valid from/to, granted by, reason) as the only source of
    authorization (ADR-0031); the caller and their roles in the active unit are resolved by one reviewed SECURITY DEFINER
    function, on every request, so a revoked assignment takes effect on the next request.
  - Permission and role registry from the module manifests, with the kernel's roles of
    [roles-and-permissions.md](../roles-and-permissions.md) (`bureau_admin`, `unit_admin`, `unit_head`,
    `records_officer`, `cashier`, `finance_officer`, `auditor`, `viewer`); granting checks the unit type's role catalogue.
  - Denials (guards and row-level security) are audited.
  - `GET /api/v1/me/workspace`: the user, the active unit (services, capabilities), the units they can act for, their roles
    and permissions there.
- **Done when:**
  - a route without `@Require` fails the startup test;
  - a user who is cashier at Boditi and records officer at the zone gets exactly those permissions in each unit;
  - revoking an assignment takes effect on the next request;
  - acting for a unit the user holds no role in is refused, and a unit outside the active scope answers 404;
  - every denial is in the audit log.
- **Tests:** guard unit tests; the authenticator against a local JWKS (expired, wrong issuer, wrong audience, unknown unit);
  the cross-unit 403/404 test.

### 0.10a BFF sign-in and exposure
- **Do:**
  - Next.js BFF with **openid-client**: OIDC code flow + PKCE, an opaque `__Host-` session cookie, sessions encrypted in
    Valkey (ADR-0021), `/api/*` proxy with a bearer token and `X-Org-Unit`, sign-out and back-channel logout.
  - Passkeys/WebAuthn offered next to the required TOTP; the Amharic/English Keycloak theme with Noto Sans Ethiopic.
  - Exposure: the `app.` and `verify.` hostnames; the Keycloak admin interface internal only; `/auth/admin` and
    `/auth/realms/master` blocked; a nonce-based CSP, HSTS and `frame-ancestors 'none'`.
  - Org-unit → Keycloak group sync behind the `IdentityAdmin` interface (through the outbox from 0.11); demo users created
    in Keycloak with their assignments.
- **Done when:** a user signs in with 2FA and acts in their unit only; tokens never reach browser JavaScript (checked in
  e2e); sign-out ends the Keycloak session.
- **Tests:** an e2e sign-in with TOTP; the session store; the proxy adds the bearer token and never forwards cookies.
- **Done (2026-10-21):** `apps/web/src/bff` + route handlers under `app/auth` and `app/api`, `proxy.ts` (CSP and
  headers); the realm's flow is password + TOTP (required) + a registered passkey. A passkey *instead of* TOTP needs
  Keycloak to set up an alternative it has not got yet, which it does not do: a follow-up. Sign-out ends the Keycloak
  session server to server (an end-session redirect would carry the ID token in its URL). Step-up (`recentAuth`) on role
  grants. Group sync runs from `seed identity` until the outbox (0.11). Nginx exposure rules in `infra/compose/nginx`
  (mounted by the production profile, 0.26). The legacy engine e2e journeys are parked in `tests/e2e/legacy`.

### 0.10b Application shell
- **Do** (ADR-0028, [navigation-and-menus.md](../platform/navigation-and-menus.md)):
  - `/me/workspace` adds the effective menu and settings, filtered by entitlement, enablement, the unit's services,
    permissions and capabilities;
  - the sidebar grouped by work process, a **unit switcher**, the **command palette** (menu + actions; record search comes
    in 0.14), favourites and recents, and the user menu with preferences (theme, density, language, calendar);
  - icons collected from the manifests at build time.
- **Done when:** a Damot Gale user's menu shows no licensing items and a Boditi competency officer's does; switching units
  changes the menu and the data scope.
- **Tests:** menu filtering per unit and role; e2e unit switching.
- **Done (2026-10-22):**
  - Typed `menu` in the module SDK; `effectiveMenu` in the kernel; `menu` and `settings` in `/me/workspace`.
  - `modules/competency` scaffolded with its permissions, roles and menu only; the licence slice follows in 0.24.
  - The shell in `apps/web/src/shell` and the generated icon map.
  - Favourites, recents and preferences are kept in the browser until 0.13.
  - Entitlement filtering waits for the licence keys (Phase 1); enablement is the loader's `MODULES_DISABLED`.
  - Badges, the notifications bell and role workspaces come with the inbox (0.20).

### 0.11 Numbering, idempotency, outbox, jobs
- **Do:**
  - `number_counters` + `nextNumber(tx, key, unit)` with patterns `{unit}/{seq:06}/{efy}` (EFY from 0.12; a stub until then),
    `start_after` seeding, used only for documents ITRMS issues. Case numbers use a plain sequence (ADR-0031).
  - The `Idempotency-Key` interceptor: (user, method, route, key, request hash), unique, written in the business
    transaction, kept 7 days; 409 on a concurrent duplicate, 422 on a hash mismatch.
  - `outbox_events` (pending → enqueued → done) + relay (`SKIP LOCKED`, jobId = event id) + a sweep for stuck `enqueued`.
  - BullMQ queues, retry/backoff, dead-letter list, admin view.
  - Valkey: AOF, `noeviction`, separate instances for queues and sessions.
- **Done when:** 50 parallel issuers get 50 consecutive numbers with no gaps; a rolled-back transaction leaves no gap; a
  replayed POST returns the first response; a crashed relay replays without duplicates; a handler that dies after the
  enqueue is retried by the sweep; flushing Valkey loses no event.
- **Tests:** concurrency tests on Postgres; idempotency tests; outbox relay tests with a fake queue and a real Valkey.
- **Done (2026-10-22):**
  - `@itrms/kernel/numbering` and `@itrms/kernel/outbox`, the `IdempotencyInterceptor`, and the relay, sweeps and
    BullMQ consumer in `@itrms/kernel/api/worker` (`pnpm --filter @itrms/api dev:worker`). The dead-letter list is at
    `GET /api/v1/admin/jobs` and `POST …/:id/retries` (`job:read` and `job:retry`); its screen comes with the admin
    screens.
  - The kernel emits `org-unit.changed.v1` and `role-assignment.changed.v1`; the worker mirrors them into Keycloak
    (group sync through the outbox, 0.10a's follow-up).
  - Recurring system work is audited once per process and reason, then logged.
  - The EFY in numbers is a stand-in until the calendar package (0.12).

### 0.12 Ethiopian calendar package
- **Do:** `packages/ethiopian-calendar`:
  - Gregorian ↔ Ethiopian conversion via JDN;
  - leap years, Pagume;
  - month and day names in am/en/wal-Latn (Wolaytta names from the translator; transliteration until then), plus om/ti;
  - formatting patterns, optional Ethiopic numerals;
  - fiscal year (Hamle 1 – Sene 30), `efy(date)`, quarter;
  - optional Ethiopian 12-hour clock;
  - `Africa/Addis_Ababa` business-date helpers.
- **Done when:** the conversion is correct against a reference table of known dates (Meskerem 1 for 1990–2030 EC; Gena,
  Timket and the like); a property test round-trips every day from 1900 to 2100 Gregorian; there are no runtime
  dependencies.
- **Tests:** a reference-table test, property tests (fast-check, MIT), formatting snapshots per language.
- **Done (2026-10-22):**
  - `packages/ethiopian-calendar` (see its README). Every day from 1900 to 2100 is checked against ICU's Ethiopic
    calendar as an oracle in the tests, so the package itself keeps no runtime dependency.
  - The Wolaytta month and weekday names are transliterations marked `PROVISIONAL` until the translator's names arrive.
  - Number counters with `{efy}` now restart at 1 each fiscal year (0.11's follow-up): a `period` on the counter, which
    only moves forward.

### 0.13 i18n platform
- **Do:**
  - `next-intl` in `apps/web` with `am` (default), `en` and **`wal-Latn`** (Wolaytta, Latin script; our own catalogue, no
    reliance on ICU data), fallback `wal-Latn → am → en` ([i18n-and-languages.md](../i18n-and-languages.md)).
  - The `I18nText` type and helpers in `packages/schemas`.
  - Search folding for Wolaytta apostrophes (`'` `’` `ʼ` `7`) and Ethiopic homophones (used by 0.14).
  - **`EthiopicInput`**: phonetic Latin → Ethiopic typing built into the base `Input`/`Textarea` (a key toggles it), so staff
    can type Amharic on PCs without an Amharic keyboard layout.
  - Tenant language settings (API + admin screen), with an API error `title` resolved per language.
  - Slice-owned catalogues (`<slice>/messages/*.json`) merged at build with the shell's; the CI check walks every
    catalogue (`am` and `en` required, optional languages reported).
  - Locale-aware `format.ts` (numbers, money in Birr, dates via the Ethiopian calendar with a Gregorian toggle).
  - Fonts: Noto Sans Ethiopic + Noto Sans, self-hosted.
- **Done when:** the app shell, sign-in theme and errors show in Amharic and English, and Wolaytta loads with fallback; a
  missing `am`/`en` key fails CI (missing `wal-Latn` keys are reported, not failed); dates show Ethiopian by default.
- **Tests:** a catalogue completeness test; format tests (money from santim, Ethiopian dates); an e2e language switch.
- **Done (2026-10-22):** see [i18n-and-languages.md](../i18n-and-languages.md) §7. Preferences (language, calendar,
  favourites, recents) moved to the server (0.10b's follow-up). Region settings are a first, region-level
  `settings_values`; the inheritance down the tree is task 0.21. The forms keep the Gregorian `DatePicker` until the
  form engine adopts the Ethiopian one (0.17b).

### 0.14 People and organisations register
- **Do:**
  - `persons` (class R): names in Ethiopic and Latin script (given, father, grandfather), sex, birth year, address down to
    kebele.
  - `person_sensitive`: full birth date (entered in EC), phone, optional Fayda FIN, photo. Field-encrypted, with HMAC blind
    indexes on FIN and phone, read through the audited `reveal()` (needs `pii:reveal` and a reason).
  - `organisations`: kinds, TIN, licence number, address; members.
  - Search through a scoped `SECURITY DEFINER` search function: trigram on folded names in both scripts, blind-index exact
    match on FIN and phone. Duplicate detection (same FIN, or the same name + birth date + phone).
  - Regional registry class with RLS; screens: search, view, create, edit, merge (with approval).
- **Done when:** a person created in Damot Gale is findable from Boditi and from Test Zone B (same region), and is not visible in another region;
  duplicates are warned about before saving; every change is audited, with personal fields HMAC-masked in the diff;
  a `viewer` never sees FIN or phone, even in exports; name search over 10⁶ generated persons returns in < 300 ms, with
  EXPLAIN under RLS showing index use.
- **Tests:** API integration (create, search in both scripts, duplicate warning), RLS class R, e2e create + search in
  Amharic.
- **Done (2026-10-22):** `modules/parties` (the first registry slice) and `@itrms/kernel/crypto`. Search is
  `parties.search_persons` (names folded by `foldForSearch`, each word a trigram-indexed substring, the first 1000 matches
  ranked) and blind-index lookups by FIN or phone (a POST: never in a URL). A merge is asked by one person and approved by
  another (`person:approve-merge`, unit heads), then `person.merged.v1` is emitted. Measured: 10⁶ generated persons, every
  search's median 11–27 ms (`pnpm --filter @itrms/api test:perf`). The screens live in `apps/web/src/screens/registry`
  until the kernel's web runtime lets slices hold their own (follow-up). The photo waits for files (0.15).

### 0.15 Files on object storage
- **Do:**
  - A `files` table. Uploads use a **presigned POST** with `content-length-range` and content-type conditions; multipart
    is bounded (part URLs only up to the declared size, a part cap, per-user quota). Objects go to a `quarantine/` prefix,
    and a lifecycle rule removes incomplete or unconfirmed uploads.
  - Confirm on upload (size, sha256, magic bytes), then link to a record.
  - Presigned download after an authorization check; document type tags.
  - The `FileUpload` field of the engine uses it through `FormsClient`.
- **Done when:**
  - a file uploaded in one unit cannot be downloaded by a user of a sibling unit;
  - a mismatched type is refused;
  - an upload larger than declared is rejected by S3 itself;
  - bucket listing through Nginx is denied;
  - orphaned uploads are purged after 24 h.
- **Tests:** API integration with the S3 container; authorization tests; the purge job test.
- **Done (2026-10-24):** `@itrms/kernel/files` (the `ObjectStore` port, `kernel.files` class T, begin, confirm, link,
  download) and `S3ObjectStore` in `@itrms/integrations`. Browsers reach the store on the app's own origin under
  `/files`: the API signs for the store's address and Nginx (a Next route with Nginx's rules in development) forwards
  with the store's Host, so there is no CORS and no other origin in the CSP. Up to 16 MiB in one POST policy of exactly
  the declared size and type; above, parts of 8 MiB with the length signed; at most 50 MiB, 20 files or 200 MiB waiting
  and 1 GiB a day per person. A confirmation claims the upload (`checking`) and checks a copy taken out of quarantine.
  The worker purges every hour, expiring the row before removing the object, so a file linked meanwhile keeps it; the
  bucket also has a lifecycle rule. Nginx's /files rules are proven on a real Nginx in front of SeaweedFS
  (`files-nginx.int.spec.ts`).

The forms port (`form_builder` and `form_submission` to `platform/forms`) is split in three (2026-10-24, product owner):
the API, the queries over submissions, then the web switch-over. Cases (0.19) and services (0.21) do not exist yet, so
`submissions.case_id` is nullable with no foreign key until 0.19 adds it, and the queries filter by **form** until 0.21
adds the service filter (the 10⁶ check is repeated there). The reference server (8 vCPU / 48 GB, [NFRs](../engineering/nfr.md))
is not available: the timing runs in CI on 10⁶ generated rows, as 0.14 did, and on the reference server in 0.26.

### 0.16a Forms API: definitions, versions, submissions, server-side validation
- **Do:** in `platform/forms`:
  - `form_definitions` and `form_versions`: content-hashed, immutable versions; publish (+ approval);
  - `submissions` pinned to a version (`case_id` nullable, no foreign key until 0.19);
  - **server-side validation with `packages/form-engine/core`** (prune hidden values, 422 `errors[{field,message}]` with row
    paths);
  - RLS of each table's class, audit on every write, `@Require` on every route, the OpenAPI contract.
- **Done when:** a submission violating a rule via direct API call gets a 422; a published version cannot change; a
  submission keeps the version it was made on after a new one is published; the isolation matrix covers the new tables.
- **Tests:** the shared validation case file (`packages/form-engine/test/cases.json`) run by the API tests; publish and
  approval tests ported from `test_form_publish.py` and `test_form_config.py`; isolation and audit tests.
- **Done (2026-10-24):** `@itrms/forms` (`forms.form_definitions`, `form_versions`, `form_publications`, `submissions`;
  migrations 0024–0025). Versions are immutable by grants and a trigger (only a unit move rewrites `org_path`).
  Publishing is always maker-checker: neither the requester nor the content's last author approves; the requester may
  withdraw. A submission names the published version it was filled on; the server keeps only the form's own values,
  settles what nobody types (disabled fields at their default, read-only computed fields recomputed), prunes hidden
  values, then runs `@itrms/form-engine/core` (choices within their options). The 25 shared cases run in the engine and
  over HTTP. Answers enter the audit log as an HMAC. What the server cannot check yet (data sources, lookups, file
  references, other computed fields) is in the follow-ups for 0.17a–c, 0.18 and 0.18a.

### 0.16b Submission queries and filterable indexes
Split on 2026-10-24 (product owner): saved views, exports and history moved to 0.16d. Indexes follow ADR-0035.
- **Do:** in `platform/forms`:
  - the JSONB query compiler port (filters, search, sort, group, aggregate; allow-listed keys only);
  - `forms.submission_values` (ADR-0035), written with each submission from its version's filterable fields; the
    worker fills existing submissions when a version makes a field filterable (`form.published.v1`);
  - the view schema (what the data viewer can do with a form's submissions); each query has a `statement_timeout`.
- **Done when:** a query over 10⁶ generated submissions (filtered by form and an indexed filterable field) answers in
  under 300 ms in CI, with EXPLAIN under RLS attached; a field made filterable by a new version is filled for existing
  submissions; each query has a `statement_timeout`; a key that is not allow-listed is refused (400).
- **Tests:** query-compiler tests ported from `test_submission_query.py`; the 10⁶ timing and EXPLAIN test; isolation of
  the value table.
- **Done (2026-10-24):** `platform/forms` `view-fields.ts` (the allow-list: the published version's top-level value fields
  the caller may see in every version that has them, and `createdAt`, `submittedBy`, `handlingUnit`), `query-compiler.ts`
  (every key and value bound) and `forms.submission_values` (ADR-0035), filled by the worker on `form.published.v1`
  under a per-form advisory lock. Under RLS only leakproof comparisons reach an index: numbers are `double precision`,
  and the answers have no GIN index. One 10 s deadline per request. On CI, 10⁶ submissions: indexed filters 7–26 ms
  for the zone and a woreda, EXPLAIN under RLS in the performance job's log.

### 0.16d Saved views, history and direct exports
Split on 2026-10-24 (product owner): exports over the size limit, through the worker, moved to 0.16e.
- **Do:** in `platform/forms`: saved views (filters, search, sort, the DataGrid's column choice and the view mode; private
  to their owner, or shared in the unit by someone allowed to; one default per form and unit); a submission's history
  (who did what and when, from the audit log; the answers' values never, as the log holds them only masked); CSV and
  Excel (ExcelJS, T14) export of a query up to a size limit, as the viewer shows it (labels, names), audited, every cell
  neutralised (SEC-IN-8); a query over the limit is refused with the advice to use the background export (0.16e).
- **Done when:** a saved view reopens with its filters, sort and columns; a private view is invisible to everyone else;
  an export is audited with its size; a CSV cell starting with `=` is neutralised, in the Excel file too.
- **Tests:** saved-view tests ported from `test_saved_views.py`; export tests ported from `test_submission_query.py`
  (CSV, Excel, neutralisation, labels, audit, permission); history tests.
- **Done (2026-10-24):** `forms.saved_views` (private to the owner, shared with `submission-view:share`, one default per
  form and office), `GET /submissions/{id}/history` (audit rows, answers only as "answers"), `POST /submissions/export`
  (`submission:export`; CSV every cell quoted and neutralised, Excel string cells with the text format on formula-like
  ones; at most 5000 rows, two renders at once per process; a sensitive audit event with its size and field keys).

### 0.16e Background exports and server-generated files
- **Do:** in `@itrms/kernel/files`: files the server generates (an object-store put, the CSV and XLSX types, a
  retention); in `platform/forms`: an export over the direct limit as a worker job (status resource, the file kept for
  a limited time, a download link that expires, audited when it is made and when it is downloaded).
- **Done when:** an export over the size limit runs in the worker, is audited, and is downloaded only by who asked for
  it; an expired export is purged.
- **Tests:** the job, the file's lifecycle, the S3 contract suite for the new put.
- **Done (2026-10-25):** `@itrms/kernel/files` generated files (origin `generated`: put outside any transaction, recorded
  in the caller's, at most 50 MB, their owner's alone, purged once kept long enough); `forms.submission_exports` with
  `POST /submission-exports` (two pending per person), a worker that re-reads the requester's rights and runs the export
  under RLS as them (100 000 rows, 120 s), every failure ended with a reason code, the requester alone following and
  downloading it.

### 0.16c Web switch-over to the forms API
Split on 2026-10-25 (the e2e journeys in CI moved to 0.16f). Needs 0.16b, 0.16d and 0.16e.
- **Do:** point the web's builder, gallery, data viewer, record page and approvals at the forms API through the BFF: the
  engine's API hooks map the forms API's DTOs to the shapes its screens use (one place for the wire); publish asks for a
  publication and the approvals screen decides it; the designer offers the `filterable` switch and the installation's
  role keys for `visibleToRoles`; uploads go to `/api/v1/files`; retire the legacy forms backend (`Backend/` form
  modules) and its legacy routes in the web.
- **Done when:** the engine's API hooks and the screens' data paths are tested against the forms API's shapes; the web
  typechecks and builds with no call to a legacy forms route; `Backend/` has no form module.
- **Tests:** unit tests of the mapping layer (both directions), component tests of the screens on mocked hooks.

### 0.16f Engine e2e journeys on the forms API in CI
- **Do:** port the legacy engine e2e journeys (`apps/web/tests/e2e/legacy`) to the BFF sign-in; a CI job that starts the
  dev stack, the API, the worker and the web, seeds the reference design (org, demo users), and runs them. Each journey
  makes its own forms through the forms API.
- **Done when:** the legacy engine e2e journeys (builder, fill, multi-row, data viewer modes) pass against NestJS in CI.
- **Tests:** the e2e suite (`apps/web/tests/e2e/forms`, ported from `legacy/`).

### 0.17a Form engine for ITRMS, part 1a: texts in every language
Split on 2026-10-25 from 0.17 (one session each: 0.17a texts, 0.17b rules and the Ethiopian date, 0.17c print and the
engine's own text). Needs 0.16f.
- **Do:** `I18nText` labels, help texts, placeholders, options and custom messages in the document (a plain string still
  reads as every language); the builder's translation table per language with "missing" hints; the form's own name in
  each language; the API's view schema and exports label fields in the caller's language.
- **Done when:** a form shows in Amharic and English with a fallback for missing translations; the builder lists what is
  untranslated; an export's headers are in the caller's language.
- **Tests:** core unit tests (both languages, the fallback), the translation table component test, an API test of the
  view schema and export headers in `am` and `en`.

### 0.17b Form engine for ITRMS, part 1b: conditional rules and the Ethiopian date
- **Do:**
  - `requiredWhen` and `validWhen` (formula + message) in core, so they run on both sides.
  - An `EthDate` field on the `DatePicker`'s Ethiopian mode in `packages/ui` (stored ISO Gregorian); exports give its
    Ethiopian date column.
  - The server checks every value-holding field's basic type by its kit type, and recomputes formulas before it
    validates and stores.
- **Done when:** an EC date round-trips through submit and storage; a conditional-required rule is enforced by the API; a
  computed value sent wrong is stored right.
- **Tests:** core unit tests (rules), the calendar field component test, API 422 for `requiredWhen`, an API test of a
  forged computed value.

### 0.17c Form engine for ITRMS, part 1c: print mode and the remaining texts
Split on 2026-10-26 (0.17c print and texts, 0.17d the engine's own text, 0.17e the engine's types). Needs 0.17b.
- **Do:**
  - **Print mode** of the renderer (no controls, page breaks, `FormArray` as tables, Ethiopian dates).
  - The remaining texts of a form in every language: row add/remove button texts, the upload button, the options'
    empty message, panel and section titles, data table column headers.
  - The builder's authoring language stored with the form (a plain string's language is the form's, not the viewer's),
    and a new field's key following its English label when the label was first written in Amharic.
- **Done when:** the print view matches a snapshot; a panel title and a row button show in Amharic and English; the
  untranslated count is the same for every builder.
- **Tests:** a print snapshot, core tests of the new texts, designer tests of the authoring language and the key.

### 0.17d Form engine for ITRMS, part 1d: the engine's own text
- **Do:**
  - The engine's own UI text (designer, viewer, renderer) in the message catalogues, with typed message keys (a
    mistyped key fails typecheck).
  - Ethiopic typing mode announced to screen readers.
- **Done when:** the engine's screens show in Amharic; a mistyped message key fails typecheck.
- **Tests:** the catalogue check, component tests of the screens in `am`.

### 0.17e Form engine for ITRMS, part 1e: the engine's types
- **Do:** the engine's renderer, designer, viewer and API hooks typed (stored documents as `unknown` + Zod), with no lint
  override.
- **Done when:** `packages/form-engine/eslint.config.js` has no `any`/`no-unsafe` override and the engine lints clean.
- **Tests:** the existing suites, unchanged in behaviour.

### 0.18 Form engine for ITRMS, part 2
- **Do:**
  - A `RegistryLookup` field type: a searchable picker over a registry (persons and organisations now; vehicles, licences
    and associations later, through a provider registry). It stores the id, shows the facts read-only, and the server checks
    the id exists in the region.
  - The file field on S3 with doc-type tags.
  - `npm run form:schema` is replaced by direct Zod import in the API.
  - (The `Fee` field moved to 0.22 on 2026-10-26: its preview needs the fee rules and their evaluator, which 0.22 builds.)
- **Done when:** picking a person fills the read-only facts and stores only the id; a forged id from another region gets a
  422; a file is stored with its doc-type tag.
- **Tests:** component tests for the lookup field; API tests for lookup scope.

### 0.18a Form governance: stability, checks, tests
Split on 2026-10-26: effect contracts, the service-version mapping, overlay tiers and the impact on cases, effects and
overlays need cases (0.19) and service versions and overlays (0.21); they moved to **0.21a** (now **0.21d**). The fee in test cases waits
for 0.22.
- **Do** ([form-platform.md](../platform/form-platform.md) §2–§4):
  - **Key stability:** keys immutable after the first publish; "remove" hides the field in new versions and keeps its data.
  - **Lint rules:**
    - unreachable fields and circular formulas;
    - missing `am`/`en` labels;
    - required fields that can be hidden without a default;
    - duplicate option values;
    - field count;
    - data-source allow-list.
  - **Form test cases:** stored sample submissions with expected validity and messages, run in the API on publish.
  - **Impact analysis** on publish: saved views using changed keys.
  - Version history with a **diff**; rollback by republishing an earlier version; maker-checker publish.
- **Done when:**
  - renaming a published key is impossible;
  - a failing test case blocks publishing;
  - the impact report lists a saved view that uses a changed field.
- **Tests:** lint rule tests; test-case runner tests; an e2e of an author changing a form, seeing the diff and the impact,
  and getting it approved.

### 0.19a Workflow engine, part 1a: definitions, checks, effect registry
Split on 2026-10-27: 0.19 did not fit one session. The definitions, their checks and the engine's rules (DB-free) come
first; the cases, tasks, events and the transitions endpoint follow in **0.19b**.
- **Do** ([architecture.md](../architecture.md) §8):
  - The workflow definition schema (Zod, `packages/schemas`):
    - state kinds `start`, `task`, **`wait`** (left only by event and timeout transitions, run by **system actors**), `end`;
    - transitions with an assignee role + unit rule (`handling`, `parent`, `region`, a named level, `${approval_unit}`),
      guards, effects, step forms, separation of duties, comment rules, and `reject` only from listed states by `rejectRoles`.
  - Publish-time checks: structure (one start, every state reachable, an end reachable from every state, wait states left
    only by events/timeouts, task states only by actions), known roles, known effects, known step forms.
  - `workflow_definitions`: versioned, content-hashed, immutable versions (class C at the owner unit, like forms); an API to
    check a definition and to store a version only when the checks pass.
  - An effect registry for modules (`@itrms/kernel/effects`): an effect is registered by key with its `Tx`/`Ctx` signature;
    the engine resolves effects only through it.
  - The engine's rules as pure functions: the transitions an actor may take from a state (role, `rejectRoles`, actions vs
    events), separation of duties, guards over case facts, and the assignee unit (incl. the parent-unit routing of a
    one-person office).
- **Done when:**
  - a definition with an unreachable state, no reachable end, an unknown role, effect or step form is refused with a clear
    Amharic/English message, and a valid one is stored as an immutable version;
  - the rules refuse a maker approving their own step, a cashier rejecting, and an action out of a `wait` state;
  - "zone approves for a town" resolves the town's parent unit, and a one-person office routes the SoD step to its parent.
- **Tests:** an engine unit suite (definition validation, transition rules, SoD, guards, assignment); integration tests for
  the definitions API (checks, versions, RLS of class C).

### 0.19b Workflow engine, part 1b: cases, tasks, transitions
Needs 0.19a.
- **Do** ([architecture.md](../architecture.md) §8):
  - `cases` (class T), `case_tasks` (class T on the assignee unit), `case_events` (append-only); `submissions.case_id` gets
    its foreign key.
  - Starting a case from a frozen configuration (definition version, `approval_unit` and other resolved keys), for
    `services` to call; the engine never reads the service catalogue (code-structure.md §3). Until 0.21 the tests start cases.
  - `POST /cases/:id/transitions`, running everything in one transaction: role/unit check, guard, step-form validation,
    effects, events, audit, outbox.
  - Event and timeout transitions as audited system actors (`system:<adapter>`); 0.20 wires the SLA timers to them.
  - Case status changes only through transitions.
- **Done when:**
  - a test workflow runs end to end;
  - a maker cannot approve their own step;
  - a failing effect rolls back everything;
  - a parent-unit approval step works ("zone approves for a town");
  - a `wait` state is left only by its event or its timeout;
  - in a one-person office the separation-of-duties step routes to the parent unit, recorded on the case;
  - a cashier cannot reject a case.
- **Tests:** integration tests with RLS (tasks visible only to the assignee unit and the offices above it; only the step's
  role in that unit acts; the inbox (0.20) lists a person's own role's tasks), the isolation matrix for the new tables,
  and the transition runner's rollback.

### 0.20a Workflow engine, part 2a: calendars, SLA timers, notifications
Split on 2026-10-27: 0.20 did not fit one session. The timers and what they tell people come first; the inbox, the case
page and comments follow in **0.20b**, drafts in **0.20c**.
- **Do:**
  - Working calendars per region/unit (working days and hours, lunch break, half days) + `holidays` (Ethiopian holidays
    seeded; the movable Muslim holidays as marked placeholders per year), and `due_at` computed by one application helper
    in Africa/Addis_Ababa.
  - A task's and a wait's `due_at` from its state's SLA when it opens; BullMQ delayed SLA jobs + a 15-minute sweep;
    overdue marking and an escalation notice one level up; a wait's timeout delivered by `system:timer` (0.19b's
    `deliver`).
  - In-app notifications (a table, the person's list, read/unread) and an SMS **fake** adapter (logged), behind a port.
- **Done when:** an SLA of 8 business hours started Friday 16:00 lands on the right Monday/Tuesday time across a holiday;
  an overdue task notifies the supervisor; a wait past its SLA leaves by its timeout.
- **Tests:** due-date calculation tests (holidays, weekends, lunch, half days, Addis time), SLA job and sweep tests,
  notification isolation.

### 0.20b Workflow engine, part 2b: inbox, case page, comments
Needs 0.20a. Split on 2026-10-28: the workflow slice had no screens yet, and the inbox, the case page, comments and drafts
did not fit one session. The screens people act on come first; drafts and the request lists follow in **0.20c**.
- **Do:**
  - Task inbox (claim, act, filters): a person's own role's open tasks in their active unit, with SLA state.
  - A case page with timeline, answers per step, documents and payments (the last two as they arrive in 0.22–0.23); a
    submission's history shows its case's steps.
  - **Case comments** with `@mentions` (notify the mentioned user) on the case timeline, internal by default; audited.
  - The notifications bell in the shell (unread count, the list, mark read), so a mention or an overdue step is seen; a
    background export tells its requester when it is ready.
- **Done when:** the inbox shows only tasks of the user's role in their unit; a mention notifies.
- **Tests:** inbox e2e, case page e2e, mention integration tests.

### 0.20c Workflow engine, part 2c: drafts
Needs 0.20b. Split on 2026-10-28: drafts are a security feature of their own (SEC-WB-3: what a browser keeps leaves out
the Sensitive fields and is encrypted for its user), which needs the form fields' classification (SEC-DC-1) first. The
approvals inbox, badges and role workspaces follow in **0.20d**; changing a filed request through its case moves to
**0.21** (now **0.21c**: it needs requests started as cases).
- **Do:**
  - A form field's classification (SEC-DC-1: public, internal, personal, sensitive), set in the designer and checked
    when a version is published.
  - Drafts with save and resume (the counter saves a half-filled application while the applicant fetches a missing
    document): on the server (the person's own, on the form version they started), and in the browser (Dexie, ADR-0024)
    every few seconds, encrypted with a non-extractable key bound to the user and without the Sensitive fields, so a
    draft survives a dropped network; signing out with unsaved drafts warns, then deletes the key (SEC-WB-3).
- **Done when:** a draft resumes where it was left, on another PC from the server and after a dropped network from the
  browser; a Sensitive field is never in the browser's storage.
- **Tests:** draft integration tests (own drafts only, isolation, audit), the local store's unit tests (encryption, no
  Sensitive field), a draft e2e journey.

### 0.20d Workflow engine, part 2d: approvals inbox, workspaces, export masking
Needs 0.20c.
- **Do:**
  - The approvals inbox: mine/decidable filters and a cursor on `GET /v1/form-publications`.
  - Badges and role workspaces (home widgets) in the shell; a shared and default saved view in the browser journeys.
  - Exports and query answers mask the fields classified Sensitive by default; they are shown only through the
    audited reveal (SEC-PD-2, SEC-DC-2).
- **Done when:** the approvals inbox pages past 100 publications; a home widget shows the person's open tasks; an export
  masks a Sensitive field.
- **Tests:** the approvals inbox's integration tests, the workspace and saved-view journeys, the masking tests.

### 0.21a Configuration inheritance, part 1: the resolver and the settings registry
Split on 2026-10-28: 0.21 did not fit one session (the settings registry, the service catalogue, its admin screens and
some twenty follow-ups). The one resolver (architecture.md §7) and the settings registry on it come first; the service
catalogue's API follows in **0.21b**, its screens and requests started as cases in **0.21c**; the old 0.21a (effect
contracts and form tiers) is now **0.21d**.
- **Do** (ADR-0026, [org-and-unit-types.md](../platform/org-and-unit-types.md) §4):
  - **One resolver** as pure functions: walks the unit's real ltree ancestors, then its unit type, then the unit (then the
    user for a preference); the nearest value wins per key; a level a key does not allow is refused; the answer names
    where each value comes from. The service configuration (0.21b) uses the same resolver.
  - Settings declared once in code (key, Zod type, default, `overridableAt`, `userPreference`, `sensitive`) in the
    manifests, checked at start-up; `settings_values` extended from one row per region to a scope (org unit, unit
    type), class C; the installation's values are its configuration (`INSTALLATION_SETTINGS`, checked at start-up) and a
    person's own sit with their preferences (`users.preferences`, written only by them).
  - The API: a unit's effective settings with their source, set and reset at a level (If-Match, audited), a person's
    preferences; the workspace carries the effective settings.
  - The settings admin screen: each value with where it comes from, override and reset at the levels the admin may write.
  - The settings follow-ups: theme and density as user preferences (region defaults), export retention and the background
    export limit as region settings, PUT below the region answering 403 alike for a new and an existing row.
- **Done when:** a zone value overrides the region's for its subtree only and a unit's own value beats both; a level a
  key does not allow is refused; reset brings back the inherited value; the admin screen shows where each value comes
  from; a person's theme follows them to another PC.
- **Tests:** resolver unit tests (precedence through real ancestors incl. a region without zones, unit type, user,
  disallowed levels, provenance); integration tests (RLS of the new scopes, sibling units Damot Gale and Boditi, Test
  Zone B, audit, If-Match); a settings screen e2e journey.

### 0.21b Configuration inheritance, part 2: the service catalogue and frozen configuration
Needs 0.21a. Narrowed on 2026-10-29: form overlays (a unit's extra field, re-applied on a new bureau form version)
reach into the forms slice's validation and belong with the overlay tier; they moved to **0.21d**.
- **Do** (architecture.md §6.2, §7):
  - `service_definitions` (all 54 seeded with codes and Amharic/English names, most marked `not_configured`).
  - `service_versions` (form + workflow + fee rule + templates + `overridePolicy`, effective dates), `service_overrides`
    (class C): enabled, SLA hours, `approval_unit`, help texts, the template header.
  - Resolution root → unit through the 0.21a resolver; publish-time cross-checks (the form and workflow versions exist,
    the named effects are registered); a new bureau version re-checks the overrides below it and reports conflicts.
  - Starting a case from a service enabled for the unit: the resolved configuration frozen on the case (hash + version
    ids); the interim intake (`POST /cases` on any workflow) replaced by it.
  - The service follow-ups: unit service overrides checked against the catalogue with If-Match and the version's policy;
    menu `requires` checked against the catalogue; a transfer of a handling unit moving the submission values too.
- **Done when:** a woreda override of an allowed key (SLA, help text) applies to that woreda's new cases only; a
  disallowed key is refused; publishing a new bureau version re-checks the overrides and reports conflicts (an SLA for a
  state the new workflow lacks, a help text for a field the new form lacks); open cases keep their frozen config.
- **Tests:** resolution unit tests (precedence, disallowed keys, override conflicts) and integration tests across sibling
  units (Damot Gale, Boditi) and Test Zone B.

### 0.21c Configuration inheritance, part 3: service admin screens and requests at the counter
Needs 0.21b. Split on 2026-10-29: the screens and the counter come first; what happens to a filed request (the request
lists, changing it through its case) and the remaining follow-ups follow in **0.21e**.
- **Do:**
  - Admin screens: the catalogue, version publish, the override editor showing what is inherited and what is
    overridden; the workflow definitions screen (with the check's problems, switching a workflow off).
  - Requests started as cases at the counter through their service: its request form filled, validated on the server and
    filed with the new case in one transaction; the case page takes a step's form where the service's request flow
    renders it.
- **Done when:** an admin publishes a service version and a zone admin overrides a woreda's SLA from the screens (an
  office never overrides its own, 0.21b); a request filed at the counter starts a case of its service with its answers.
- **Tests:** admin screen e2e journeys (catalogue, publish, override); a request-at-the-counter e2e journey; integration
  tests for the request with its form and for switching a workflow off.

### 0.21d Form governance, part 2: effect contracts and form tiers
Moved from 0.18a on 2026-10-26 (it needs cases, service versions and overlays); renamed from 0.21a when 0.21 was split on
2026-10-28. Needs 0.21c.
- **Do** ([form-platform.md](../platform/form-platform.md) §2–§4):
  - **Effect input contracts** in module manifests (Zod), a service-version mapping from contract paths to form keys,
    contract fields locked in the builder (key, type, required), and publish failing when a contract is unmet. This
    generalises the legacy server-action input model and `register_check`.
  - **Impact analysis** on publish, completed: open cases per version; reports and widgets using changed keys; bound
    effects; overlay conflicts.
  - Three form tiers (bureau, overlay, unit-local) enforced by permissions.
  - **Form overlays** (moved from 0.21b on 2026-10-29): a unit's override adds fields after an anchor (and changes
    options within the allowed set); the overlaid form is what the unit's new cases fill in and are validated on; a new
    bureau form version re-applies the overlays and reports conflicts.
- **Done when:**
  - removing a contract field from the licence application fails to publish, with a clear Amharic/English message;
  - a zone overlay can add a field but can't touch a locked one;
  - a woreda's extra field applies to its new cases only, and a new bureau form version re-applies it and reports
    conflicts.
- **Tests:** contract checker unit tests; overlay tier tests; overlay re-application and conflict tests.

### 0.21e Configuration inheritance, part 4: filed requests and the remaining follow-ups
Split from 0.21c on 2026-10-29. Needs 0.21c.
- **Do:**
  - Cross-form request lists by state (waiting, recent) through the case workflow and its inbox.
  - Changing a filed request as a workflow transition (re-validated on its version, keeping role-restricted values).
  - The remaining follow-ups moved to 0.21: maker-checker on role grants (SEC-AC-6), lookup labels in a step's printed
    answers, the release of unclassified answers (an ADR or a doc fix).
- **Done when:** a filed request changed through its case is re-validated and audited; a role grant waits for a second
  administrator's confirmation.
- **Tests:** integration tests for the change-request transition and the role-grant confirmation; the request lists'
  journey.

### 0.22 Fees, payment orders, cashier, receipts
- **Do:**
  - Fee rules (versioned JSON, shared formula evaluator, integer santim, explicit rounding).
  - `fees.createPaymentOrder` effect; cashier screen (record cash / bank-slip payment); receipt numbers from counters; the
    receipt PDF (via 0.23, a placeholder until then).
  - **Paid elsewhere:** `external_payment_refs`, unique per issuer + reference + fiscal year, state `pending_verification`.
    A `finance_officer` other than the person who entered it verifies the reference, or it is matched against an imported
    daily statement. Only verified references settle a case.
  - Reversal with a reason and a second person's approval.
  - The `payment.settled` guard for workflows.
  - The form engine's `Fee` field (moved from 0.18): a preview of the server-computed fee via `POST /fees/preview`, updated
    when its inputs change.
- **Done when:** the fee preview equals the server figure on submit; a payment order total equals the sum of the rule's lines in santim; receipt numbers are gapless per unit
  and fiscal year under concurrency; a reversal keeps the original number and shows on the case; the same external
  reference can't settle two cases; an unverified reference can't settle any.
- **Tests:** fee rule golden tests (renewal with penalty months, replacement), concurrency tests on receipts, reversal SoD
  test; a component test of the Fee field and an API test of fee preview and submit consistency.

### 0.23 Document templates, PDF worker, QR verification
- **Do:**
  - `document_templates` (LiquidJS, versioned, data schema, unit header inheritance) and `issued_documents`.
  - A separate **`worker-documents`** service: Puppeteer with JavaScript disabled, no network, a `default-src 'none'` CSP,
    bundled fonts, a page pool and a memory limit → S3. LiquidJS with `outputEscape: 'escape'`.
  - QR codes with an **Ed25519-signed compact payload**, verifiable offline. A small **verifier PWA** (`apps/verify`, a static export, ADR-0032) carries the region's
    public key. The public page `verify.<domain>/<token>` shows revocation and superseded status (rate-limited, minimal
    data). Nginx on `verify.<domain>` proxies only `GET /v1/public/verifications/{token}` and denies everything else;
    hash-based CSP.
  - Templates: application copy (print mode), receipt, driver-licence certificate/card layout, exam result sheet.
- **Done when:** PDFs render Ethiopic text and Ethiopian dates correctly; the QR resolves to valid/revoked/superseded; a
  reprint returns the stored PDF; the API process never launches Chrome; applicant text containing `<script>` renders as
  text; the verifier PWA validates a QR in flight mode and rejects a tampered payload.
- **Tests:** template data-schema tests, golden PDF text-extraction tests, a verification page test, a rate-limit test.

### 0.24 Driver-licence slice (competency module)
- **Do:** module `competency`:
  - `driver_licences`, `licence_grades`, `medical_certificates`, `training_enrolments`, `exam_sessions`/`exam_results`,
    `licence_print_batches`.
  - Effects `competency.createPendingLicence`, `competency.activateLicence`, `competency.voidPendingLicence`,
    `competency.renewLicence`, `competency.addToPrintBatch`. A licence is `pending_national` until the (fake) national
    platform accepts it: a `wait` state. The certificate and print batch follow acceptance.
  - The `NationalDriverPlatform` interface + **fake** (returns national licence status, accepts print requests).
  - Service versions for **new licence** and **renewal** (forms, workflows, fee rules with late penalty, templates),
    following Proclamation 1074/2018 ([ethiopia-context.md](../ethiopia-context.md) §3.1):
    - the `licence_grades` catalogue from Art. 12;
    - age, education and prerequisite checks;
    - a temporary licence for 2 years;
    - renewal for 4 years (2 years over age 55);
    - late renewal of more than 1 year adds a practical exam.
  - Handled by the zone department or a town unit with a competency team (unit types; woredas don't offer DVC services).
    The approval unit is the allowed override `approval_unit` (`handling` by default, `parent` = the zone).
  - The training-school register as organisations.
- **Done when:** both services run end to end on the platform with zero service-specific UI code except the registry views;
  licence facts land in typed tables; the fake national adapter is called through the outbox.
- **Tests:** effect integration tests; workflow-run tests for both services; adapter contract tests (the fake and future real
  implementations share them).

### 0.25 Demo data and the demo journey
- **Do:**
  - Seed data as in [demo-plan.md](../demo-plan.md) §4 (generated, realistic, **no real people**): all Wolaita units, users
    in Damot Gale, Boditi and the zone, 3 training schools, ~200 persons, ~60 licences in mixed states, exam sessions, fee
    rules, holidays.
  - The demo script: the journey of [demo-plan.md](../demo-plan.md) §3, in Amharic and English, with Wolaytta shown.
  - A **second demo region** (a city administration with sub-cities, Afaan Oromo enabled with partial translations) and
    neutral "Sample Regional Transport Bureau" branding.
  - Playwright e2e of the whole journey.
- **Done when:** `pnpm demo:reset` recreates the demo in under 2 minutes, and the e2e demo journey is green.
- **Tests:** the demo e2e (also a regression suite for later phases).

### 0.26 Demo installation and Phase 0 hardening
- **Do:**
  - Compose production profile (Nginx TLS, three hostnames, images from CI, `migrate` service, egress proxy, LUKS data
    volume, chrony) on a demo server.
  - Backups pulled by a pgBackRest repository host on a second machine (encrypted), SeaweedFS `filer.sync` + append-only
    restic, and one restore drill that checks files against database rows and the audit hash chain (ADR-0012, ADR-0031).
  - A security pass: reviewer agent + `security-review` over auth, RLS, files and the verification page.
  - A smoke load test on the inbox and the query API with **k6** (thresholds in CI, nightly).
  - Update the docs.
- **Done when:** the demo runs on the server from released images, a restore into a scratch stack reproduces the demo, and
  the security findings are fixed or recorded with a decision.
- **Tests:** the restore drill script with checks; the smoke load test thresholds in CI (nightly).

## Phase acceptance criteria
1. All tasks done (0.1–0.26 with 0.19 as 0.19a and 0.19b, 0.20 as 0.20a, 0.20b, 0.20c and 0.20d, 0.4a, 0.4b, 0.4c, 0.18a, and 0.21 as 0.21a, 0.21b, 0.21c, 0.21d and 0.21e), CI green on `main` (lint, typecheck, unit, integration on Postgres, isolation matrix, i18n keys,
   security scans, e2e).
2. The demo journey runs in Amharic and English (Wolaytta with fallback) across Boditi, the zone and Damot Gale. A user of one office
   sees none of the other office's cases,
   receipts or documents, while shared registry records are visible region-wide (ADR-0013).
3. Every change in the demo produces audit rows; receipts are gapless; PDFs verify by QR.
4. Server-side validation rejects every invalid submission the browser would reject (shared case file).
5. The demo installation is restorable from the nightly backup.

## Tests to write in this phase (summary)
Isolation matrix (0.9); audit-in-transaction (0.7); numbering concurrency (0.11); calendar reference + property tests
(0.12); i18n completeness (0.13); shared validation cases (0.16a); workflow engine suite (0.19a, 0.19b); SLA date math (0.20a);
configuration resolution (0.21a, 0.21b); fee goldens (0.22); PDF goldens (0.23); demo e2e (0.25); restore drill (0.26).

## Open questions for the product owner (block or shape Phase 0)
1. ~~Object storage~~ **Decided:** SeaweedFS (ADR-0020). Every technical question is answered in [tech-stack.md](../tech-stack.md).
2. ~~Demo zones~~ **Decided:** Wolaita Zone. Still open: the Amharic spellings, woreda categories and town grades
   ([tenant-wolaita.md](../tenant-wolaita.md) §6).
3. **Paper forms:** please provide scans of the licence application, medical certificate, exam result sheet, licence
   renewal form, fee schedule and receipt, so the demo forms match reality. The scans in `Documents/` are staffing tables
   (Form 15).
4. **National platform:** which licensing steps stay with the zone once MoTL's digital driver platform is live? Who at the
   bureau can tell us about its interfaces?
5. **Who approves what:** does a woreda issue licences, or only receive applications while the zone approves and the region
   prints?
6. **Fees:** the regional fee schedule for licences (Regulation 572/2025 sets federal MoTL fees; the region may have its
   own).
7. **Receipts:** does the region use controlled pre-printed receipt pads (finance series) that ITRMS must record, or may
   ITRMS issue receipt numbers?
8. **Record history across zones:** may a zone see the summary history (service, date, unit, outcome) of a vehicle or driver
   handled by another zone? (proposed default: yes, summary only)
9. ~~Languages~~ **Decided:** Amharic, English, Wolaytta. Still open: a named Wolaytta translator and reviewer
   ([i18n-and-languages.md](../i18n-and-languages.md) §7).
10. **Connectivity:** the technical answer is decided (an online-first PWA, ADR-0024). Still needed from the zone: which
    offices have frequent outages, so the pilot can measure them.
