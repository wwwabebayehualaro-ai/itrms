# ITRMS implementation strategy

**For bureau leaders, ICT staff, INSA and tender committees.**
How ITRMS is built, introduced and run at a transport and road development bureau, and why. Version 1.0, 2026-11-11.
It is grounded in the national legal and system context ([ethiopia-context.md](../ethiopia-context.md)) and in the first
written answers of the reference zone ([discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md)).

Vendor: ABANEXUS SOFTWARE DEVELOPMENT PLC (ABA Nexus Technologies). ITRMS is the company's own product. No bureau has
commissioned it yet; the reference design is Wolaita Zone.

## 1. Principles

1. **The operational layer around the national records, never a competitor.**
   - The federal vehicle register (Directive 1050/2025), the driver platform (Proclamation 1074/2018) and the penalty
     system are the systems of record.
   - ITRMS runs the bureau's services around them and keeps their references, never a competing value.
   - Until an interface exists, staff key the reference in, and a reconciliation report lists the gaps.
2. **Every service is configuration.**
   - The 54 services are forms, workflows, fee rules and document templates. A bureau sets them, and its zones and
     woredas override only what it allows.
   - Code exists only for the effects a service names: register a vehicle, assign a plate, issue a booklet.
3. **Registries are regional, transactions are local.**
   - Vehicles, drivers, associations and road assets are regional records.
   - Inspections, payments and documents belong to the office that handled them.
   - A transfer moves the record's handling office; it never copies the record.
4. **Paper first, then digital, without a big bang.**
   - Records migrate as they are used (capture on touch), in campaigns and from a backlog (ADR-0054).
   - The wet stamp stays alongside the QR until e-signatures are accepted.
5. **Secure, auditable and in Ethiopia by default.**
   - Data stays in Ethiopia. Every write is audited.
   - Sensitive data is encrypted per field and revealed only with a recorded reason.
   - The installation is prepared for INSA evaluation from day one.
6. **One region, one installation.** Each regional bureau owns its server, its data and its configuration. Regions
   exchange only what an agreement allows.

## 2. Target architecture (one page)

| Layer | What | Why it is the industry standard |
|---|---|---|
| **Access** | Web app (PWA) for staff; a public verification page and an offline verifier app for anyone holding a document | Works in a browser on the office's computers, on weak networks (≤ 3 s first screen on 3G) |
| **Identity** | Keycloak: MFA for all staff (authenticator app or passkey); hardware keys for administrators; roles granted per office with validity dates | NIST 800-63-4 AAL2/AAL3; least privilege; no shared accounts |
| **Application** | A modular monolith (NestJS): one module per work process and per registry; one background worker for documents, SMS, reports and imports | One deployable, simple to operate for a regional ICT team; modules keep boundaries checked in CI |
| **Data** | PostgreSQL 16 with row-level security on the org-unit tree; a signed request context; field-level encryption for sensitive data; an append-only, hash-chained audit log | Isolation is enforced twice (application and database); tamper-evident audit |
| **Documents** | HTML templates → PDF with Ethiopic fonts; a signed QR on every certificate, receipt and licence; numbers from gapless counters | Anyone can verify a document online or offline; no gaps or reused numbers |
| **Integration** | One port per external system (MoTL registry, driver platform, penalty system, SMS, payments, Fayda), with a fake first and a real adapter when the counterpart exists; exports and partner accounts first (ADR-0053) | No dependency on systems that do not exist yet |
| **Operations** | Docker Compose with signed images; OpenTelemetry → Grafana; backups to a second site in Ethiopia (point-in-time recovery); monthly restore drill | Small footprint (one server of 8 vCPU / 48 GB per region), observable, recoverable |

Details: [architecture.md](../architecture.md), [security standard](../platform/security.md), [NFRs](../engineering/nfr.md).

## 3. National context: how ITRMS fits

