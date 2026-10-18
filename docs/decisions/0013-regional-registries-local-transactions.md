# ADR 0013: Registries are regional, transactions are local

* Status: accepted (2026-10-17, fixed)

## Decision
* Vehicles, plates, drivers and licences, associations, routes, people and organisations are **regional records**: one row
  per region, readable across the region.
* Every inspection, renewal, fine, payment and issued document is a **local transaction**. It is stamped with the handling
  org unit and visible in that unit's subtree.
* A zone transfer is a pair of linked cases: transfer-out at the source and transfer-in at the destination. Completing the
  transfer-in changes the record's `handling_unit_id`. **The record is never copied.**
* Some national systems are the system of record for certain facts: the federal vehicle id under Directive 1050/2025, the
  national licence status and penalty points. For those facts the regional record stores the national reference and never
  competes with it (`docs/ethiopia-context.md` §2–3).

## Consequences
* A record's full history is visible across the region in summary form only: service, date, unit and outcome. Case details
  stay within scope. To be confirmed with the bureau (open question in phase-0).
* Transfers between regions come in Phase 3, through an API between installations.
