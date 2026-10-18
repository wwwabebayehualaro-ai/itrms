# ADR 0001: Hybrid feature delivery (Option 3) as the path to a contract-based platform (Option 4)

* Status: accepted (2026-10-15)
* Source: Teller Portal Feature Delivery & Architecture Strategy (Options 1–4, §20 backup recommendation, §21 decision)

## Context
Many teams will build features on this codebase (an ERP is next). Option 1 (manual features on shared packages) depends on every
developer finding and reusing platform capabilities; Option 2 (everything as DB-driven JSON forms) cannot express complex or
financial behavior; Option 4 (versioned feature contract + compiler) is the target but needs a platform team and tooling that do
not exist yet. The codebase already has a strong form builder/engine and a backend platform layer.

## Decision
Adopt **Option 3**: complex, stateful, financial or integrated features are **written as code** in feature modules; simple,
standard data capture is **built with the Form Builder** and rendered by the Form Engine. Both use one shared platform for
authentication, authorization, validation, errors, audit, observability, approvals, numbering, idempotency and the API client.

Concretely:
* Backend `app/modules/<feature>/` (feature modules, each with a `ModuleSpec`) on `app/foundation/` (platform).
* Frontend route groups `(coded)`, `(forms)`, `(platform)` on `Frontend/platform` (`ui`, `lib`, `form-engine`).
* `features/<id>/feature.yaml` records each feature's path, owner and wiring; classification happens in design review.
* Builder forms are versioned and published; publishing can require maker-checker approval (`forms.require_approval`).
* The API contract is generated and checked (`contracts/openapi.json`) to limit frontend/backend drift — the main weakness of
  Option 3 named in the strategy.

## Consequences
* Two development paths; teams must classify features (checklist in `features/README.md`).
* Lifecycle coordination stays partly manual until `feature.yaml` is validated by tooling (Option 4 step 1).
* The platform must stay ahead of the features: anything a feature would otherwise reimplement goes into the platform first.
