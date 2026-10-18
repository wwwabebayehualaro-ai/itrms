# Code structure: frontend, backend and shared packages

How the source code is laid out, what each folder may import, and where new code goes. It refines
[modularization.md](modularization.md) (what a module is) and architecture §2. The decision is
[ADR-0032](../decisions/0032-workspace-structure.md).

## 1. Principles

1. **Every slice has the same shape.** The kernel, each platform service, each registry and each work-process module is a
   workspace package with the same folders (`contracts`, `api`, `web`, `messages`, `seed`, `test`). Once a developer has
   learned one slice, they can work in any of them.
2. **Apps are thin composition roots, and nothing imports an app.** `apps/api` and `apps/web` choose the slices, bind
   implementations to ports, and hold no business rules. Everything a slice needs at runtime comes from a package below it:
   * on the server, from the kernel (`db.scoped`, `@Require`, audit, effects, ports);
   * in the browser and in Server Components, from the kernel's web runtime (API fetcher, active unit, permissions,
     drafts).
3. **Layers are folders, and the order inside a layer is written down** (§3). dependency-cruiser checks the paths, so a rule
   can be read from the tree.
4. **A slice's public surface is its `exports`.** Everything else is private, and the package `exports` field makes it
   unreachable.
5. **One source per fact.** A Zod schema in `contracts` drives server validation, the OpenAPI document, the typed web client
   and the browser form check.
6. **Server and browser code are separate on purpose.** `api/` never reaches a browser bundle, and server-only web code is
   marked `server-only`. In `web/`, Server Components are the default and `'use client'` marks only the interactive leaves.
7. **Repetitive code is generated and checked.** Route files, the API client and the slice scaffold are generated. CI fails if
   a generated file is stale.

## 2. The tree

```
itrms/
├─ apps/
│  ├─ web/                  @itrms/web     Next.js 16 staff application + BFF (composition root)
│  ├─ api/                  @itrms/api     NestJS 11 on Fastify: HTTP, workers, migrations (composition root)
│  └─ verify/               @itrms/verify  public verification page + verifier PWA (static export)
├─ platform/                layers 1–2, in dependency order (§3)
│  ├─ kernel/               @itrms/kernel        config, errors, context, db, iam, org, settings, audit, numbering,
│  │                                             idempotency, outbox, jobs, effects, files, i18n, notifications, search,
│  │                                             ports, observability, testing + the web runtime
│  ├─ integrations/         @itrms/integrations  adapters and fakes for kernel ports; ports + adapters for other systems
│  ├─ forms/                @itrms/forms         form definitions, versions, submissions, query compiler, saved views
│  ├─ fees/                 @itrms/fees          fee rules, payment orders, payments, receipts, cashier
│  ├─ documents/            @itrms/documents     templates, PDF rendering, QR signing, verification
│  ├─ workflow/             @itrms/workflow      definitions, cases, transitions, tasks, SLA, inbox, case page
│  ├─ services/             @itrms/services      service catalogue, versions, overrides; starts cases with a frozen configuration
│  └─ reports/              @itrms/reports       datasets (read-only views), dashboards, exports
├─ modules/                 layers 3–4: the business
│  ├─ _template/            the scaffold used by `turbo gen module`
│  ├─ parties/ vehicles/ drivers/ associations/ road-assets/                     registries
│  └─ competency/ public-transport/ freight/ road-safety/ road-quality/
│     design-contracts/ community/ logistics/ hr/ planning/                      work processes
├─ packages/                layer 0: libraries with no ITRMS runtime
│  ├─ schemas/              @itrms/schemas            primitives: Money, I18nText, ids, dates, problem+json, error codes
│  ├─ ethiopian-calendar/   @itrms/ethiopian-calendar conversion, formatting, fiscal year, Ethiopian clock
│  ├─ form-engine/          @itrms/form-engine        core (UI-free) · renderer · designer · viewer
│  ├─ ui/                   @itrms/ui                 design system, tokens, page templates, Ethiopian controls
│  ├─ module-sdk/           @itrms/module-sdk         defineModule, manifest schema, slot types (isomorphic)
│  ├─ api-client/           @itrms/api-client         openapi.json, generated types, typed fetch client
│  ├─ testing/              @itrms/testing            factories, fixed clock, seeded ids, Testcontainers, Ethiopic samples
│  └─ config/               @itrms/config             tsconfig, ESLint, Prettier and Vitest presets
├─ tests/
│  ├─ e2e/                  Playwright: config, cross-module journeys (the demo journey), fixtures
│  └─ load/                 k6 scenarios
├─ infra/                   compose/ (incl. nginx, keycloak), observability/, backup/
├─ turbo/generators/        `turbo gen` templates: module, feature, screen, effect
├─ tools/                   repository scripts: progress, hooks, i18n check, licence report, route and icon-map generators
├─ docs/
├─ .github/                 workflows, CODEOWNERS, pull request template
├─ package.json  pnpm-workspace.yaml  turbo.json  .dependency-cruiser.cjs  renovate.json  .nvmrc  .gitattributes
└─ Documents/               (ignored; never in the repository)
```

