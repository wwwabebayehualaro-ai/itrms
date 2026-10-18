# Phase 1: Licensing services

## Goal
Run every licensing service of work processes 1–3 (driver and vehicle competency, public transport, freight) on ITRMS at
**one pilot zone office**, with its paper records migrated and the installation production-ready.

**Entry: a signed pilot agreement** with a bureau (data ownership, confidentiality, duration, exit;
[go-to-market.md](../go-to-market.md) §5). **Gate: a pilot at one zone office.** Every licensing service of the pilot zone is processed in ITRMS for 8 consecutive
weeks, and all of the following hold:
- no cross-unit data incident;
- an INSA security evaluation passed;
- a monthly restore drill passed;
- an agreed share of active paper records migrated (target set with the bureau, e.g. all records touched in the last 3
  years);
- the zone head signs off.

## Scope
In: the full vehicle and driver registry, vehicle registration and plates (national format), bolo inspection, transfers,
replacements, the full driver-licence family, exams and training-school oversight, licence print batches, freight
competency, public transport (terminals, routes, tariffs, associations, schedules), cashier operations, SMS reminders,
licensing reports, paper-record migration tooling, data-protection features, production operations and the security
evaluation.

Out: roads, safety, contracts (Phase 2); HR, payroll list, planning and online payments (Phase 3, unless the region asks for
payments earlier).

**National-system rule** ([`../ethiopia-context.md`](../ethiopia-context.md) §2–3): vehicles carry the **federal vehicle id**
(Directive 1050/2025) and national licence status. ITRMS records references and never competes with the national systems.
Until interfaces exist, staff enter the federal reference manually and a reconciliation report lists gaps.

## Tasks (in order)

