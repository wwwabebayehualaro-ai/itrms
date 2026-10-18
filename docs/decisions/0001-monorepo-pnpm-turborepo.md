# ADR 0001: Monorepo with pnpm workspaces and Turborepo

* Status: accepted (2026-10-17, fixed by the product owner)

## Context
The copied project has two independent apps (Next.js + FastAPI) and no shared build. The form engine's validation must run
in both the browser and the API, and the DTOs should have one source of truth. npm 10's resolver also crashed on this
project (the `edgesOut` bug), which forced `npx npm@11` workarounds.

## Decision
One repository with **pnpm workspaces** and **Turborepo**: `apps/web`, `apps/api`, `packages/forms`, `packages/ui`,
`packages/schemas`, `packages/ethiopian-calendar`, plus an internal `packages/config`. Internal packages are consumed as
TypeScript source (`"exports"` points to `src`), so only the apps have a build. `turbo run build lint typecheck test` runs
with remote caching off (no external service).

## Consequences
* One lockfile and one Node version (`.nvmrc` and the `packageManager` field with corepack). Package `exports` and ESLint
  enforce the dependency boundaries.
* CI runs only the packages a change affects (`turbo --filter=...[origin/main]`).

## Licences
pnpm: MIT. Turborepo: MIT. Turborepo's remote cache (Vercel) is not used, so no account is needed.
