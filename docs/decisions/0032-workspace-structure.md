# ADR 0032: Workspace structure: platform slices as packages, thin apps, a separate verify app

* Status: accepted (2026-10-18). It **amends ADR-0027** (where the kernel and the platform services live), ADR-0001 and
  ADR-0002 (folders), and tech-stack T25a (the API build). It changes the repository layout in CLAUDE.md and
  architecture §2. A design review the same day found six structural defects in the first draft; they are fixed here
  (items 3, 4, 6, 9, 10, 11).

## Context
ADR-0027 made each domain module a workspace package (`modules/<key>`), but left the kernel and the platform services inside
`apps/api/src/platform`. A module's `api` entry needs `db.scoped`, `@Require`, `AppError`, the audited write helpers and
the effect registry. If those live inside `apps/api`, a module package must import from the app that imports it. That is
a cycle, and it can't be type-checked or tested on its own.

The same cycle appears in four other places:
* between the platform services (service versions point at workflow definitions, cases point at service versions);
* from the kernel to the adapters it needs (SMS, Keycloak admin, S3, ClamAV);
* from a module's screens to the web app (session-bound API fetcher, active unit, drafts);
* from the test kit to the kernel.

The package name `@itrms/forms` was also claimed twice: by the form engine and by the forms platform service.

## Decision
1. **The kernel and the platform services are slice packages** in a new top-level folder `platform/`, with the same
   shape as modules (`contracts`, `api`, `web`, `messages`, `seed`, `test`, manifest).
2. **`apps/api` and `apps/web` are thin composition roots.** Nothing imports an app. `apps/api` keeps the entry points
   (`main`, `worker`, `worker-documents`, `migrate`), the port bindings and the single migration history.
3. **Platform order:** kernel → integrations → forms → fees → documents → workflow → services → reports.
   * `workflow` runs cases on a frozen configuration that it is given.
   * `services` resolves a service's configuration, freezes it and starts the case.
   * References up the order are plain ids, never foreign keys.
4. **The kernel owns:**
   * the **ports** it needs (`SmsGateway`, `EmailSender`, `IdentityAdmin`, `ObjectStore`, `Antivirus`); their adapters and
     fakes are in `platform/integrations`;
   * the **settings registry and the one resolver**;
   * the **effect registry and its types**;
   * the **isolation-matrix generator**;
   * a **web runtime** (`@itrms/kernel/runtime/server`, `/client`) whose implementations the web app provides.
5. **The folders are the layers:** `packages/` → `platform/` → `modules/` (registries, then work processes).
   dependency-cruiser enforces the rules in [code-structure.md](../platform/code-structure.md) §3.
6. **The system database pool** is exported only from `@itrms/kernel/db/system` and may be imported only by worker code.
   Each process validates its own configuration, and the HTTP process refuses to start with system credentials. Effects
   run as `itrms_app`; work outside the actor's scope goes through an audited `SECURITY DEFINER` command.
7. **The form engine is renamed `packages/form-engine`** (`@itrms/form-engine`). `@itrms/forms` is the forms platform
   service.
8. **New packages:**
   * `packages/module-sdk`: the manifest schema and the slot types;
   * `packages/api-client`: `openapi.json`, the generated types and the typed client. It replaces
     `packages/schemas/openapi.json`;
   * `packages/testing`: factories, fixed clock, Testcontainers.
9. **`apps/verify`** is a static Next.js export on `verify.<domain>`, with no session and no BFF.
   * Nginx proxies exactly one public API path there and denies everything else.
   * The CSP is hash-based.
   * The app may import only `ui`, `schemas`, `ethiopian-calendar`, `api-client` and `@itrms/documents/contracts`.
10. **Build:** internal packages are TypeScript source. The API is bundled by Nest's webpack builder with `swc-loader`
    (workspace packages bundled in; decorator metadata on). Next.js uses `transpilePackages`, and Vitest uses
    `unplugin-swc`. `nest build -b swc` alone cannot compile workspace packages.
11. **Web:**
    * route files and one availability `layout.tsx` per module segment are generated from each slice's `web/routes.ts`
      (`pnpm gen:routes`, checked in CI), with literal segment config;
    * the BFF proxy rebuilds the target under `/api/v1/` only and forwards allow-listed headers;
    * the session is checked in handlers and layouts, not only in `proxy.ts`;
    * the language is not part of the URL.
12. **Slices own their messages:** `<slice>/messages/{am,en,wal-Latn}.json`, keys `<owner>.<area>.<key>`, merged at build.
    A duplicate or a foreign-prefixed key fails the merge.
13. **Events are versioned:** `<entity>.<happened>.v<n>`. A breaking change publishes both versions for at least one
    release.
14. **Tooling:** `turbo gen` generators, **nuqs** for typed URL state (tech-stack T38), and **lefthook** pre-commit (T39).

## Consequences
* Every slice can be type-checked, linted and tested alone, and Turborepo caches per slice.
* The phase tasks change:
  * 0.2 creates `platform/`, the new packages, the generators and the boundary rules (including the platform order and the
    system-pool rule);
  * 0.5 moves the engine to `packages/form-engine`;
  * 0.6 builds `platform/kernel` with per-process config and the bundled API;
  * 0.13 merges slice catalogues;
  * 0.19 splits case start (`services`) from the engine (`workflow`);
  * 0.23 creates `apps/verify` with its Nginx rules.
* There are more `package.json` files to keep consistent. The module generator and a CI check keep them uniform.
* The links that are plain ids, not foreign keys (§3 of code-structure.md), need integration tests that the rows agree.
* Documents that named `apps/api/src/platform/…`, `packages/forms` or `packages/schemas/openapi.json` were updated in the
  same change.
