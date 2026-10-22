# @itrms/competency

Driver and vehicle competency: driver licences, bolo inspections and the competency services

Layer: work-process. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module of the HTTP side (server only) |
| `./api/worker` | jobs and event handlers, loaded only by the worker processes |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `competency.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
