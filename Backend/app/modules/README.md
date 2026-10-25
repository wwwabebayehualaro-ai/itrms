# Feature modules (coded path)

One folder per business capability that is written as code: complex, stateful or financially sensitive work that does not fit
the Form Builder (see `features/README.md` for how to classify a feature). Simple data-capture forms are built with the Form
Builder instead and need no module.

```
modules/<feature>/
  routers/    secure_router() endpoints; permissions.register(...) once per resource
  services/   CrudService subclasses: business rules and transactions
  schemas/    Pydantic request/response models
  models/     EntityBase models (tenant, audit, soft delete, versioning are automatic)
```

Rules:
* Build only on `app.foundation` (errors, security, db, audit, approval, numbering, idempotency, ...). Never reimplement a
  cross-cutting concern; if the platform lacks something, add it to the foundation (platform team review).
* A module may use another module's public services/models; the foundation never imports a module.
* New models are imported in `app/models.py`; every new table gets `enable_rls_sql(...)` in its migration.

Current modules: `files` (uploads, `/files`). The forms (templates, submissions, query, export, saved views) moved to the
forms API, `@itrms/forms` (task 0.16c).
