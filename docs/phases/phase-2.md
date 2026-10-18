# Phase 2: Roads and safety

## Goal
Bring work processes 4–8 onto ITRMS: road traffic safety, road quality and safety audit, design and contract administration,
community participation, and logistics. Then use the system **zone-wide**.

**Gate: zone-wide use.** Every woreda and town of the pilot zone uses ITRMS for:
- contracts and payment certificates;
- quality audits and supervision;
- machinery rental;
- fines and accidents;
- community works.

This must hold for one full Ethiopian fiscal quarter, with the quarterly report produced from ITRMS and accepted by the
zone's Finance and Plan department.

## Scope
In:
- Contractors and consultants, road projects, designs (incl. DC3 upgrades), unit rates, contracts, BOQ, variations.
- Payment certificates (interim, bridge works, advance payment with recovery, retention).
- Construction supervision and quality audits, rural access road works progress.
- Community maintenance works valued in Birr, capital budget allocation.
- Machinery register and rental, job creation and tree-planting records.
- Road safety: campaigns, school and kebele clubs, zebra crossings, inspections, fines, accidents shared with police and
  insurers.
- Mobile-friendly field capture.

Out: HR, payroll list, planning and budget (Phase 3); a GIS road network (maps are optional, see 2.13).

**National-system rule:** traffic fines and driver points live in MoTL's **National Traffic Point-Based Penalty Management
System** ([`../ethiopia-context.md`](../ethiopia-context.md) §3). ITRMS records the zone's inspections and the tickets its
inspectors write, and reads fines and points for reports. It does not keep its own points.

## Tasks (in order)

| # | Task | Done when | Tests |
|---|---|---|---|
| 2.1 | **Roads parties and projects:** contractors and consultants (licence grade/category, TIN), road projects register (kind, length, woreda/kebele, chainage, optional GPS) | A project lists every contract, audit and payment linked to it | Registry RLS; lookup providers |
| 2.2 | **Unit rates and designs:** versioned unit-rate catalogue received from the region (import), design works records, DC3 upgrade identification and preparation | A contract BOQ always uses the rate version in force on its date | Rate versioning tests |
| 2.3 | **Contract administration:** contract documents (templates), award, BOQ (`numeric` quantities, santim rates), variations with approval, extension of time | The contract value equals the sum of BOQ lines; a variation needs approval above a threshold | BOQ arithmetic goldens; SoD tests |
| 2.4 | **Payment certificates:** interim certificates, bridge works payment documents, **advance payment** documents with recovery schedule, retention, deductions; approval workflow; PDF with QR | A certificate's cumulative totals reconcile with previous certificates; advance recovery never exceeds the advance | Certificate calculation goldens (exact santim); workflow tests |
| 2.5 | **Construction supervision and quality audits:** site visit and audit forms (checklists, photos, non-conformities, corrective actions with due dates) | An open non-conformity blocks the next payment certificate when configured | Rule tests; e2e audit with photos |
| 2.6 | **Rural access road works progress:** earthwork, gravel, dumping and spreading, structures; physical progress per project | Progress feeds project dashboards and the quarterly report | Progress aggregation tests |
| 2.7 | **Community participation:** routine and periodic maintenance by the community, **valued in Birr** (labour days × rate, materials), capital budget allocation at woreda and zone | Valuation equals rate-table × quantities; allocation totals match the budget lines | Valuation goldens |
| 2.8 | **Logistics:** machinery register, rental contracts to contractors (rates, hours, fuel, operator), invoices → payment orders and receipts; job creation records; tree-planting records | Rental hours cannot overlap for one machine; invoices reconcile with logged hours | Overlap tests; invoice goldens |
| 2.9 | **Road safety programmes:** awareness campaigns (media partners, reach), school and kebele safety clubs (members, activities), zebra crossings (location, painting dates) | Per-woreda programme reports | Report tests |
| 2.10 | **Traffic inspections and fines:** routine and surprise inspection records; ticket capture by zone inspectors; fine payment (cashier); `TrafficPenaltySystem` adapter (send tickets if accepted; read fines and points) | A fine is paid once; ticket numbers are gapless per inspector book or unit | Fine lifecycle tests; adapter contract tests |
| 2.11 | **Accident records:** place, time, vehicles (registry links), persons and injury severity, property damage in santim, police reference; sharing log with police, insurers and the insurance fund (exports or keyed pull API) | Personal data in shared exports follows the agreed minimum set; every share is audited | Export masking tests; share audit tests |
| 2.12 | **Field capture on phones:** responsive forms for inspectors and supervisors, photo capture with compression, queued uploads on bad connections (no full offline mode unless decided) | An inspection captured on a 3G phone completes with photos | Playwright mobile viewport e2e |
| 2.13 | **Roads and safety reports:** contract status, payments vs budget, audits, accidents by woreda and severity; map views with MapLibre GL + self-hosted PMTiles (OpenStreetMap data, ODbL attribution): accident black spots, road assets | The quarterly figures equal the typed tables (cross-check) | Report goldens |
| 2.14 | **Zone-wide rollout:** onboarding every woreda and town of the pilot zone, training, admin delegation | Every unit has active users and live cases in each process | Rollout checklist |

## Phase acceptance criteria
1. Work processes 4–8 run on configuration plus module effects. Every payment-related figure is exact in santim and
   reconciles.
2. Payment certificates and rental invoices pass review by the zone Finance and Plan department on real samples.
3. Accident and fine data sharing is audited and limited to the agreed fields.
4. A full quarter of zone-wide use, with the quarterly report from ITRMS.

## Tests to write in this phase
BOQ, certificate, advance-recovery and valuation goldens (exact integer arithmetic); variation and certificate SoD tests;
machinery overlap tests; fine lifecycle and adapter contracts; accident share masking; mobile e2e; report cross-checks.

## Open questions
1. Payment certificate formats (the bureau's or the regional roads authority's templates) and retention/advance rules.
2. The unit-rate catalogue format the region sends.
3. Whether zone inspectors write tickets in the national penalty system directly.
4. The agreed data set for police and insurer sharing (a legal basis under PDP 1321/2024).
5. Whether field staff need full offline capture.
