# ADR 0027: Vertical-slice module packages, registries as separate modules, and entitlements

* Status: accepted (2026-10-18). It **refines ADR-0002** (the modular monolith is unchanged) and changes the repository
  layout in CLAUDE.md (`apps/api/src/modules/*` becomes `modules/*`).

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 16.
> **Amended by [ADR-0032](0032-workspace-structure.md)** (2026-10-18): the kernel and platform services are slice packages
> in `platform/*`; the apps are thin composition roots.

## Context
Work processes share master data: vehicles are used by competency, freight, public transport and road safety. Customers
may buy parts of the system. A module's API, screens, contracts, seeds and tests drift apart when they live in different
apps.

## Decision
* **Layers:** kernel → platform services → **registries** (`parties`, `vehicles`, `drivers`, `associations`,
  `road-assets`) → **work-process modules** (the 10). Dependencies only point downward. Sideways communication goes through
  domain events (outbox) or a registry.
* **Each domain module is one workspace package** `modules/<key>` containing `module.ts` (the manifest), `contracts`,
  `api`, `web`, `seed` and `test`. `apps/api` and `apps/web` are composition roots.
* **The manifest** declares dependencies, permissions, roles, services, effects, events, settings, number sequences,
  lookups, menu, widgets, reports, documents and required capabilities. The API validates all manifests at startup.
* **Data:** one PostgreSQL schema per module; one migration history; foreign keys only point downward.
* **Entitlements:** a signed licence file per installation lists the products bought. A module is available only when it
  is entitled, enabled and offered in the active unit.

Details: `docs/platform/modularization.md`.

## Consequences
* The CLAUDE.md layout and boundary rules are updated. dependency-cruiser enforces the layers.
* Task 0.2 creates the `modules/` workspace. Task 0.6 adds the manifest loader. Licence-file checking comes in Phase 1
  (Phase 0 runs with everything entitled).
