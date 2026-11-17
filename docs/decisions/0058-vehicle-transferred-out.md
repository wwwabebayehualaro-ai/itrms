# ADR-0058: A vehicle transferred out of the region keeps its records; a lapsed document is undone only by a case

* Status: accepted (2026-11-17). Adds to [ADR-0057](0057-vehicle-transfer-between-offices.md); task 1.4c2.

## Context

A vehicle leaving for another region, or for an office without ITRMS, takes the zone's vehicle data transfer document (valid
15 days by setting). ITRMS installations are not linked, so the sending office cannot know whether the vehicle was registered
elsewhere. Directive 1050/2025's national register refuses a second registration in another region, but regions join it one by
one.

## Decision

1. **Only the status changes.** On issuing the document the vehicle reads `transferred_out`. Its open ownership period and owners,
   its current plate, its libre in force and its assigned stock plate stay as they were: every service requires an active vehicle,
   so nothing acts on them. This is what `stolen` already does. The national plate stays assigned (it is valid nationwide), the
   libre stays issued (the federal booklet travels with the owner) and the registration certificate is not revoked.
2. **The release stays standing** (`vehicle_handovers`, destination `outside`): it claims the vehicle against every other request.
3. **A lapsed, unused document changes nothing by itself.** The verification page shows it expired, so a receiving region refuses
   it. The vehicle comes back to active only through a case at the sending office, with the document handed back and a lead's
   approval (task 1.4c2b); never automatically, which could leave it registered in two regions.
4. **The covering letter** is always printed for another region (the zone's practice); for an office of the region that runs ITRMS
   it is the setting `competency.vehicle_transfer_covering_letter` (off).

## Consequences

- `setStatus` no longer sets `transferred_out`: a release is the only way a vehicle gets that status.
- The ownership chain (migration 0064) let only an active or stolen vehicle keep an open period. Migration 0087 lets a vehicle
  transferred out keep its one open period, or none if it left before this decision.
- A sticker or a temporary bolo is given only to an active vehicle, even on a bolo case that was open when it left.
- A vehicle returning to a region it left (task 1.4c3) brings its own record back to active instead of creating a new one.
- Reminders and other notices skip a vehicle that is not active.