| National element | ITRMS position |
|---|---|
| **Vehicle registration (Directive 1050/2025):** national `ETH` plates, a federal vehicle id, plates and **libre booklets printed by MoTL** (confirmed by the zone) | Plates and booklets are **controlled stock** received from the ministry. ITRMS records the federal id and the booklet serial, and issues its own QR registration certificate (ADR-0050). |
| **Driver licensing (Proclamation 1074/2018)** and a national driver platform (unconfirmed) | A licence stays `pending_national` until the platform accepts it. Numbers follow the region's pattern ("06-00001") until the platform numbers them (ADR-0047, ADR-0051). |
| **Fees (Regulation 572/2025; regional schedules)** | Versioned fee rules, each version approved by a second person. Amounts stay placeholders until the bureau gives its official schedule. |
| **Payments (MoF Directive 1069/2025)** | Cash at the office's till with a gapless receipt today. Payments made elsewhere are verified against a reference. Online payment through any NBE-licensed provider comes in Phase 3, or earlier if the region asks. |
| **Fayda national ID** | The FIN is recorded as an optional fact now. Real verification comes once an NIDP agreement exists. |
| **Data protection (PDP 1321/2024) and critical infrastructure (Proclamation 1426/2026)** | DPO, DPIA, a 72 h breach notice to the data protection authority, data stored in Ethiopia, and an INSA evaluation before go-live. If the bureau is designated a critical-infrastructure owner, incidents are reported to Ethio-CERT within 48 h (SEC-IR-2). |
| **Electronic signature (1072/2018, 1205/2020)** | QR verification now; the wet stamp is kept alongside it. PAdES signatures come when accepted. |
| **Road Fund, insurers, traffic police** | No electronic systems yet (zone, Q19.3). Scheduled reports and partner accounts first, under an MoU (ADR-0053). |

## 4. Roadmap and gates

| Phase | Scope | Gate |
|---|---|---|
| **0: Core and demo** (66/67 done) | Platform, registries, the licensing demo, two demo regions, verification | Demo validated by officials of at least two bureaus or zones |
| **1: Vehicle and licensing services at one pilot zone** | **Vehicle lifecycle first:** stationery, the DVC-01 booklet, paper migration, plate exchange, bolo, transfers with encumbrances, replacements, cashier. **Then** licences, exams and schools, print batches, freight, public transport, reports, data protection, production operations and the INSA pack | 8 weeks of live use at one zone; no cross-unit data incident; INSA evaluation passed; restore drill passed; agreed migration share; zone head sign-off |
| **2: Roads and safety** | Projects, unit rates, contracts, payment certificates, supervision, community participation, logistics, road-safety programmes and clubs, inspections and fines, accidents, field capture, maps | Zone-wide use for one fiscal quarter; quarterly report accepted |
| **3: Office and scale** | HR, the payroll list to Finance, planning and budget, online payments, Fayda, more zones, cross-region transfer | Every zone live; payroll accepted for 3 months; online payments reconciled daily; a second region installed or contracted |

**Why vehicles come first in Phase 1:**
- The vehicle side is what the zone runs every day on paper (roughly 170,000–250,000 files).
- It stays regional under the national rules.
- The ministry is centralising licensing.

Task order: [phase-1.md](../phases/phase-1.md).

## 5. Data migration (ADR-0054)

- **Capture on touch:** a record without an electronic file is captured, with its scan, when a service first needs it,
  and a second person verifies it.
- **Campaigns:** the plate exchange and the bolo season touch most active vehicles. Each has a daily count per office.
- **Backlog factory:** clerks enter the remaining files with sampling QA and a target rate agreed with the zone.
- **Reconciliation:** captured, verified and missing records per office and plate code, against the paper counts. The
  Phase 1 gate's migration share is measured here.

## 6. Integration and stakeholders (ADR-0053)

1. **Reports and exports,** scheduled and masked by agreement: to the region, the Road Fund, the insurance fund, the
   police and Finance.
2. **Partner accounts,** limited to the partner's own records: training institutions, inspection centres, garages,
   insurers and associations.
3. **System adapters** when a counterpart offers an interface: MoTL registry, driver platform, penalty system, payment
   providers, Fayda, SMS.

Every exchange runs under an MoU (template provided) and is listed in the data-sharing register.

## 7. Security and compliance: standards map

