# ADR 0030: Hybrid delivery: the form builder for capture and configuration, code for money, registries and complex work

* Status: accepted (2026-10-18). It makes explicit what ADR-0017 and ADR-0019 imply, and carries over the legacy project's
  ADR 0001 (hybrid feature delivery) in ITRMS terms.

## Context
ITRMS has 54 services. They differ by region, and they change when directives change. Some move money, change registries or
need planning screens. Building everything in the form builder cannot express money, gapless numbers, eligibility law or
consistency checks safely. Building everything in code makes every form change a developer task and a deployment.

## Decision
Every service is delivered one of four ways, plus shared platform capabilities (recorded per service in
`docs/service-catalogue.md`):

| Delivery | Builder (configuration) | Code | Wolaita catalogue |
|---|---|---|---|
| **C** | form, workflow, fee rule, templates | none, service-specific | 11 |
| **C+E** | form, workflow, fee rule, templates | named **effects** with **typed input contracts** that change registries or money, enforce legal rules or call national systems, run in the transition's transaction | 23 |
| **M** | intake and simple step forms | module screens and services (planning, grids, batches, BOQ, certificates, schedules, payroll list, budgets) | 16 |
| **R** | narrative or sign-off form | a report definition over existing data | 3 |
| platform | — | `fees` (shared) | 1 |

(Updated 2026-10-18 after a per-service review: [`docs/platform/delivery-decisions.md`](../platform/delivery-decisions.md).)

Rules:
1. Configuration **names** code (effects, lookups, guards) and never contains code. Publishing fails if a named effect is
   missing.
2. Forms capture; effects copy facts into typed tables (ADR-0019). Reports read typed tables.
3. The same validation runs in the browser and the API (`packages/forms/core`).
4. Classification uses the five ordered questions in `docs/platform/delivery-decisions.md` §2: report → R; many records
   at once → M; money beyond a fee rule → M; registry, legal rule, fee or national system → C+E; otherwise → C.
5. A service may move from C to C+E or M later, and its stored answers remain readable.
6. **Form ↔ effect contracts** (`docs/platform/form-platform.md` §3): every effect declares a typed input contract.
   Contract fields are locked in the builder (key, type, required), and publishing fails when a contract is unmet. So
   bureaus and zones can reshape forms freely without breaking the code behind them.
7. **Form governance:** stable keys, lint, author-defined test cases, impact analysis, maker-checker publish, staged
   preview, rollback by republishing. There are three form tiers: bureau, zone/unit overlay, and unit-local (C only).

## Consequences
* The bureau changes forms, steps, SLAs, fees and templates without developers, within the override policy. Developers
  build effects, registries and M-module screens.
* Each new effect or M screen is reviewed like any code (tests, isolation, audit).