`pnpm-workspace.yaml` lists `apps/*`, `platform/*`, `modules/*` and `packages/*`. Package names are unique and flat
(`@itrms/<folder>`), so an import shows where the code lives.

## 3. Layers and dependency rules

| Folder | May import | Never imports |
|---|---|---|
| `packages/schemas`, `packages/ethiopian-calendar` | npm packages only | anything internal |
| `packages/form-engine` `core` | `schemas`, `ethiopian-calendar`, Zod | React, DOM, `ui` |
| `packages/form-engine` UI entries, `packages/ui` | the packages above | `platform/*`, `modules/*` |
| `packages/module-sdk`, `packages/api-client`, `packages/testing`, `packages/config` | `schemas` (and npm packages) | `platform/*`, `modules/*`, `ui` |
| `platform/kernel` | `packages/*` | every other `platform/*`, `modules/*` |
| `platform/<service>` | `packages/*`, the kernel, and the platform services **before it** in the order below | services after it, `modules/*` |
| `modules/<registry>` | `packages/*`, `platform/*`, registries named in `dependsOn` (no cycles) | work-process modules |
| `modules/<work process>` | `packages/*`, `platform/*`, registries | **other work-process modules** (use events or a registry) |
| `apps/web`, `apps/api` | any slice's public entries | another app |
| `apps/verify` | `ui`, `schemas`, `ethiopian-calendar`, `api-client`, `@itrms/documents/contracts` | any other slice, the staff app |

**Platform order:** kernel → integrations → forms → fees → documents → workflow → services → reports.
* `workflow` is a generic engine. It runs cases on a **frozen configuration** that it is given, and it calls effects
  through the kernel's effect registry.
* `services` sits above it. It resolves a service's configuration for the unit, freezes it, and starts the case
  (`services.startCase` → `workflow.createCase(tx, frozenConfig)`).
* **References up the order are plain ids, never foreign keys.** Examples: `submissions.case_id`, `payment_orders.case_id`,
  `issued_documents.case_id` and `cases.service_version_id`. A lower slice treats such an id as an opaque owner reference.
  The upper slice writes both rows in one transaction, and its integration tests check that they agree. Foreign keys
  point only down the order (modularization §7).

Rules inside every slice:
* The entry points are the only barrels: `contracts/index.ts`, `api/index.ts`, `web/server.ts` and `web/client.ts`. There
  are no internal `index.ts` files, which avoids hidden cycles and slow builds.
* `contracts/**` is isomorphic. It imports only `schemas` and Zod, never `@nestjs/*`, React or Node built-ins (lint rule).
  DI tokens there are plain `Symbol`s.
* `web/**` never imports `api/**`. Files under `web/screens` and `apps/web/src/bff` start with `import 'server-only'`.
* Inside a package, imports use Node subpath imports (`#db/schema`, mapped in `package.json` `imports`), not long relative
  paths and not `tsconfig` `paths`.
