# @itrms/vehicles

The regional vehicle register: vehicles (federal id, chassis, engine, category, use), their ownership periods and holders, plate
history and libres; search by plate (current or old), chassis, engine or federal id from any office of the region (the status
and owner filters applied inside the ranked search, the owner being the holder of the vehicle's last ownership period, so a
vehicle off the register is found by the owners it left with: task 1.2e); the
registry commands the case effects call; the `vehicle` lookup provider; the stock of national plates (task 1.2a: deliveries,
allocation one level down the tree with acceptance, recalls, write-offs, assignment from an office's own stock through
`VehicleRegistry.assignStockPlate`, counts reconciled with the ledger).

For new registration (task 1.2b): `PlateStock.reserve` / `release` hold one plate of a unit's stock for a case and give it back
(idempotent per case; a held plate counts as `reserved` in the summary); `VehicleRegistry.checkRegistration` (chassis on the
register or in another open case, the check digit where it is binding; `acceptVinMismatch` takes a failure the officer
confirmed, recorded as a mismatch) and `issueLibre` (the libre of a case, with no number of ours).

**The federal booklet (task 1.2d, ADR-0050).** The libre is the ministry's booklet: `recordBooklet` writes its serial as
the libre's number once (the same serial again is nothing to do; another is refused, a new booklet being a replacement), and the
national reference when given. The office counter `vehicles.registration-certificate` (`{unit}/RC/{seq:06}`, renamed from
`vehicles.libre` in migration 0070) numbers the registration certificate. The register also keeps the temporary libre's other
facts: made in, engine HP, cylinders, length, width and height (mm), tyre size and count, net weight.

**Plate exchange (task 1.2c).** A plate period that ends for another points at the period that replaced it
(`plate_assignments.replaced_by_id`, a deferred key on the same vehicle in migration 0072, backfilled for the plates already
exchanged), so an old regional plate is linked to the national plate that replaced it. `recordFederalId` sets the federal
vehicle id of a vehicle already on the register, once. The old plates read: use codes 1–5 and 35 (a local NGO; `35-1234` and
`3-51234` are told apart only by how they are written, run together they are refused), and the special prefixes CD, AU, UN,
police, defence (`መከላከያ`) and special machinery (`ልዩ`); the last two are a stated assumption to confirm with the zone.
`LEGACY_USE_CODES` maps a code to its use. One plate key is one pair (a car's two plates) or one plate (a motorcycle's); the
replacement of one plate of a pair is a replacement case (task 1.5).

**Migrated from paper (task 1.13, ADR-0054).** `register` takes a `migration` (source `back_capture` or `import`, the paper
file's reference, the capturing case, the verifier) and checks it in back-capture mode: seats, load and axles the file does not
give may stay missing, and a check digit that does not match is kept as a mismatch. The migration's columns (migration 0071) are
written once at insert: the application has no UPDATE grant on them, and a check makes a back-capture name its case and verifier.
Every view marks a migrated vehicle: the summary's `migration` (search, record, lookups), the lookup's `migrated` fact, the
record's paper reference linking to the capture case that holds the scan.

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
