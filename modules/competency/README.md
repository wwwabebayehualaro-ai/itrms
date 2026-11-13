# @itrms/competency

Driver and vehicle competency: driver licences, bolo inspections and the competency services.

**New vehicle registration (DVC-01, task 1.2b).** Seeded as configuration (`seed/vehicle-services.ts`): the request form
`vehicle-registration` (owners, the vehicle's facts, documents, the fee), the step form `vehicle-national-entry` (the federal
vehicle id, keyed in by staff until a national interface exists), the workflow draft → review → payment → approval →
registration → booklet → registered, the fee rule `dvc-01-registration` (demo amounts) and the
`vehicle-registration-certificate` template (the zone's temporary libre). The effects
(`api/registration.effects.ts`, run by `VehicleRegistrationService`) call the vehicle register and the plate stock: check the
chassis at submit (a binding check-digit failure only when the officer confirms it, recorded as a `vinCheck` mismatch), hold a
plate from the handling unit's stock at the lead's approval, give it back on rejection, and at registration make
the vehicle with its first ownership, assign the held (or a named) plate, and issue the libre with its registration
certificate, numbered from the office's counter. The last step (task 1.2d, ADR-0050; step form `vehicle-libre-booklet`) writes the
libre in a federal booklet from the office's stationery (`StationeryStock.use`: the named one or the next; the booklets spoiled on
the way recorded with their reasons) and issues the certificate again with its serial, the temporary one superseded. With no
booklet in stock the case waits in that step. Each effect is idempotent per case. The service needs the `holds_plate_stock`
and `holds_stationery` capabilities of the handling unit.

**The plate exchange (DVC-12, task 1.2c, Directive 1050/2025).** Not in the source list: the plates part of DVC-01 as its own
service, offered where vehicles are registered (`holds_plate_stock`). Seeded as configuration (`seed/exchange-service.ts`): the
form `vehicle-plate-exchange` (the vehicle picked from the register, its use, the owner's identity and the libre as attachments,
the fee), the step form `vehicle-plate-handover` (the federal vehicle id the national system gave, the plate handed over if not
the held one), the workflow draft → review → payment → approval → exchange → exchanged, and the demo fee rule
`dvc-12-plate-exchange` (the zone's plate fees by use). `competency.checkPlateExchange` refuses a vehicle not active, handled by
another office, already on a national plate, a use that is not the register's, and a second open request; the plate is held
and released by the registration's effects; `competency.exchangePlate` records the federal id and puts the plate on the vehicle,
the old plate retired and linked to it. A vehicle not on the register is back-captured first (MIG-01).

**The back-capture of a paper vehicle file (MIG-01, task 1.13, ADR-0054).** Not one of the bureau's 54 services: the migration's
own, offered where vehicles are registered. Seeded as configuration (`seed/back-capture-service.ts`): the form
`vehicle-back-capture` (the paper file's reference and its scan, both required; the registration's owner and vehicle fields; the
file's dates in the Ethiopian calendar; the plate it carries and the libre it holds), the workflow draft → verification → captured,
no fee. `competency.checkBackCapture` checks the capture in back-capture mode when it is filed or corrected (the dates in order, a
plate no vehicle carries and not in the stock, no other open request for the chassis or plate). The verification step keeps
whoever captured the file off it (separation of duties); `competency.backCaptureVehicle` then registers the vehicle as migrated,
verified by the actor, with its plate and libre. Until then the vehicle is not on the register, so no service can act on it.
The vehicle search offers the back-capture when it finds nothing (capture on touch). The bulk import, sampling QA, campaign
counters and the reconciliation report are task 1.13b.

**Acting for the handling office, and one vehicle in one open request (task 1.2e).** The steps that write a vehicle's records
(register, the plate, the libre and its booklet, the exchange, the back-capture's verification) run for the case's handling
office: taken in it, or in an office above it when separation of duties left nobody in the office and the step was sent up the
tree (`api/handling-office.ts`, `actForHandlingOffice`). The vehicle, its plate (from the office's stock) and its libre (from
its stationery) stay the office's; any other office is refused (`competency.errors.act_from_handling_office`). Whether another
open request claims the vehicle (a registration's or back-capture's chassis, a back-capture's old plate, an exchange's vehicle)
is asked of the reviewed `competency.vehicle_in_open_case` over the whole region (migration 0073), not of the cases the filer's
office sees, so two sibling offices cannot both take a fee for one vehicle. A chassis check digit the officer confirmed does not
match is a notice on the case (`competency.notice.chassisMismatch`), shown to the lead who approves it.

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

## The bolo inspection (DVC-02, task 1.3a)

A vehicle on the register is filed with its third-party insurance certificate (Proclamation 799/2013: number, insurer, policy
period; a policy that does not cover today is refused) and the papers its use needs (a public transport or freight vehicle,
plate codes 1 and 3, brings its Road Fund receipt). The fee is the zone's table by use, seats and load (demo). After payment the
officer inspects it on the light-vehicle checklist (a `Checklist` field, task 1.13a: the outcome is the server's), with the
sheet's own serial: `pass` is refused unless the checklist passed (a failed item blocks it), `fail` closes the case with the
failed items (re-inspection after a garage is task 1.3b). A pass makes the vehicle's bolo, `competency.bolos` (class R: the
region reads it, the handling office's subtree writes it), valid to Sene 30 of the fiscal year it was inspected in. The officer
then hands over the sticker of the vehicle's use and that fiscal year from the office's stationery (the bolo document carries its
serial), or, while the office has none, a temporary bolo numbered from the office's counter (`{unit}/TB/{seq:05}`) for
`bolo_temporary_days` (30 by default), and the sticker later on the same case. A vehicle has one bolo per fiscal year.