| Standard or law | Met by |
|---|---|
| ISO/IEC 27001 controls; INSA CMCSRS v2.0 (target score ≥ 76 under INSA's audit and evaluation guideline) | [security.md](../platform/security.md) SEC rules; task 1.19 (INSA pack, external pentest) |
| OWASP ASVS 5.0 L2 (L3 for sensitive areas) | SEC rules; CI scans (Semgrep, Trivy, gitleaks); the isolation matrix on every tenant table |
| NIST SP 800-63-4 (identity) | MFA AAL2 for staff and AAL3 for admins (SEC-ID-1/2); step-up for reveal and role grants |
| NIST SSDF / SLSA (supply chain) | Signed images, pinned dependencies, licence report; SLSA Build L2, L3 as the target |
| PDP Proclamation 1321/2024 | Field encryption, audited reveal, retention and legal hold, DPIA, DPO, breach runbook (task 1.17); health data rules (ADR-0052) |
| Proclamation 1426/2026 (critical infrastructure) | If the bureau is designated: INSA clearance before integration and a 48 h incident report to Ethio-CERT (SEC-IR-2); logs ready for a SOC either way |
| WCAG 2.2 AA | Design system with axe checks in every theme (CI) |
| Electronic signature 1072/2018 | QR-signed documents (Ed25519), keys per region, PAdES-ready |

## 8. Operations, support and continuity

| Area | How |
|---|---|
| **Availability** | ≥ 99.5 % a month in working hours |
| **Backup** | Point-in-time recovery to a second site in Ethiopia; RPO ≤ 15 min; monthly restore drill |
| **Recovery** | RTO ≤ 8 h with a cold spare server. **Optional warm standby:** a streaming replica at the second site, RTO ≤ 1 h ([operations/continuity.md](../operations/continuity.md)) |
| **Release and change** | One release train for all regions. Each release is a signed bundle with a pre-upgrade backup and rollback guidance. A change calendar avoids fiscal year end (Sene 30) and campaign peaks. Bureau UAT sign-off on a training installation before production. |
| **Support (ITIL-lite)** | Level 1: bureau super-users (trained per office). Level 2: the bureau ICT team (runbook in Amharic and English). Level 3: the vendor. Severity levels with response times in the support agreement. Incident records; the PDP 72 h notice and, for a designated critical-infrastructure owner, the Ethio-CERT 48 h report, from the breach runbook. |
| **Training** | A separate training installation, reset nightly, marked "TRAINING – not valid". Short Amharic videos per service. Super-users first. |
| **Escrow and exit** | Source escrow and a documented data export (open formats) in the pilot agreement. The bureau owns its data. |

## 9. Data governance

- **Each registry has an owner** (vehicles, drivers, associations, persons and organisations, road assets): a role at the
  bureau that approves merges and corrections. Duplicates are found by blind-index matching, and merges are approved.
- **Reference data is versioned and approved:** fee schedules, unit rates, plate codes, licence grades, checklists.
- **Statistics are disaggregated** by sex wherever people are counted (road-safety clubs, trainees, staff), by unit and
  by plate code.

## 10. Risks and responses

| Risk | Response |
|---|---|
| MoTL centralises more steps (registration, licensing) | ITRMS keeps references only and switches effects by configuration. The vehicle and roads services stay regional. |
| No official fee schedule in hand | Fee rules stay marked as demo; go-live needs the bureau's signed schedule (versioned and approved). |
| Paper backlog larger than capacity | Capture on touch keeps the service running; the backlog target is agreed and reported weekly. |
| Weak connectivity at woredas | Online-first PWA with drafts kept on the device; lite mode for slow offices; services can be routed to the nearest office. |
| INSA evaluation findings | Built to the baseline from Phase 0; pentest before submission; fixes tracked with regression tests. |
| Staff turnover and skills | Super-user network, training installation, Amharic material, delegated administration per zone. |
| Vendor dependency | Escrow, open data export, documented runbooks, the bureau's own ICT trained at level 2. |

## 11. Open points with the reference zone

From the discovery record: missing answers (questions 1–10, 14, 15, 18 and 20–23), the official fee schedule and its
legal basis, copies of the forms and reports marked "have", and the readings to confirm (regulation numbers, transfer tax
rates, who prints the bolo sticker, plate code 35).
