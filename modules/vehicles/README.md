# @itrms/vehicles

The regional vehicle register: vehicles (federal id, chassis, engine, category, use), their ownership periods and holders, plate
history and libres; search by plate (current or old), chassis, engine or federal id from any office of the region; the
registry commands the case effects call; the `vehicle` lookup provider.

Layer: registry. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module of the HTTP side (server only) |
| `./api/worker` | jobs and event handlers, loaded only by the worker processes |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `vehicles.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