* **The system database pool** (`itrms_system`, BYPASSRLS) is exported only from `@itrms/kernel/db/system`. Three rules
  keep request paths away from it (architecture §5):
  * it may be imported only from `jobs/`, `handlers/`, a slice's `api/worker.ts` and the worker entry points;
  * `jobs/` and `handlers/` are registered only by the slice's `api/worker.ts`, never by its HTTP side (`api/index.ts`);
  * no import path at all, re-exports included, leads from `apps/api/src/main.ts`, a slice's `api/index.ts` or a kernel
    subpath to the pool (a reachability rule).
* Every `@itrms/*` and `#…` import must resolve. An unresolved one would be matched as a raw string and slip past the
  path rules.

dependency-cruiser checks all of this in CI (`pnpm boundaries`), and each rule has a failing fixture (task 0.2). The platform
order and the registry list live in `tools/boundaries/layers.cjs`; `pnpm check:slices` refuses a platform slice outside the
order. ESLint adds what imports can't show: no browser globals or JSX in `form-engine/src/core`, `contracts/` and `api/`.

## 4. A slice package

Every package under `platform/` and `modules/` looks like this. The kernel has the same top level, with one folder per
subsystem inside `api/` and `web/`.

```
modules/competency/
├─ package.json            "name": "@itrms/competency"
│                          exports: ./manifest ./contracts ./api ./api/worker ./web/server ./web/client ./messages/* ./seed
├─ module.ts               the manifest (modularization.md §4): menu, widgets and slots are data here, not components
├─ README.md               what it owns, its public API, events, settings
├─ contracts/              isomorphic: what other slices and the web may depend on
│  ├─ index.ts
│  ├─ licence.dto.ts       Zod schemas of requests and responses
│  ├─ events.ts            versioned event names and payload schemas (§5.6)
│  ├─ permissions.ts       permission keys (typed constants)
│  ├─ errors.ts            error codes and i18n title keys
│  └─ queries.ts           query and command interfaces + DI tokens (Symbols) offered to other slices
├─ api/                    server only (NestJS)
│  ├─ index.ts             CompetencyModule (HTTP side) and the providers bound to the tokens in contracts/queries.ts
│  ├─ worker.ts            the worker side: registers jobs/ and handlers/; loaded only by the worker processes
│  ├─ competency.module.ts
│  ├─ licences/            one folder per feature (aggregate), not per technical layer
│  │  ├─ licences.controller.ts
│  │  ├─ licences.service.ts
│  │  ├─ licences.repository.ts
│  │  ├─ licences.table.ts
│  │  └─ licences.service.spec.ts
│  ├─ exams/  print-batches/ …
│  ├─ effects/             issue-licence.effect.ts … (named in service versions)
│  ├─ handlers/            payment-settled.handler.ts … (event consumers, idempotent)
│  ├─ jobs/                queue processors owned by this slice
│  └─ sql/                 SQL drizzle-kit can't express (triggers, SECURITY DEFINER functions); placed into migrations
├─ web/
│  ├─ server.ts            screens and route map (server only)
│  ├─ client.ts            client components other slices may embed (record tabs, pickers)
│  ├─ routes.ts            route path → screen, segment config (input to the route generator)
│  ├─ screens/             applications-list.screen.tsx, licence.screen.tsx … ('server-only')
│  ├─ components/          'use client' leaves used by the screens
│  ├─ queries/             TanStack Query option factories and mutations per resource
│  └─ widgets/
├─ messages/               am.json, en.json, wal-Latn.json: keys `competency.<area>.<key>` (§9)
├─ seed/
│  ├─ services/DVC-03/     form.json, workflow.json, fee-rule.json, templates/*.liquid
│  ├─ unit-types.yaml      the slice's defaults per unit type
│  └─ demo/                generators for demo data (never real people)
└─ test/
   ├─ integration/         *.int.spec.ts against PostgreSQL 16 (Testcontainers)
   ├─ e2e/                 *.e2e.ts Playwright journeys of this slice
   └─ fixtures/
```

