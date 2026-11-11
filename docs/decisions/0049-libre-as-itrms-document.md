# ADR-0049: The libre is an ITRMS document, numbered by the office, until the national system issues it

* Status: accepted (2026-11-11), a stated assumption to confirm with a bureau. Task 1.2b.

## Context

A registered vehicle has a libre (ሊብሬ, the ownership title booklet). Directive 1050/2025 moves vehicle registration to a
national system that gives each vehicle a federal identification number (ethiopia-context.md §2); whether that system will
also issue the libre, and from when, is not known. Today regions issue libres on paper. ITRMS needs a libre at the end of a
new registration (DVC-01) so that a case ends in a document the owner can carry and anyone can verify.

## Decision

1. **The libre is a document of ITRMS:** the `vehicle-libre` template, rendered to PDF with a QR that the public
   verification page checks (ADR-0006), for the vehicle's current owners (the ownership period it is issued for).
2. **Its number comes from a transactional counter per office,** `vehicles.libre`, pattern `{unit}/LB/{seq:06}`, in the
   business transaction (gapless, never reused), like the driver licence numbers (ADR-0047).
3. **The national reference stays apart:** `libres.national_reference` holds the national system's number once it issues
   one; ITRMS never invents it. When the national system issues libres, the region switches the effect to record the
   national booklet instead (configuration of the service's workflow), and the counter stops being used.
4. **One libre in force per vehicle** (`libres_issued_uq`); a new one replaces the one in force.

## Consequences

* A registration case ends with a verifiable document without waiting for a national interface.
* A bureau that issues pre-printed booklets records the booklet's serial as the number instead: a change of the effect's
  input, not of the tables.
* To confirm with a bureau: the libre's layout and fields, and whether the zone or the region numbers it.
