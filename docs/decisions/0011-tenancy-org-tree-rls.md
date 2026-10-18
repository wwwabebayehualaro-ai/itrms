# ADR 0011: Org-unit tree tenancy, enforced by guards and PostgreSQL RLS

* Status: accepted (2026-10-17, fixed)

## Context
Customers are bureaus with zones, woredas, special woredas, city administrations with sub-cities, and graded towns. The
depth and level names differ per region. Users must see their own unit and everything below it. The legacy system only
isolated flat tenants.

## Decision
* **One database, shared schema.** `org_units` form a tree per region (an `ltree` path). `org_level_definitions` set the
  depth and level names per region; the default is region > zone > woreda. Units carry a `category` (woreda category, town
  grade).
* Every tenant table has `region_id`. Local transaction tables also have `handling_unit_id` and a denormalised `org_path`.
* Four policy shapes match four table classes (details in `docs/architecture.md` §5):
  * regional registry: readable across the region; writable only for records the unit handles;
  * local transaction: the unit's subtree;
  * inherited configuration: the subtree plus its ancestors;
  * party-scoped (external participants): their own organisation's rows (ADR-0031).
* Each request runs in a transaction that sets `app.region_id`, `app.scope_path` and `app.user_id` with
  `set_config(..., true)`, read null-safely by the policies. There is **no bypass setting**: system work uses the role
  `itrms_system` (BYPASSRLS) on a separate worker pool (ADR-0031).
* Isolation is **enforced twice**:
  * NestJS guards check role and unit scope before any data access.
  * RLS policies are `TO itrms_app` (the API role, not the owner). Class P (party-scoped) is added for external participants.

## Consequences
* An isolation test matrix (sibling, parent, child and other-region users) for every table class is part of the definition
  of done.
* Moving a unit in the tree is a rare admin operation. It rewrites `org_path` in a migration-like job and is audited.
* Connection pooling must keep settings transaction-local, so no session-level `SET`.