* Other slices use `contracts` for types, events and DI tokens. A registry's commands and query services are bound to those
  tokens in its `api` entry, so a work-process module's `api` may import a registry's `api` entry to register it as a
  dependency (modularization §5). It never reaches a registry's internals.
* Unit tests sit next to the code (`*.spec.ts`, `*.spec.tsx`). `test/` holds what needs infrastructure.

## 5. Backend

### 5.1 `apps/api`, the composition root

```
apps/api/
├─ instrumentation.ts      OpenTelemetry + Sentry SDK; loaded before anything else (--import)
├─ src/
│  ├─ main.ts              HTTP process: NestFactory + FastifyAdapter, problem+json filter, OpenAPI at /api/docs (internal)
│  ├─ worker.ts            BullMQ consumers (each slice's ./api/worker): outbox relay, notifications, SLA, reports, imports
│  ├─ worker-documents.ts  documents queue only; the one process that starts Chrome (architecture §10)
│  ├─ migrate.ts           applies migrations; run by the Compose `migrate` service before the app starts
│  ├─ app.module.ts        KernelModule.forRoot(config) + the installed slices + port bindings (fake or real adapter)
│  ├─ slices.ts            the installed slice list; availability (licence, flags, unit) is checked per request
│  └─ openapi.ts           writes packages/api-client/openapi.json (`pnpm openapi`)
├─ drizzle.config.ts       lists every slice's *.table.ts → one migration history
├─ drizzle/                generated, reviewed SQL migrations (forward-only) + custom migrations from slices' sql/
├─ seed/org/*.yaml         org-tree seeds (e.g. south-ethiopia.wolaita.yaml)
├─ test/                   app-level checks: every route has @Require/@Public, manifests valid, migrations from zero
├─ webpack.config.js       bundling (§5.5)
└─ Dockerfile              one image; the command selects main, worker, worker-documents or migrate
```

**Each process validates its own configuration.** The Zod config schema has one variant per entry point. `main` refuses
to start if a system database address or the document-signing key is present. Only `worker` receives the system pool,
and only `worker-documents` receives the signing key. Compose passes each service only its own secrets.

### 5.2 Inside a feature

| File | Responsibility | Rules |
|---|---|---|
| `*.controller.ts` | HTTP only | `@Require('licence:issue')` on every handler; Zod DTO in (nestjs-zod), service call, Zod DTO out. No logic, no `tx` |
| `*.service.ts` | one use case per public method | opens `db.scoped(ctx, tx => …)`; checks business rules; throws `AppError` subclasses; changes case state only through workflow transitions |
| `*.repository.ts` | Drizzle queries on the `tx` it is given | every write goes through the kernel's audited write helpers (audit row + outbox event in the same transaction); never opens a transaction |
| `*.table.ts` | Drizzle table in the slice's PostgreSQL schema (`pgSchema('competency')`) | declares its RLS class with `withRls(table, 'T')`. The migration generator writes the class's policies with `rlsPolicies(table, class)` (architecture §5), and the isolation matrix reads the same metadata. Triggers, functions, partitions and grants go in `api/sql/` |
| `effects/*.effect.ts` | code a service configuration names (`@Effect('competency.issueLicence')`, from `@itrms/kernel/effects`) | runs inside the transition's transaction **as `itrms_app`**; input typed by the form↔effect contract (form-platform.md). An effect that must touch rows outside the actor's scope calls an audited `SECURITY DEFINER` command, never the system pool |
| `handlers/*.handler.ts` | reacts to another slice's event (`@OnEvent('payment.settled.v1')`) | runs in the worker; idempotent (keyed by event id); never calls back synchronously |
| `jobs/*.processor.ts` | slow or external work | runs in the worker; idempotent; retries with backoff; dead letters alerted |

Other slices get data only through a slice's query and command interfaces (§4). No slice reads another slice's tables
(modularization §5).

