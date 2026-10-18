# Capability catalog

Everything a feature gets from the platform. **If it is listed here, use it; do not build another one.** Owner of every row:
platform team (`.github/CODEOWNERS`). Status: ✅ available · 🧪 available, first users wanted · ⏳ planned.

## Backend (`Backend/app/foundation`)
| Capability | Entry point | Status |
|---|---|---|
| Configuration | `foundation.config.get_settings()` (typed, fails at startup when misconfigured) | ✅ |
| Error model (RFC 9457 problem+json) | raise `foundation.errors.*` (`NotFound`, `Conflict`, `Forbidden`, `ValidationFailed`, ...) | ✅ |
| Authentication | JWT + rotating refresh (`foundation/auth`), `secure_router()` = default deny | ✅ |
| Authorization | `permissions.register(...)`, `Depends(require("res:action"))`, roles, sensitive resources | ✅ |
| Multi-tenancy | `EntityBase` + session tenant guard + PostgreSQL RLS (`enable_rls_sql`) | ✅ |
| Audit trail | automatic for `EntityBase` changes; `record_event(...)` for other events; append-only | ✅ |
| Data access | `Repository` / `CrudService` (soft delete, optimistic locking, paging, whitelisted filters) | ✅ |
| JSON query compiler | `foundation.db.json_query.JsonQuery` (filters, search, group, aggregate on JSON data) | ✅ |
| Observability | JSON logs with request/tenant/actor ids, `/metrics`, `/healthz`, `/readyz`, OpenTelemetry | ✅ |
| File storage | `foundation.storage.Storage` (local disk; S3/Azure via the same interface) | ✅ |
| Module registry | `ModuleSpec` (routers, menu, flags, dependencies) in `app/modules/<m>/module.py`; `GET /platform/modules` | ✅ |
| Feature flags | `ModuleSpec.flags` / `flags.register`; `FlagService.is_enabled`; `require_feature(key)`; `/platform/flags` (admin) | ✅ |
| Approvals (maker-checker) | `approval.register_policy(...)`, `ApprovalService.submit(...)`; inbox `/platform/approvals` | ✅ (forms publish, teller transactions) |
| Document numbers | `numbering.register(...)`, `await numbering.next_number(session, key)`; `/platform/sequences` | ✅ (teller transactions) |
| Idempotent commands | `idem: Idempotency = Depends(idempotency())`, `await idem.run(...)` | ✅ (submissions, decisions) |
| API contract | `python -m app.cli export-openapi` → `contracts/openapi.json` (test-enforced) | ✅ |
| Server actions (form + code) | `register_server_action(...)` in `modules/form_submission/services/server_actions.py`; a form names it in `runtime.submit.serverAction`; runs in the request's transaction, locks the request | ✅ (cash form) |
| Integration client (external systems, e.g. WSO2) | one approved adapter per external system under `foundation/integrations/` | ⏳ |
| Background jobs / transactional outbox | | ⏳ |

## Frontend (`Frontend/platform`)
| Capability | Entry point | Status |
|---|---|---|
| HTTP client (auth, refresh, Idempotency-Key) | `@platform/lib/api/client` | ✅ |
| API types | `ApiSchema<'Name'>` from `@platform/lib/api/types` (generated) | ✅ |
| Server state | TanStack Query via `QueryProvider`; keys with `createKeys` | ✅ |
| Notifications / confirmations | `useNotify()`, `confirmAction()` | ✅ |
| Design system primitives | `@platform/ui` (`Button`, `Input`, `Select`, `Dialog`, `Sheet`, `Table`, `Tabs`, `Card`, `Badge`, `Field`, ...) | ✅ |
| Hand-written forms | `useZodForm` + `ZodForm` (TanStack Form + Zod, server field errors mapped) | ✅ |
| Data grid | `DataGrid` (TanStack Table, server-driven) | ✅ (internals move to the DS in stage B) |
| Modules / flags | `useModules()`, `useFeatureFlag()`, `<FeatureGate>` | ✅ |
| Approvals | `useApprovals`, `useApprovalActions`, `<ApprovalInbox>`, `<ApprovalStatusTag>` | ✅ |
| Form engine | `@platform/form-engine` (`FormRenderer`, `PublishedFormRenderer`, `DataViewer`, extension points) | ✅ |
| Form builder | `@platform/form-engine/builder` | ✅ |
| Lookups that validate a field | `behavior.validation.remote` + a GET data source; computed fields fill the details (see `Runtime/README.md`) | ✅ |
| Formatting, download, logging | `@platform/lib/format`, `download`, `logger` | ✅ |

## Platform screens (mount with a one-line page)
`ApprovalInbox` (`/approvals`), `FeatureFlagsAdmin` (`/admin/feature-flags`), `SequencesAdmin` (`/admin/sequences`).
