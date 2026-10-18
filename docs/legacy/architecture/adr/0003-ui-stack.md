# ADR 0003: Frontend UI stack

* Status: accepted (2026-10-15)
* Context: PrimeReact 10 (the repo's version) has been superseded by PrimeReact 11, a rewrite with new packages
  (`@primereact/core`, `@primereact/headless`). Staying on 10 means falling behind; moving to 11 is a migration either way.
  The Teller Portal Architecture Strategy recommends Next.js + Tailwind + shadcn/ui + Radix, TanStack Table/Query, a schema
  validator, OpenAPI-generated types and Vitest/Playwright. The foundation is meant to be reused by other systems (an ERP next).

## Decision
* **Design system owned in the repo**: shadcn/ui components (copied source, not a dependency) on **Radix** primitives,
  **Tailwind CSS 4**, **lucide** icons, exposed only through `@platform/ui`. Features never import a vendor UI library, so the
  vendor underneath can change without touching features.
* **Forms**: **TanStack Form + Zod 4** for hand-written forms (`useZodForm`), consistent with TanStack Query/Table already used;
  builder-made forms keep using the form engine.
* **Next.js 16**, **ESLint 9 flat config**, **TypeScript 5.9**.
* **Contract**: frontend types generated from the backend OpenAPI document (`contracts/openapi.json`, `openapi-typescript`),
  with a drift check on both sides.
* **Tests**: Vitest + Testing Library (unit), Playwright (e2e).
* Migration is staged (A-D, see `../ui-migration.md`): PrimeReact and the design system coexist, isolated by the `tw:` prefix and
  the absence of Preflight, until the form engine's renderers are migrated.

## Alternatives considered
* **PrimeReact 11**: smallest change, but keeps a vendor's component API inside every feature and the field catalogue, and
  diverges from the recommended stack.
* **Switch everything to shadcn now**: one library at the end, but the form engine, builder, field catalogue and saved
  templates would all change at once; high risk of breaking the product.

## Consequences
* Two UI libraries are loaded until stage D (bundle size, two visual idioms in transition).
* New screens are built only with the design system; the lint backlog shows what is left to migrate.
* Stage C needs a data migration of saved templates.