### 5.3 The kernel package

`platform/kernel/api/` has one folder per subsystem, each a subpath export, so imports say what they use:
`@itrms/kernel/db`, `/db/system`, `/iam`, `/org`, `/settings`, `/errors`, `/context`, `/audit`, `/numbering`,
`/idempotency`, `/outbox`, `/jobs`, `/effects`, `/files`, `/i18n`, `/notifications`, `/search`, `/config`, `/ports`,
`/testing`.
* `settings` holds the settings registry and the **one resolver** that walks the ltree ancestors, then the unit type, then
  the unit (org-and-unit-types.md). `services` uses the same resolver for service overrides.
* `effects` holds the `@Effect` and `@OnEvent` decorators, their `Tx`/`Ctx` signatures and the registry the workflow engine
  calls.
* `ports` holds the interfaces the kernel itself needs: `SmsGateway`, `EmailSender`, `IdentityAdmin` (the Keycloak Admin
  API), `ObjectStore` (S3) and `Antivirus` (ClamAV).
* `testing` holds the isolation-matrix generator and the scoped-context helpers, which need the kernel's table-class
  registry.
* The kernel's own screens are in `platform/kernel/web`: users and role assignments, org tree, unit types, settings,
  languages, audit viewer and jobs. Slots let higher slices add to them; for example, `services` contributes the
  "default services" editor to the unit-type screen.

### 5.4 External systems

`platform/integrations/<system>/` holds, for each external system:
* the **fake** (the default in dev and tests) and the **real adapter** of each kernel port (sms, email, keycloak-admin,
  object-store, antivirus);
* for every other system (payments, fayda, motl-vehicles, motl-drivers, …), the **port** as well;
* one **contract test suite** that the fake and the real adapter must both pass.

Slices depend on ports, never on adapters. `app.module.ts` binds the implementation.

### 5.5 Build

Internal packages are TypeScript source. Their `exports` point at `.ts` files, and they have no build step of their own.
* The API is **bundled** by Nest's webpack builder with `swc-loader` (decorator metadata on). The `@itrms/*` packages are
  bundled in; npm packages stay external. Node never loads a `.ts` file at runtime.
* Next.js compiles the packages it uses through `transpilePackages`.
* Vitest uses `unplugin-swc` in the shared preset, so NestJS dependency injection works in tests as it does in the bundle.

This replaces `nest build -b swc` in tech-stack T25a. That builder compiles only the app's own source root, so it can't
compile workspace packages.

### 5.6 Events

Events are named `<entity>.<happened>.v<n>` (`licence.issued.v1`), and their payload schemas live in the emitting slice's
`contracts/events.ts`.
* A change that breaks a payload adds `v2`. The emitter publishes both versions until no consumer reads `v1`, for at least
  one release.
* Outbox rows outlive deployments, so a handler must accept every version that can still be in the outbox.

## 6. Frontend

### 6.1 `apps/web`, the composition root

```
apps/web/
├─ instrumentation.ts          OpenTelemetry + @sentry/nextjs (must be at the project root, next to app/)
├─ proxy.ts                    Next 16 request proxy (formerly middleware): CSP nonce, security headers, redirect to sign-in
├─ app/
│  ├─ layout.tsx               html lang/dir, fonts (self-hosted Noto), theme and density classes, providers
│  ├─ (auth)/                  sign-in, signed-out, session-expired, error
│  ├─ (workspace)/             authenticated shell (Server Component layout: session check, menu, unit switcher, palette)
│  │  ├─ page.tsx              home: the role workspace (widgets)
│  │  ├─ inbox/  cases/[caseId]/  cases/new/  registry/…  reports/…  admin/…
│  │  └─ competency/           GENERATED: layout.tsx (availability check) + one route file per screen
│  ├─ (print)/                 print layouts (no shell)
│  └─ api/                     BFF route handlers
│     ├─ auth/[...route]/      login, callback, logout, refresh (openid-client)
│     ├─ v1/[...path]/         proxy to the API (rules below)
│     └─ health/
├─ src/
│  ├─ bff/                     session store (Valkey), token refresh, CSRF, the server API fetcher ('server-only')
│  ├─ shell/                   AppShell, menu composition from manifests, command palette, unit switcher, notifications
│  ├─ providers/               QueryClientProvider, NextIntlClientProvider, theme, toasts, the web-runtime providers
│  ├─ i18n/                    next-intl request config; merges shell + slice catalogues
│  ├─ sw.ts                    Serwist service worker
│  └─ slices.ts                the installed slices' web entries
├─ messages/{am,en,wal-Latn}.json   shell strings only (`shell.*`, `common.*`)
└─ next.config.ts              transpilePackages for internal packages, CSP, images
```

