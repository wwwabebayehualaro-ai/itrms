# Foundation (backend platform)

Everything cross-cutting, owned by the platform team and **reusable by other systems** (ADR 0002). Feature modules
(`app/modules/*`) build on it; it never imports them (`tests/test_architecture.py`).

| Package | What it gives a feature |
|---|---|
| `config.py` | typed settings, validated at startup |
| `errors.py` | the error model: raise `NotFound`, `Conflict`, `Forbidden`, `ValidationFailed`, ... → RFC 9457 problem+json |
| `context.py` | request context (request id, tenant, actor, roles); `system_context()`, `as_actor()` for jobs and the CLI |
| `auth/` | users, tenants, login / refresh / logout, people directory |
| `security/` | `secure_router()` (default deny), `require("res:action")`, permission registry and roles, tokens, passwords, rate limit |
| `db/` | `EntityBase` (tenant, audit, soft delete, optimistic locking), `Repository` / `CrudService`, tenant guard, RLS helpers, JSON query compiler, paging |
| `audit/` | append-only audit log; automatic for entities, `record_event()` for anything else |
| `observability/` | JSON logs, metrics, health/readiness, request middleware, OpenTelemetry |
| `storage.py` | file storage interface |
| `api/contract.py` | the OpenAPI contract file (`python -m app.cli export-openapi`) |
| `registry/` | `ModuleSpec` (routers, menu, flags, dependencies), module mounting, feature flags (`/platform/modules`, `/platform/flags`) |
| `approval/` | maker-checker: `register_policy(...)`, `ApprovalService.submit(...)`, inbox and decisions (`/platform/approvals`) |
| `numbering/` | gapless per-tenant document numbers: `register(...)`, `next_number(session, key)` (`/platform/sequences`) |
| `idempotency/` | `Idempotency-Key` guard for commands: `Depends(idempotency())`, `await idem.run(...)` |
| `platform.py` | the foundation's own `ModuleSpec` (its routers and menu entries) |

## Extending without editing
Features never change the foundation to add their own behavior; they register it:

```python
permissions.register("invoice", ["approve"])                                    # authorization
approval.register_policy("invoice.post", title="Post an invoice",               # maker-checker with an effect in code
                         approver_permission="invoice:approve", on_approved=post_invoice)
numbering.register("invoice", title="Invoices", pattern="INV-{yyyy}-{seq:05}", reset="yearly")
SPEC = ModuleSpec(key="billing", title="Billing", kind="coded", routers=(...), nav=(...),
                  flags=(("billing.credit_notes", False, "Credit notes"),))   # module, menu, feature flags
```

## Reusing it in another system
1. Copy `app/foundation/` into the new backend's `app/` package (imports are `app.foundation...`), plus `app/cli.py` for the
   operator commands and the test fixtures in `tests/conftest.py` if useful.
2. Write `app/main.py` like this one: middleware, error handlers, health, auth routers, then
   `registry.register_modules((PLATFORM, *INSTALLED_MODULES))` and `registry.mount(app)`.
3. `app/models.py` imports the foundation's models (users, tenants, refresh tokens, audit, feature flags, approvals, number
   sequences, idempotency records) and the new system's own.
4. Start a fresh Alembic history: one migration creating the foundation's tables with `enable_rls_sql(...)` for the tenant-scoped
   ones and `audit_immutability_sql()` for the audit log (this repository's `0001` also contains its form tables, so do not copy
   it as is).
5. Define the new system's roles in its modules (`permissions.define_role(...)`); the foundation only brings admin/editor/viewer.
