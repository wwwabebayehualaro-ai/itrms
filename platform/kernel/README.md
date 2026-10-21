# @itrms/kernel

Kernel: config, errors, context, db, iam, org, settings, audit, numbering, idempotency, outbox, jobs, effects, files, i18n, notifications, search, ports, observability and the web runtime

Layer: kernel. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | `KernelModule`, `createHttpApp` / `createWorkerContext`, `loadSlices` (the manifest checks at startup), logger, metrics, health (server only) |
| `./config` | the per-process config schemas and `loadConfig` (fails at startup; `http` refuses the system pool) |
| `./errors` | the `AppError` hierarchy and the problem+json filter |
| `./context` | the request context (AsyncLocalStorage: request id, language, user, unit) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `kernel.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