* **The web runtime.** Slices never import the app. They use `@itrms/kernel/runtime/server` (`serverApi()`, the active
  unit, `can()`) and `@itrms/kernel/runtime/client` (`useActiveUnit`, `<Can>`, `useDraft`, the submit queue,
  `format`). The app provides the implementations at start-up: the BFF's token-carrying fetcher and the session-backed
  context. The Dexie drafts and submit queue are implemented in the runtime package itself.
* **Language is not in the URL.** It comes from the user's preference (a cookie set by the BFF), so a deep link to a
  case works for colleagues who read another language.
* **Routes are generated.** `pnpm gen:routes` reads every slice's `web/routes.ts`. For each module segment it writes:
  * a `layout.tsx` that checks on the server that the module is available in the active unit and returns `notFound()` if
    not;
  * one route file per screen that re-exports the screen, its `generateMetadata` and its boundaries, and writes the
    segment config (`dynamic`, `revalidate`) as **literal values**, because Next.js does not read re-exported segment
    config.

  CI runs the generator with `--check`. The API stays the real enforcement: a hidden route is a convenience.
* **Authentication is checked in the handler, not only in `proxy.ts`.** The `(workspace)` layout and every BFF route
  handler verify the session themselves, so a proxy bypass grants nothing.
* **BFF proxy rules** (`api/v1/[...path]`):
  * the target URL is rebuilt from the validated segments, under `/api/v1/` only; `..`, encoded separators and other
    prefixes (`/api/docs`, metrics, admin UIs) are refused;
  * only allow-listed headers are forwarded (`Idempotency-Key`, `If-Match`, `Accept-Language`, `X-Org-Unit`, the trace
    headers), never the cookie;
  * CSRF is checked on every unsafe method;
  * responses stream through, with the API's problem+json kept as is.

### 6.2 Inside a slice's `web/`

| Kind | Rendering | Rules |
|---|---|---|
| `screens/*.screen.tsx` | Server Component, `server-only` | built from a page template (`ListPage`, `RecordPage`, `CasePage`, `FormPage`, `DashboardPage`, `SettingsPage`); prefetches its queries with `serverApi()` and hands them over with `HydrationBoundary` |
| `components/*.tsx` | `'use client'` | interactive leaves only; UI only from `@itrms/ui` |
| `queries/*.queries.ts` | both | `queryOptions` factories with keys `[slice, resource, params]` and mutations; HTTP only through `@itrms/api-client` via the BFF |
| `widgets/*.widget.tsx` | Server Component + client leaf | declared in the manifest; one query each; skeleton while loading |

State rules:
* **Server state:** TanStack Query only. Mutations invalidate by key prefix.
* **URL state** (filters, sort, paging, tabs): typed search parameters with **nuqs**, so every list view is a shareable
  deep link (tech-stack T38).
* **Form state:** `useZodForm` with the slice's contract schema, or the form engine renderer.
* **No global client store.** Shell state (active unit, theme, density, language) comes from the server through the web
  runtime and React context.
* Every command sends an `Idempotency-Key` created once per submit attempt and kept with the draft in Dexie, so a retry
  after a dropped connection never applies twice.

### 6.3 `apps/verify`

