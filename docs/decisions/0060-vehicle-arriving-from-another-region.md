# ADR-0060: A vehicle arriving from another region is registered by its own service, its national plate in the same case

* Status: accepted (2026-11-18). Adds to [ADR-0057](0057-vehicle-transfer-between-offices.md) (whose "two services" becomes
  three: DVC-15 stays the transfer in between offices of this region) and [ADR-0058](0058-vehicle-transferred-out.md); tasks
  1.4c3 and 1.4c3b.

## Context

A vehicle released by another region, or by an office without ITRMS, arrives with that body's vehicle data transfer document.
ITRMS installations are not linked: nothing can be fetched from the other side, and the arriving vehicle is new to this register
unless it once left it.

## Decision

1. **A service of its own, DVC-17** "register a vehicle transferred from another region", not a mode of DVC-15. Its request takes
   the vehicle and owner facts as DVC-01 does, and DVC-15's office path stays as it is. A mode would make every registration
   input optional and checked by hand. It would also break DVC-15's submit, whose hold check needs a vehicle of this register.
2. **The vehicle joins the register through the strict registration checks** of DVC-01, its owners' period acquired by
   `transfer_in`. The document's facts are kept in a typed table, `vehicles.vehicle_arrivals`: the number, the issuing region and
   office, the date and last day, how it was checked, and the plate carried, the bolo and the holds it lists.
3. **The document is checked by the officer**, on the issuing body's verification page or by letter: ITRMS never fetches an
   address a user gives. It must be valid on the filing day, which is frozen in the case. A document number is used once per
   issuing region.
4. **The plate is a step of the same case.** With `competency.vehicle_transfer_plate_exchange` on (default, frozen at filing), a
   vehicle on an old regional plate is given a national plate from the office's stock: reserved at approval, assigned when the
   vehicle is registered, the old plate ended as exchanged. A national or special plate is kept. So the vehicle never stands on
   the register on a plate the rule forbids, and the owner pays once.
5. **The federal libre** the owner holds is recorded as the libre in force (to confirm with the zone that it always travels). This
   office issues the registration certificate.
6. **The bolo and the holds the document lists** are kept as facts. No bolo or encumbrance is recorded by itself: a hold is
   recorded on its holder's letter, through the encumbrance service.
7. **Fee:** a demo placeholder of 2,000 Birr, plus the plate fee when a national plate is given (to confirm with the zone).
8. **A returning vehicle** (its chassis or federal id is a vehicle of this region transferred out) gets its own record back
   (task 1.4c3b). The outside release becomes `returned`, the record moves to the filing office and is active again, and the
   owners change if they changed. Until then DVC-17 refuses it. The return is refused while this region's own document is still
   valid: the owner cancels it with DVC-16 instead.

## Consequences

- `ACQUIRED_BY` gains `transfer_in`, which DVC-13 never writes. The catalogue gains DVC-17.
- `competency.vehicle_in_open_case` claims an arriving chassis and plate against DVC-01, MIG-01 and other arrivals.
