# ADR 0002: The backend foundation is portable

* Status: accepted (2026-10-15)

## Context
The backend platform (`Backend/app/foundation`) will be reused by other systems built by the same organization. Product code
leaking into it (imports of feature modules, product menus, product roles) would make every reuse a fork.

## Decision
* `app/foundation` never imports `app.modules` or `app.main` — enforced by `tests/test_architecture.py`.
* An application = foundation + `ModuleSpec`s. The foundation's own endpoints and screens are the `PLATFORM` spec
  (`foundation/platform.py`); product modules register theirs in `app/modules/__init__.py` (`INSTALLED_MODULES`).
* Extension happens through registries, not edits: permissions (`permissions.register`), approval policies
  (`approval.register_policy`), document sequences (`numbering.register`), feature flags (`ModuleSpec.flags`).
* The name stays `foundation` (not `platform`): a package named `platform` would shadow Python's standard library module
  whenever `app/` is on `sys.path`.

## Consequences
* Reusing the foundation = copy `app/foundation/`, start the new system's Alembic history with one migration for the foundation's
  tables (this repository's 0001 also contains its form tables), and write a `main.py` that registers the application's modules
  (see `Backend/app/foundation/README.md`).
* Product roles live in the application: the foundation defines only admin/editor/viewer; `submitter` is defined by the
  `form_submission` module.
