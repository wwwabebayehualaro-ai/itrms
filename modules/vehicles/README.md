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

## Encumbrances (task 1.4a)

A hold on a vehicle (`vehicles.vehicle_encumbrances`): a bank loan, a court order, a revenue, customs or insurance hold. The holder
is an external body, a `parties.organisations` row (kinds `bank` and `court` exist for this); the office that records the hold acts
for the holder, on the holder's letter (its reference, date and, if wanted, the stored scan). Only that office asks for the release,
citing the holder's release letter; a different person of that office, or of an office above it, confirms (or refuses, with a
reason: the hold stays open). Released is final. Class R at the recording office: the region reads, its line writes; the database
keeps the machine (a transition trigger) and what the letter said never changes.

An `open` or `release_pending` hold blocks the services it conflicts with. A service names the check among its workflow effects,
with the conflict after the colon (`ownership-transfer`, `zone-transfer-out`, `replacement`):

- on filing: `submit` and `correct` carry `vehicles.checkEncumbrances:<conflict>`, so a request is refused up front;
- before the payment order: the transition that creates it names the check first, so nobody pays for what will be refused;
- before the giving effect: the step that gives the result (the new plate, the new owner) names it before that effect, so a hold
  recorded in between still stops it. A check and a recording meet on one advisory lock per vehicle: a hold either commits before
  the check (and blocks) or after the service has given, never both. A giving effect that needs it says so
  (`requiresBefore`, task 1.4b2): the ownership transfer requires `vehicles.checkEncumbrances:ownership-transfer` on its giving
  transition, and a version without it, or with a conflict the check does not take, is not published.

The refusal is a 422 `not_eligible` naming the oldest hold, its holder and office, in the language of the person acting. Which
kinds block which conflict is the setting `vehicles.encumbrance_blocks` (installation or region; shipped: transfers are blocked by
every kind, a replacement by a bank loan or a court order). A conflict the setting does not know is a 409 `not_configured`. Open
holds show on the vehicle's summary (search, record, lookup fact `encumbrances`) and as a banner and tab on the record.

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