A separate, small Next.js app built as a **static export** and served by Nginx on `verify.<domain>`. It has no session,
no BFF and no access to the staff application. It has two parts:
* the verification page;
* the verifier PWA, which checks a QR's Ed25519 signature offline with the region's public key.

Rules:
* Nginx on `verify.<domain>` serves the static files, rewrites `/<token>` to the one client page (`try_files`), and proxies
  exactly one API path, `GET /v1/public/verifications/{token}`. Later it also proxies the payment webhook paths. It denies
  everything else, so the staff API is never reachable on the public hostname.
* The CSP is **hash-based**, because a static export has no per-request nonce: `default-src 'none'`, the build's script
  hashes, `connect-src 'self'`.
* It may import only the packages listed in §3, which keeps the public attack surface small and separate.

## 7. Shared packages

| Package | Holds | Does not hold |
|---|---|---|
| `schemas` | Money (bigint santim), I18nText, UUIDv7 ids, business dates, problem+json and the common error codes, paging/filter/sort schemas, the form-definition and workflow-definition contracts | any module's DTOs (they live in the module's `contracts`) |
| `ethiopian-calendar` | pure functions and locale data (am, en, om, ti, wal-Latn), fiscal year, Ethiopian clock | React components (the DatePicker is in `ui`) |
| `form-engine` | `core`: model, conditions, validation, formulas (BigInt santim mode); `renderer`, `designer`, `viewer`; `test/cases.json` (the shared validation cases) | HTTP calls (an injected `FormsClient`) |
| `ui` | `tokens.css`, themes, primitives (shadcn/ui copies on Radix), components, page templates, Ethiopian controls (DatePicker, EthiopicInput, MoneyInput), `PdfViewer`, stories | business logic, data fetching, user-visible strings (labels come in as props or keys) |
| `module-sdk` | `defineModule` and the manifest's Zod schema, slot types (menu, widgets, record tabs, search providers, quick actions); isomorphic | runtime code, effect signatures (those are in `@itrms/kernel/effects`) |
| `api-client` | `openapi.json` (generated), types from openapi-typescript, the openapi-fetch client with idempotency, problem+json and trace-id middleware | hand-written endpoint wrappers |
| `testing` | data factories, a fixed clock (Africa/Addis_Ababa), seeded ids, Testcontainers setup (PostgreSQL 16, Valkey, SeaweedFS, Keycloak), Ethiopic and Wolaytta text samples | the isolation matrix (in `@itrms/kernel/testing`), fixtures copied from real people |
| `config` | `tsconfig` bases (`base`, `node`, `next`, `library`), ESLint 10 flat config, Prettier, Vitest presets (incl. `unplugin-swc`) | anything that runs in the product |

Every package still runs its own `typecheck`, `lint` and `test`, and Turborepo caches them per package.

## 8. One contract from database to screen

```
modules/<key>/contracts (Zod) ──► API: nestjs-zod validates requests and responses
                              ├─► openapi.ts ──► packages/api-client/openapi.json ──► openapi-typescript types
                              │                                                  └─► openapi-fetch client ──► web queries
                              └─► web: useZodForm uses the same schema for the browser check
```

`pnpm openapi` regenerates the contract, and CI fails if the committed file differs (drift check). Form-engine forms follow
the same idea: one `core` validates in the browser and the API.

## 9. Messages (i18n)

* **Ownership.** Each slice owns its strings in `messages/{am,en,wal-Latn}.json`, exported as `./messages/*`. The shell
  owns `apps/web/messages`.
* **Key format:** `<owner>.<area>.<key>`, where the owner is the slice key, `shell` or `common`. Examples:
  `competency.nav.applications`, `competency.action.newLicence`, `competency.errors.licence_expired`,
  `kernel.errors.forbidden`.
* **Merging.** At build, `src/i18n` merges the catalogues of the installed slices, and a key under another owner's prefix,
  or a duplicate key, fails the merge.
* **Checking.** `pnpm i18n:check` walks every catalogue: keys are required in `am` and `en`, and `wal-Latn` gaps are
  reported.
