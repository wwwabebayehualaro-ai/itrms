# @itrms/api

The API's composition root (code-structure.md §5.1): NestJS 11 on Fastify, bundled per process by Nest's webpack builder
with swc (`webpack.config.cjs`).

| Process | Entry | Bundle | Does |
|---|---|---|---|
| HTTP | `src/main.ts` | `dist/main.cjs` | the API: problem+json errors, Zod validation, `/healthz`, `/readyz`, `/metrics` |
| worker | `src/worker.ts` | `dist/worker.cjs` | the same modules without HTTP; BullMQ consumers from task 0.10 |
| migrate | `src/migrate.ts` | `dist/migrate.cjs` | applies the migrations (task 0.7) |
| (tool) | `src/openapi-cli.ts` | `dist/openapi.cjs` | writes `packages/api-client/openapi.json` (`pnpm openapi`) |

The installed slices are listed in `src/slices.ts`. At startup `loadSlices` checks their manifests against each other
(dependencies, permissions, roles, effects, event schemas) and stops with a message naming each module and problem.
`MODULES_DISABLED` switches installed modules off.

The database: `DATABASE_URL` (role `itrms_app`) for the HTTP and worker processes, `DATABASE_MIGRATE_URL` (role
`itrms_owner`) for migrate. The roles come from `platform/kernel/api/db/sql/roles.psql`, run by a superuser first (`pnpm
dev:infra` does it for the dev stack). One migration history for the installation lives in `drizzle/`, generated from
every slice's `*.table.ts` (`drizzle.config.ts`), with hand-written SQL for triggers, grants and policies.

Each process reads only its own configuration (`@itrms/kernel/config`) and stops at startup when it is wrong. The HTTP
process refuses `DATABASE_SYSTEM_URL`, `DATABASE_MIGRATE_URL` and `DOCUMENT_SIGNING_KEY`; every process refuses libpq's
`PG*` variables. Behind Nginx, set `TRUSTED_PROXIES` (addresses or CIDR ranges): only those peers may supply the client
address (X-Forwarded-For) and the request id (X-Request-Id).

```bash
pnpm --filter @itrms/api build          # dist/*.cjs
pnpm --filter @itrms/api db:generate    # a migration from changed *.table.ts files (review the SQL, commit it)
pnpm --filter @itrms/api test:int       # migrations from zero + database helpers on PostgreSQL in Testcontainers (Docker)
pnpm --filter @itrms/api start          # HTTP on HOST:PORT (default 127.0.0.1:4000)
pnpm --filter @itrms/api start:worker
pnpm --filter @itrms/api migrate
```

The bundle keeps npm packages external: add every npm dependency of a bundled workspace package here as well
(`src/externals.spec.ts` checks it).
