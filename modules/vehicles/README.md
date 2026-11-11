# @itrms/vehicles

The regional vehicle register: vehicles (federal id, chassis, engine, category, use), their ownership periods and holders, plate
history and libres; search by plate (current or old), chassis, engine or federal id from any office of the region; the
registry commands the case effects call; the `vehicle` lookup provider; the stock of national plates (task 1.2a: deliveries,
allocation one level down the tree with acceptance, recalls, write-offs, assignment from an office's own stock through
`VehicleRegistry.assignStockPlate`, counts reconciled with the ledger).

For new registration (task 1.2b): `PlateStock.reserve` / `release` hold one plate of a unit's stock for a case and give it back
(idempotent per case; a held plate counts as `reserved` in the summary); `VehicleRegistry.checkRegistration` (chassis on the
register or in another open case, the check digit where it is binding; `acceptVinMismatch` takes a failure the officer
confirmed, recorded as a mismatch) and `issueLibre`, numbered from
the office's counter `vehicles.libre` as `{unit}/LB/{seq:06}` until the national system numbers libres (ADR-0049).

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
