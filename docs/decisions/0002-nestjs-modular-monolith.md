# ADR 0002: NestJS modular monolith on Fastify; FastAPI retired

* Status: accepted (2026-10-17, fixed)

## Context
The FastAPI backend is well structured, but the form engine is TypeScript. Closing the biggest gap, server-side validation
of submissions, means either porting the engine to Python or running TypeScript on the server. Ten work processes need clear
boundaries, but not separate deployments: there is one regional server and a small team.

## Decision
* **NestJS** with the **Fastify adapter**, as one deployable (`apps/api`) started either as `api` (HTTP) or as `worker`
  (jobs).
* **One NestJS module per work process** (`competency`, `public-transport`, `freight`, `road-safety`, `road-quality`,
  `design-contracts`, `community`, `logistics`, `hr`, `planning`), built on platform modules (`src/platform/*`).
* Validation uses **Zod** schemas from `packages/schemas` through one pipe (not class-validator). OpenAPI is generated from
  the same schemas.
* The FastAPI code is retired, and its designs are ported (`docs/audit.md` §4 and §10).

## Consequences
* `packages/forms/core` runs in the API, so the browser and the server share one validation path.
* Module boundaries are enforced by a lint rule (no deep imports into another module) and a test that lists module imports.
* There are no microservices. A module can still be extracted later, because it talks to others only through exported
  services and events.

## Licences
NestJS, Fastify, Zod and `@nestjs/swagger` are MIT.
