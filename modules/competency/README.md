# @itrms/competency

Driver and vehicle competency: driver licences, bolo inspections and the competency services.

**New vehicle registration (DVC-01, task 1.2b).** Seeded as configuration (`seed/vehicle-services.ts`): the request form
`vehicle-registration` (owners, the vehicle's facts, documents, the fee), the step form `vehicle-national-entry` (the federal
vehicle id, keyed in by staff until a national interface exists), the workflow draft → review → payment → approval →
registration → registered, the fee rule `dvc-01-registration` (demo amounts) and the `vehicle-libre` template. The effects
(`api/registration.effects.ts`, run by `VehicleRegistrationService`) call the vehicle register and the plate stock: check the
chassis at submit (a binding check-digit failure only when the officer confirms it, recorded as a `vinCheck` mismatch), hold a
plate from the handling unit's stock at the lead's approval, give it back on rejection, and at registration make
the vehicle with its first ownership, assign the held (or a named) plate and issue the libre (ADR-0049). Each effect is
idempotent per case. The service needs the `holds_plate_stock` capability of the handling unit.

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
