# @itrms/kernel

Kernel: config, errors, context, db, iam, org, settings, audit, numbering, idempotency, outbox, jobs, effects, files, i18n, notifications, search, ports, observability and the web runtime

Layer: kernel. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | `KernelModule`, `createHttpApp` / `createWorkerContext`, `loadSlices` (the manifest checks at startup), logger, metrics, health (server only) |
| `./config` | the per-process config schemas and `loadConfig` (fails at startup; `http` refuses the system pool) |
| `./db` | `createDatabase` and `scoped(ctx, tx => …)`, the base columns, `audited()` / `notAudited()`, the audited write helpers (insert, update, delete with `row_version`; `recordEvent`), the `audit_log` table, `ROLES_SQL` |
| `./errors` | the `AppError` hierarchy and the problem+json filter |
| `./context` | the request context (AsyncLocalStorage: request id, language, user, unit) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `kernel.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
| `./files` | uploaded files: the `ObjectStore` port, the `files` table, `linkFile` / `getFile` for other slices |

## Files (task 0.15, architecture §14)

Endpoints (`/api/v1/files`): `POST` begins an upload (`file:upload`) and answers a presigned POST, or part URLs above
16 MiB; `POST :id/confirm` checks and stores it (`file:upload`, only who uploaded it); `GET :id` and `GET :id/download`
(`file:read`, the uploading unit's subtree under RLS) answer the file and a short download URL.

* An upload goes to `quarantine/`. Confirming claims it (`checking`), copies it to `files/`, and checks the copy: size,
  magic bytes against the declared type, SHA-256. Then it is `stored`, or `rejected` and removed.
* A record's service calls `linkFile(tx, id, { table, id, documentType })` in its own transaction. A file belongs to one
  record, and a linked file no longer expires.
* Limits per person: 20 files or 200 MiB waiting, 1 GiB a day; at most 50 MiB a file.
* The worker's hourly purge (`jobs/files-purge.ts`) expires uploads not confirmed in 24 hours and stored files no record
  linked in a week, then removes their objects and quarantine leftovers.
* `S3ObjectStore` (`@itrms/integrations`) implements the port; the S3 contract suite proves what it relies on.
