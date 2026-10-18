# ADR 0003: PostgreSQL 16 with Drizzle ORM and migrations

* Status: accepted (2026-10-17, fixed)

## Context
Tenant isolation must be enforced in the database (RLS), answers are stored as JSONB, and counters must be transactional.
The team wants typed TypeScript queries that stay close to SQL.

## Decision
* **PostgreSQL 16** with the extensions `ltree`, `pgcrypto`, `btree_gist` and `pg_trgm` (for name search).
* **Drizzle ORM** for schema and queries. **drizzle-kit** generates the SQL migrations, which are reviewed and committed.
  Hand-written SQL migrations for RLS policies, triggers and functions sit next to them.
* Migrations run as the owner role `itrms_owner`. The API connects as `itrms_app` (not the owner, so RLS applies to it). System
  work uses `itrms_system` (BYPASSRLS) on a separate worker pool. FORCE RLS is not set (it would only affect the owner) (ADR-0031).
* All request work runs in a transaction opened by `db.scoped(ctx)`, which sets the RLS settings (ADR-0011).

## Consequences
* There is no ORM magic: every query is visible and typed. Raw `sql` fragments are allowed, because the JSONB query
  compiler needs them.
* CI checks migrations by applying them from zero on a fresh database and then running the RLS isolation tests.

## Licences
* PostgreSQL: PostgreSQL licence.
* Drizzle ORM: Apache-2.0.
* drizzle-kit: verify its licence in task 0.2, because it has a separate licence history.
* Driver: `postgres` (porsager) is under the Unlicense; `pg` is MIT.
