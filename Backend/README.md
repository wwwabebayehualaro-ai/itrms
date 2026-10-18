# Backend

FastAPI + async SQLAlchemy on PostgreSQL. A **platform layer** (`app/foundation`) provides everything cross-cutting so
feature teams only write business logic.

```
Backend/
  app/foundation/          PLATFORM (owned by the platform team; portable, never imports app.modules)
  app/foundation/auth/     users, tenants, login/refresh/logout
  app/modules/<feature>/   CODED FEATURE MODULES (owned by feature teams): routers/ services/ schemas/ models/
  app/models.py            imports every model (Alembic, create_all, tests)
  alembic/                 migrations           tests/   pytest suite
```

## Run

```bash
pip install -r requirements.txt            # dev: requirements-dev.txt   optional tracing: requirements-otel.txt
cp .env.example app/.env                    # never commit it; JWT_SECRET is mandatory outside development
alembic upgrade head
python -m app.cli create-tenant --name Acme --slug acme --admin-email admin@acme.com   # ADMIN_PASSWORD env or prompt
uvicorn app.main:app --reload               # run from Backend/
pytest                                      # SQLite;  TEST_DATABASE_URL=postgresql+asyncpg://... adds RLS/migration tests
```

## What the platform gives you for free

| Concern | What happens without any feature code |
|---|---|
| **Errors** | Raise `NotFound`, `Conflict`, `BadRequest`, `Forbidden`… (`foundation.errors`). Every failure - including validation, DB integrity, stale writes and crashes - becomes RFC 9457 `application/problem+json` with `code` and `trace_id`. No internals leak. **Never** write `try/except Exception` or raise `HTTPException` in features. |
| **AuthN** | `secure_router()` requires a valid bearer token on every route (default deny). Tokens: 15 min access JWT, rotating single-use refresh with reuse detection, argon2id passwords, lockout, rate-limited login. |
| **AuthZ** | `Depends(require("invoice:approve"))`. Register resources with `permissions.register(...)`, roles with `permissions.define_role(...)`. Denials are audited. `register(..., sensitive=True)` keeps a resource out of `*:action` wildcard grants. |
| **Multi-tenancy** | Every `EntityBase` row has `tenant_id`, stamped on insert and filtered on **every** query/update/delete by a session hook (fail-closed), plus PostgreSQL RLS. Cross-tenant ids simply 404. |
| **Audit** | Create/update/delete of any `EntityBase` model is written to `audit_logs` in the same transaction: actor, tenant, request id, IP, field-level diff, secrets redacted. Append-only (ORM guard + DB trigger). Custom events: `record_event(...)`. |
| **Data** | Soft delete, optimistic locking (`row_version` -> 409), created/updated timestamps and actors, generic `Repository`/`CrudService`, `Page` pagination, whitelisted filter/sort. |
| **Observability** | JSON logs with request/tenant/actor ids and secret masking, `X-Request-ID` propagation, Prometheus `/metrics`, `/healthz`, `/readyz`, optional OpenTelemetry (`OTLP_ENDPOINT`), security headers, body-size limit. |
| **Config** | One typed `Settings`; fails at startup when misconfigured. |
| **Files** | `Storage` abstraction, size/type/signature validation, safe names, atomic writes. |
| **Modules & flags** | A module describes itself once (`ModuleSpec`: routers, menu, flags, dependencies); the registry mounts it, guards its routes with the tenant's flag (`404 feature_disabled` when off) and serves the menu (`GET /platform/modules`). Admins switch flags at `/platform/flags`. |
| **Approvals** | Maker-checker: `approval.register_policy(...)` declares who decides and what happens (code, in the decision's transaction); `ApprovalService.submit(...)` opens a request; the maker can never decide it. Inbox: `/platform/approvals`. |
| **Document numbers** | `numbering.register("invoice", pattern="INV-{yyyy}-{seq:05}", reset="yearly")`, `await numbering.next_number(session, "invoice")`: per tenant, gapless, race-free. |
| **Idempotency** | `idem: Idempotency = Depends(idempotency())` + `await idem.run(...)`: a retried command with the same `Idempotency-Key` returns the first result. The frontend client sends a key with every POST. |
| **API contract** | `python -m app.cli export-openapi` writes `../contracts/openapi.json`; a test fails when it is stale (the frontend generates its types from it). |

## Add a feature (the whole thing)

```python
# modules/billing/models/Invoice.py
class Invoice(EntityBase):                      # tenant, audit, soft delete, versioning: automatic
    __tablename__ = "invoices"
    number: Mapped[str] = mapped_column(String(50))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))

# modules/billing/services/invoice_service.py
class InvoiceRepository(Repository[Invoice]):
    model = Invoice
    filterable = frozenset({"number"})
class InvoiceService(CrudService[Invoice]):
    repository_class = InvoiceRepository
    async def approve(self, id):                # business rule only
        async with self.transaction():
            inv = await self.repo.get(id, for_update=True)
            if inv.total > 10_000: raise Conflict("Needs director approval")
            await self.repo.update(inv, {"status": "approved"})

# modules/billing/routers/invoice_router.py
permissions.register("invoice", ["approve"])
router = secure_router(prefix="/invoices")
@router.post("/{id}/approve", dependencies=[Depends(require("invoice:approve"))])
async def approve(id: UUID, svc: InvoiceService = Depends(get_invoice_service)): return await svc.approve(id)

# modules/billing/module.py: what the registry mounts and shows
SPEC = ModuleSpec(key="billing", title="Billing", kind="coded", routers=(RouterMount(invoice_router.router, prefix="/billing"),),
                  nav=(NavGroup("Billing", items=(NavItem("Invoices", route="/invoices", permission="invoice:read"),)),))
```

Then add `SPEC` to `INSTALLED_MODULES` (`app/modules/__init__.py`), import the model in `app/models.py`,
`alembic revision --autogenerate -m "invoices"` and enable row-level security for the new table in that migration with
`foundation.db.rls.enable_rls_sql("invoices")`. Approvals, numbers and idempotency: see the table above and
`app/foundation/README.md`. Decide first whether the feature should be code at all (`../features/README.md`).

## Submitted data: query, record, views, export (`modules/form_submission`)
* `POST /form/submissions/query` filters / searches / sorts / pages / groups (two dimensions) / aggregates / facets the submissions of one form;
  `GET /form/submissions/query/schema` says what is possible (fields, operators, roles, view modes). `foundation/db/json_query.py` is the generic, allow-listed JSON query compiler
  (PostgreSQL JSONB and SQLite); `modules/form_submission/services/submission_fields.py` maps builder field types to query kinds. 200k rows answer in < 170 ms on PostgreSQL.
* A submission records the **form version** it was filled in on (`template_versions`, one row per distinct content). `GET /form/submissions/{id}/form` returns it (+ `current`), `GET .../history` the audit trail with per-field changes.
* Requests are taken on the **published** version of a form (`409 form_not_published` before the first publish). Without the flag
  `forms.require_approval` every save publishes at once; with it, `POST /template/forms/templates/{id}/publish` asks for approval
  (policy `template.publish`, permission `template:approve`) and the approval publishes the requested version.
* `/form/views`: saved views (private; shared and default need `template:update`). `POST /form/submissions/export`: CSV with names and labels, needs `submission:export` (admin, editor), audited, max 50,000 rows, formula-injection safe.
* Not yet: field-level masking (per-role hiding of fields in query/export/history) and push updates (the viewer polls when "Live" is on).

## Rules for feature code
1. Use `Repository`/`CrudService`; never open your own engine/session or build tenant filters by hand.
2. Raise `AppError` subclasses; never catch-all.
3. Never log or return secrets; log with `logging.getLogger(__name__)` (request context is added for you).
4. Use `system_context()` only for platform code that must cross tenants (authentication, jobs) - reviewed by the platform team.
5. Connect the app as a non-superuser role so PostgreSQL RLS is effective (superusers bypass it).

## Known limits
* The login rate limiter is in-process; use a shared store or the API gateway when running several replicas.
* Audit rows are tamper-*resistant* (DB trigger, no ORM path); for tamper-*evidence* ship them to WORM/SIEM storage.
* Files use local disk; implement `Storage` for S3/Azure for multi-node deployments.
* The migration `0001` adopts an existing pre-platform database (legacy rows go to a `default` tenant) and is not reversible.