| # | Task | Done when | Tests |
|---|---|---|---|
| 1.1 | **Vehicle registry:** `vehicles` (federal id, VIN/chassis, engine, make/model/year, category, use, capacity), ownership history, libres; registry search; `RegistryLookup` provider for vehicles | A vehicle is found by plate, VIN or federal id from any unit of the region; ownership history is complete | Registry API + RLS class R; lookup provider tests |
| 1.2 | **Registration and plates:** new registration; plate stock (federal source, allocation to units, status lifecycle); **plate exchange** from regional to national format; libre issue | A plate cannot be assigned twice; stock counts reconcile per unit; an exchanged old plate is retired and linked | Plate state machine tests; concurrency on allocation; e2e new registration |
| 1.3 | **Bolo technical inspection:** checklist form (configurable by vehicle category), garages as organisations, result, validity, bolo document with QR, renewal reminders | A failed item blocks the pass; a bolo PDF verifies; the expiry date is computed from the category rules | Checklist rule tests; document golden; reminder job test |
| 1.4 | **Ownership transfer and zone transfer out/in** (linked cases; handling unit changes on completion; never a copy) | After transfer-in, the destination handles the vehicle and the source keeps only its own cases; a pending transfer blocks conflicting services | Transfer integration tests incl. RLS on both sides |
| 1.5 | **Replacements:** lost libre, bolo or plate (police report attachment, fees, the old document revoked so its QR says "superseded") | The old document reports superseded; fees follow the replacement rule | Supersede tests; fee goldens |
| 1.6 | **Driver licence family:** grade upgrade, international licence, replacement, cancellation/suspension record (from the national status) | Every service runs on configuration plus module effects only | Workflow-run tests per service |
| 1.7 | **Exams and training schools:** school register and oversight visits, enrolments, exam session scheduling (capacity, examiner), theory + field results, retake rules | A trainee without a completed enrolment cannot be booked; results flow into the licence case | Scheduling and eligibility tests; e2e exam day |
| 1.8 | **Licence print batches:** batch to region or national platform, returned and distributed states, a pickup SMS | Every issued licence is in exactly one batch; distribution is recorded with the recipient's signature or ID | Batch state tests |
| 1.9 | **Freight competency:** vehicle competency certificates (new/renewal), freight associations and their annual renewal | Certificates verify by QR; renewals pick up the association's vehicles | Workflow-run tests; certificate golden |
| 1.10 | **Public transport, part 1:** terminals (menahariya), routes (inter-zone, zone–woreda, town), tariffs (versioned; approval from the region) | A route links two units; a tariff change is effective-dated and approved | Tariff versioning tests |
| 1.11 | **Public transport, part 2:** taxi association organisation and **annual renewal**, member vehicles, monthly schedule submission and approval | A schedule cannot assign a vehicle twice in a slot; a renewal lists lapsed members | Schedule conflict tests; e2e renewal |
| 1.12 | **Cashier operations:** cashier sessions, daily closing (expected vs counted), remittance report to the revenue office, reversal approvals | A session cannot close with a difference without a note and approval; the remittance total equals the receipts | Closing tests; report goldens |
| 1.12a | **Controlled stationery:** serial-range stock of licence card blanks, bolo stickers and receipt pads per unit (received from the bureau, issued, used, spoiled), reconciled at cashier closing | Every printed licence consumes one blank serial; a missing serial is flagged at closing | Stock reconciliation tests |
| 1.12b | **Appeals and correspondence:** appeal sub-case on any decided case (30 days, Proclamation 1074/2018 Art. 24), routed one level up; numbered incoming/outgoing letter register (ደብዳቤ) linked to cases | An appeal after 30 days is refused with the reason; letters are numbered gaplessly per unit and year | Appeal workflow tests; numbering tests |
| 1.12c | **Training installation** (separate Compose project: own DB, realm, bucket, hostname; fakes for SMS/payments; "TRAINING – not valid" on verification; nightly reset) and **lite mode** (driven by real-user web vitals per office) | Staff practise without touching production; slow offices get the lite UI automatically | Isolation of the training stack; lite-mode switch test |
| 1.13a | **Form platform, part 3:** wizard steps; `Signature`, `Photo` (camera, face crop), `GeoPoint`, `Checklist` matrix (bolo, school oversight); reusable blocks (versioned, with impact); logic inspector; print preview with official header; form analytics (aggregate) | The bolo inspection runs on the checklist type; a block update shows every affected form; analytics show the field with the most errors | Field type tests (incl. server validation); block impact tests |
| 1.13 | **Paper-record migration tooling:** back-capture mode (relaxed rules, original date, paper reference, `migrated` flag); Excel/CSV bulk import with validation, dedupe and a dry-run report; scan attachment; reconciliation reports | 1,000 sample rows import with every error reported per row; a re-run is idempotent; migrated records are marked in every view | Importer unit tests; idempotency; e2e back-capture |
| 1.14 | **National system adapters:** `NationalVehicleRegistry` and `NationalDriverPlatform`, real if MoTL provides interfaces, else manual reference entry + reconciliation report | Adapter contract tests pass for the fake and the real (or manual) implementation | Contract test suite |
| 1.15 | **SMS gateway (real)** and notification preferences; renewal reminders for licences, bolo, association renewals | Reminders are sent once per rule, with retries and a delivery status | Job tests with a provider stub |
| 1.16 | **Licensing reports and dashboards:** per unit, service, SLA, revenue; Excel export; the monthly report to the region | Figures equal the underlying typed tables (cross-check test) | Report golden tests |
| 1.16a | **Upload scanning:** ClamAV container, `pending_scan` → `clean`/`infected` flow, signature mirror for offline sites (ADR-0022) | An EICAR test file is blocked and audited; a clean file becomes downloadable within 30 s | Scan flow integration tests with the ClamAV container |
| 1.17 | **Data protection:** masking and audited reveal; retention rules per record type; records of processing, DPIA template, breach runbook, DPO contact (PDP Proclamation 1321/2024) | Masked fields never appear in exports for roles without reveal | Export masking tests |
| 1.18 | **Production operations:** production Compose profile, installation runbook (Amharic + English), observability stack (OpenTelemetry, Alloy, Prometheus, Loki, Tempo, Grafana dashboards and alerts as code, GlitchTip; ADR-0023), sops + age secrets, cosign-verified images, automated monthly restore drill, upgrade and rollback procedure | A fresh server is installed from the runbook by someone other than the author | Restore drill in CI (nightly) |
| 1.19 | **Security and INSA evaluation pack:** threat model, dependency and licence report, external pentest, fixes, evaluation submission | INSA clearance, or findings accepted with a plan | Regression tests for each fixed finding |
| 1.20 | **Pilot preparation:** Amharic training material and short videos, user admin delegation for the zone, migration rehearsal, support process (who to call, issue form) | Rehearsal completes within the planned cut-over window | Pilot checklist |

## Phase acceptance criteria
1. All licensing services of work processes 1–3 are configured and run end to end in the pilot zone.
2. The registry holds the pilot zone's active vehicles, drivers and associations, with federal references where available.
3. Revenue reports reconcile with the cashier closings for every pilot day.
4. INSA evaluation passed; monthly restore drill passed; no open high-severity security findings.

## Tests to write in this phase
Registry RLS (class R) for each new table; plate and bolo state machines; transfer pair tests; exam eligibility; schedule
conflicts; cashier closing; importer dry-run and idempotency; adapter contract suites; masking in exports; report
cross-checks; e2e for each high-volume service (registration, bolo, licence renewal, association renewal).

## Open questions
1. The vehicle registration steps regions perform in the national system, and its interface (if any).
2. Bolo checklist per vehicle category, and the validity rules.
3. Tariff approval flow: does the region approve zone route tariffs?
4. Which paper records to migrate and how far back; who does the data entry.
5. The pilot zone and pilot start date.