* **API error titles.** The API resolves them from the same catalogues.
* **Translators** receive one merged export per language, and the import splits it back (i18n-and-languages.md).

## 10. Tooling

* **Turborepo tasks:** `lint`, `typecheck`, `test`, `test:int`, `build`, `e2e`, with caching keyed on inputs. Root
  scripts: `pnpm boundaries` (dependency-cruiser), `pnpm openapi`, `pnpm gen:routes`, `pnpm i18n:check`,
  `pnpm licences:report`, `pnpm demo:reset`.
* **Generators** (`turbo gen`, `turbo/generators/config.ts`):
  * `module <key>` copies `modules/_template` and registers the slice in both composition roots;
  * `feature`, `screen` and `effect` add those parts to an existing slice.

  A new slice is correct by construction: manifest, README, messages in every language, CODEOWNERS entry. A CI check keeps
  every slice's `package.json` uniform (the same `exports` and scripts).
* **Icon map** generated from the manifests (navigation-and-menus.md §7), so only used lucide icons are bundled.
* **Formatting and linting:** Prettier + ESLint 10 (React Compiler rules, `import/no-cycle` inside packages), run in
  pre-commit by **lefthook** together with gitleaks on staged files (tech-stack T39).
* **CODEOWNERS:** one line per folder (`/platform/kernel/` → platform owner, `/modules/competency/` → its team,
  `/packages/ui/` → UI owner, `/apps/api/drizzle/` and `**/api/sql/` → database reviewer).
* `.gitattributes` (`* text=auto eol=lf`), `.nvmrc`, `packageManager` in `package.json`, and Renovate (grouped, weekly).
* **The two-week rule is enforced twice:** Renovate's `minimumReleaseAge` for updates, and pnpm's `minimumReleaseAge`
  (`pnpm-workspace.yaml`) for every resolution, transitive dependencies included. A lockfile entry that is too new fails
  `pnpm install`.

## 11. File naming

All files are kebab-case. React components are exported in PascalCase from kebab-case files.

| Suffix | Meaning |
|---|---|
| `.controller.ts` `.service.ts` `.repository.ts` `.module.ts` | NestJS roles (CLAUDE.md) |
| `.table.ts` | Drizzle tables of one feature |
| `.effect.ts` `.handler.ts` `.processor.ts` | workflow effect, event handler, queue processor |
| `.dto.ts` | Zod schemas of one resource (in `contracts`) |
| `.screen.tsx` `.widget.tsx` | a page or a dashboard widget (Server Component) |
| `.queries.ts` | TanStack Query option factories and mutations |
| `.spec.ts(x)` `.int.spec.ts` `.e2e.ts` | unit, integration (PostgreSQL), Playwright |
| `.stories.tsx` | Storybook stories (in `packages/ui` and slices' components) |

## 12. Where does this go?

| You are adding | Put it in |
|---|---|
| A field type, a formula function or a validation rule | `packages/form-engine/core` (+ a case in `test/cases.json`) |
| A button variant, a control, a page template | `packages/ui` (+ stories, axe, visual baseline) |
| Money, a date or text primitive shared by all | `packages/schemas` |
| Something every module needs at runtime (a new kind of audit, a guard, a setting type) | `platform/kernel` |
| A generic capability with no domain knowledge (a new workflow step type) | the platform service (`platform/workflow`) |
| Master data used by several work processes | a registry in `modules/` |
| A service of one work process (form, workflow, fee, template) | `modules/<key>/seed/services/<code>/`, configuration first; an effect only if needed |
| A screen | `modules/<key>/web/screens` + an entry in `web/routes.ts`, then `pnpm gen:routes` |
| A call to an external system | a port (`@itrms/kernel/ports` if the kernel needs it, else `platform/integrations/<system>`), with a fake and contract tests |
| A cross-module report | a dataset in `platform/reports`, declared by the module |
| A user-visible string | the owning slice's `messages/*.json` (never in a component) |
| A one-off script for the repository | `tools/` |
