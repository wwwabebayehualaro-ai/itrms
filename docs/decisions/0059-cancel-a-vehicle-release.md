# ADR-0059: A vehicle release is cancelled by its own case at the releasing office

* Status: accepted (2026-11-17). Adds to [ADR-0057](0057-vehicle-transfer-between-offices.md) and
  [ADR-0058](0058-vehicle-transferred-out.md); task 1.4c2b.

## Context

A release (DVC-14) stands until it is received (DVC-15), or forever for a vehicle leaving the region: ITRMS installations are
not linked, and an outside handover never lapses by itself. An owner who changes their mind, or a release made in error, must be
undone. Neither the workflow engine (no step may act out of an end state) nor a timer can do it safely: a vehicle brought back
by itself could be registered in two regions.

## Decision

1. **DVC-16 "cancel a vehicle release"** is filed at the office that released the vehicle, checked by an officer and approved
   by a lead (separation of duties from the filer and the checker). The lead's approval cancels.
2. **What can be cancelled:** a handover still `released` from the case's office, of either kind, whatever its date. Its status
   becomes `cancelled`, a final status: the trigger allows it only with the cancelling case of the same office named, today,
   by the caller.
3. **The document check for a release to another region:**
   - the number of the transfer document handed back must match the issued document (compared trimmed, without spaces,
     upper-case);
   - while the document is valid it must be handed back;
   - once it has lapsed, a cancellation without it is allowed with a reason (the verification page already shows it expired),
     unless the region switches off `competency.vehicle_release_cancel_unreturned` (default on, sensitive).
4. **Effects:** the release's transfer document and covering letter are revoked (their QR reads revoked). A vehicle transferred
   out reads active again; its owners, plate, libre and stock plate were kept (ADR-0058), so nothing else changes.
5. **Refused while an open case names the release:** a transfer in (DVC-15) at the receiving office, or another cancellation.
   The source office cannot read the destination's cases, so a reviewed definer function answers whether one exists.
6. **No fee** (to confirm with the zone; a fee would be a new flow version with the payment wait, configuration only). An owner
   who still wants to move files a new, paid DVC-14.

## Consequences

- `vehicle_handovers` gains `cancelled` and the cancel columns (migration 0088).
- The DVC-16 request lists only vehicles with a standing release from the caller's office (a lookup of its own: the vehicle
  list holds only active vehicles).
- A vehicle transferred out before ADR-0058, which has no handover, cannot be brought back by DVC-16.
