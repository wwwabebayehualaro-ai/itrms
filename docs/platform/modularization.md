# Modularization

How ITRMS is cut into modules so that 10 work processes, 54 services and several customers can grow without becoming one
tangled codebase. Decision: [ADR-0027](../decisions/0027-vertical-slice-modules-and-entitlements.md). It refines ADR-0002
(modular monolith); the monolith and its deployment shape are unchanged.

## 1. What exists today (legacy)
* **Backend:** `ModuleSpec` (key, routers, menu, flags, dependencies) per module, `INSTALLED_MODULES`, per-tenant module
  flags (`module.<key>`), and a foundation that never imports modules (architecture test). This is a good pattern, so it is
  **kept and ported**.
* **Frontend:** route groups `(coded)`, `(forms)`, `(platform)`. Modules have no frontend manifest; the menu comes from the
  backend `ModuleSpec.nav`; icons are a hand-kept map.
* **Missing for an ERP:**
  * vertical ownership (a module's API, screens, contracts and tests in one place);
  * public module APIs and domain events;
  * licensable modules per customer;
  * modules aware of unit types.

## 2. Module taxonomy

| Layer | Modules | Rule |
|---|---|---|
| **Kernel** (always on) | `org` (tree, unit types, settings), `iam` (Keycloak integration, roles, permissions), `audit`, `i18n`, `files`, `numbering`, `outbox/jobs`, `notifications`, `search` | No business logic. Every other module may use it |
| **Platform services** | `forms` (definitions, submissions, query), `workflow` (cases, tasks, SLA), `fees` (rules, payment orders, payments, receipts, cashier), `documents` (templates, PDF, verification), `reports` (datasets, dashboards, exports), `integrations` (adapters) | Generic. They know nothing about vehicles or roads; domain modules plug in through extension points |
| **Registries** (master data) | `parties` (persons, organisations), `vehicles` (vehicles, plates, libres, ownership), `drivers` (licences, grades, medical certificates, training), `associations` (mahber, members, vehicles), `road-assets` (roads, projects, contracts, unit rates) | One owner per kind of master record; regional (ADR-0013). Others read through lookup providers and public queries |
| **Work-process modules** | `competency`, `public-transport`, `freight`, `road-safety`, `road-quality`, `design-contracts`, `community`, `logistics`, `hr`, `planning` | Own their services (configuration + effects), screens, reports and transactional tables |

Why registries are separate from work processes: vehicles are touched by competency (registration, bolo), freight
(certificates), public transport (association vehicles) and road safety (accidents, fines). If `competency` owned
vehicles, every other module would depend on it, and it would become a "god module".

Allowed dependencies (enforced): work process → registries → platform services → kernel. Never upward, never sideways
between work-process modules. Sideways needs go through **events** or a registry.

## 3. Packaging: vertical slices
Each domain module is **one workspace package** that holds everything about it:

```
modules/competency/
  module.ts                 the manifest (below), imported by both apps
  contracts/                Zod schemas, DTOs, event payloads, permission keys: the module's public API
  api/                      NestJS module: controllers, services, repositories, effects, event handlers, Drizzle tables
  web/                      screens, components, hooks, menu items, dashboard widgets, record views
  seed/                     service definitions (forms, workflows, fee rules, templates), unit-type defaults, demo data
  test/                     unit, integration (Postgres) and e2e specs of this module
  package.json              exports: ./contracts, ./api, ./web, ./manifest
```

* `apps/api` and `apps/web` are **composition roots**: they import the enabled modules' `api` / `web` entry points and
  register them. Next.js route files in `apps/web/app/(workspace)/<module>/…` are one-line re-exports of the module's
  screens.
* Kernel and platform services stay in `apps/api/src/platform` and `packages/*` (shared across modules).
* Package `exports` make internals unreachable. dependency-cruiser enforces the layer rules. CODEOWNERS assigns each
  module to a team.

## 4. The module manifest (one per module, shared by API and web)

```ts
export default defineModule({
  key: 'competency',
  version: '1.0.0',
  title: { am: 'የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ', en: 'Driver & vehicle competency', 'wal-Latn': '…' },
  workProcess: 1,
  dependsOn: ['parties', 'vehicles', 'drivers', 'fees', 'workflow', 'documents'],
  entitlement: 'itrms.licensing',            // the licensable product it belongs to (§6)
  permissions: { licence: ['read', 'review', 'examine', 'approve', 'print'], inspection: ['read', 'perform', 'approve'] },
  roles: { 'competency.officer': [...], 'competency.lead': [...], 'competency.examiner': [...] },
  services: ['DVC-01', …, 'DVC-11'],         // service definitions seeded from ./seed
  effects: ['competency.issueLicence', 'competency.renewLicence', 'competency.addToPrintBatch', …],
  events: { emits: ['licence.issued', 'licence.renewed'], consumes: ['payment.settled', 'vehicle.transferred'] },
  settings: [{ key: 'competency.exam.passMark', schema: z.number(), default: 74, overridableAt: ['region'] }],
  numberSequences: [{ key: 'licence', pattern: '{unit}/{seq:06}/{efy}' }],
  lookups: ['driver-licence'],               // RegistryLookup providers for forms
  menu: [ /* see navigation-and-menus.md */ ],
  widgets: ['competency.openApplications', 'competency.printBatchStatus'],
  reports: ['competency.licencesIssuedByUnit', 'competency.examPassRate'],
  documents: ['licence-certificate', 'exam-result-sheet'],
  capabilitiesRequired: { 'DVC-01': ['prints_documents'], 'DVC-10': ['has_examiners'] },
});
```

At startup the API checks every manifest:
* dependencies are present and enabled;
* permission and role keys are unique;
* the effects named by seeded service versions exist;
* events have schemas.

A failing check stops the start, with a clear message.

## 5. How modules talk to each other
| Need | Mechanism | Example |
|---|---|---|
| Read master data | the registry's **public query service** (DI token from its `contracts`), or a **lookup provider** in forms | competency reads a person from `parties` |
| Change master data | only the registry's **commands**, called from an effect in the same transaction | `competency.issueLicence` calls `drivers.createLicence(tx, …)` |
| React to something that happened elsewhere | **domain event** through the outbox (async, idempotent handler) | `payment.settled` → workflow guard; `vehicle.transferred` → road-safety record update |
| Report across modules | the `reports` module's **datasets** (read-only SQL views owned by `reports`, declared per module) | licences by unit with revenue |
| UI composition | **extension slots** in the shell: record tabs, dashboard widgets, global search providers, quick actions | the person page shows a "Licences" tab contributed by `drivers` |

There are no cross-module table joins in module code. Reports use their own views.

## 6. Entitlements: selling modules
Customers may buy only parts of the system (e.g. licensing first, roads later).
* An installation has a **signed licence file**: customer, region, products (`itrms.core`, `itrms.licensing`,
  `itrms.public-transport`, `itrms.roads`, `itrms.safety`, `itrms.office`), validity and limits (Ed25519 signature checked at
  startup and daily).
* Product → modules mapping:

| Product | Modules |
|---|---|
| `itrms.core` (always) | kernel, platform services, **all registries** (`parties`, `vehicles`, `drivers`, `associations`, `road-assets`) |
| `itrms.licensing` | `competency`, `freight` |
| `itrms.public-transport` | `public-transport` |
| `itrms.safety` | `road-safety` |
| `itrms.roads` | `road-quality`, `design-contracts`, `community`, `logistics` |
| `itrms.office` | `hr`, `planning` |

* Three independent switches decide whether something is available. **All three must be on**:
  1. **Entitled:** the licence file includes the product.
  2. **Enabled:** a module or feature flag is on, set by the installation or the region.
  3. **Offered here:** the service is enabled for the active unit, through its unit type or an override
     ([org-and-unit-types.md](org-and-unit-types.md)).

  The API rejects calls to unavailable modules with 404 `feature_disabled`. The menu hides them.
* Data of a module that is switched off is kept and is read-only for admins. Switching off never deletes.
* **Licence expiry never stops government work mid-day:** 60 days of warnings, then a 30-day grace period, then read-only
  with a banner (no new cases). Renewal is a new signed file. Phase 0 runs with everything entitled, and the file is
  introduced when a customer buys a subset.

## 7. Data ownership
* Each module owns its tables in its own **PostgreSQL schema** (`competency.*`, `vehicles.*`, `platform.*`, …). Ownership is
  therefore visible in the database and in backups. RLS policies work the same in every schema.
* There is one migration history for the installation: one `drizzle.config` lists every module's schema files and writes
  to one migrations folder, in dependency order, and each migration is reviewed. The API is built with `nest build -b swc`, so
  module packages consumed as TypeScript source keep their decorator metadata.
* Foreign keys across modules are allowed only **towards** lower layers (process → registry → kernel).

## 8. Adding a module: definition of done
1. A package under `modules/<key>` with the manifest, contracts, api, web, seed and tests.
2. Depends only on lower layers (dependency-cruiser passes).
3. Tables in its own schema, with RLS policies of the right class and the isolation matrix extended.
4. Permissions and roles declared; menu items, widgets and reports declared with i18n keys in every enabled language.
5. Services seeded as configuration (forms, workflows, fees, templates), with unit-type defaults.
6. Events documented with schemas; handlers idempotent.
7. Mapped to a product in the entitlement table.
8. CODEOWNERS entry; a module README (what it owns, its public API, events).
