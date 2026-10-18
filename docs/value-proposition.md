# Why ITRMS: value proposition and differentiators

*ITRMS by **ABA Nexus Technologies** (ABANEXUS SOFTWARE DEVELOPMENT PLC), abanexustech.com.*

For the product owner's conversations with regional bureaus and zone leadership across Ethiopia (ITRMS is self-built;
see [go-to-market.md](go-to-market.md)). Each claim says whether it is **in the
Phase 0 demo** (shown live), **planned** (with its phase), or **optional** (a decision for later). Nothing here should be
promised beyond that. Facts about Ethiopia are sourced in [ethiopia-context.md](ethiopia-context.md).

## 1. The problem the authority has today
* **All 54 services** of a zone department run on paper. There is no live picture of what is pending, late, or collected.
* Licences, bolo and receipts are hard to verify. Paper invites forgery, and lost files are common.
* Fees are collected at many offices, and reconciling them is manual.
* Quarterly performance reports (PB-02) take weeks to compile from paper.
* National systems are arriving: the national vehicle registry under Directive 1050/2025, the MoTL driver platform, the
  point-based penalty system, Fayda and MESOB. The zone needs its own work digitised **in a way that fits them**, not a
  competing silo.

## 2. Ten differentiators

| # | Differentiator | What the authority sees | Status |
|---|---|---|---|
| 1 | **Made for Ethiopian government work** | Ethiopian calendar everywhere (entry, display, print, fiscal year); Amharic first; **Wolaytta** for Wolaita (no other system speaks the zone's language); the real structure of region › zone › woreda (ምድብ) › town (ፈርጅ); Form 15 positions as the basis for roles | Demo |
| 2 | **All 54 services, one platform** | Every service of the department is in one catalogue. Simple ones are configured, complex ones are built in; nothing stays on paper by design | Demo: 2 services live, 54 in the catalogue. Planned: Phases 1–3 |
| 3 | **The bureau changes the system itself, safely** | When a directive changes a form, fee or step, the bureau publishes a new version the same day, without a programmer. Every change is **checked, tested with sample cases, reviewed and reversible**. Fields the law and the system depend on (e.g. the medical certificate for a licence) are locked, so a form edit can never break a licence, a fee or a report. Zones adjust only what the bureau allows | Demo (live form change and override) |
| 4 | **Proof against forgery, even offline** | Every licence, bolo, certificate and receipt carries a **digitally signed QR**. A traffic officer's phone verifies it **with no network** (the signature proves ITRMS issued it). When online, it also shows *revoked / superseded*. Receipts are numbered without gaps, an external payment reference can never be used twice, and stationery (licence blanks, receipt pads) is tracked by serial number | Demo (signed QR + verifier); planned: stationery (Phase 1) |
| 5 | **Every birr accounted for** | Fee calculated by rule → payment order → receipt with a gapless number → daily cashier closing → remittance report. A licence cannot be issued without settled payment. Revenue per office per day is on one screen | Demo (payment, receipt, dashboard); planned: cashier closing (Phase 1) |
| 6 | **Transparency and accountability** | Every action is recorded in a **tamper-evident** history (hash-chained, with a daily signed digest kept off-site, so even an administrator can't secretly alter it). Maker and checker are always different people. Each step has a visible deadline that escalates. Auditors get **anomaly alerts** (reused payment references, approvals at night, unusual reversal rates). Citizens can ask **who accessed their data**. Corruption needs discretion and secrecy; ITRMS removes both | Demo (history, SLA, maker-checker); planned: anomaly rules (Phase 2), access report (Phase 1) |
| 7 | **A live picture for leaders** | The bureau head sees all zones; a zone head sees all offices: cases by stage, overdue items, revenue, licences issued. The **quarterly performance report is generated** from the data | Demo (dashboards); planned: quarterly report (Phase 3, earlier on request) |
| 8 | **Fits the national systems** | Stores the federal vehicle id and national licence status as references, never competing values. Adapters for the MoTL registry and driver platform, the penalty system, Fayda and payment providers. An open, versioned API, ready for **MESOB** (the national one-stop service platform and its Bridge API gateway) | Demo (adapter with a simulated national system); planned: real adapters (Phases 1–3) |
| 9 | **Works where the offices are** | **Type Amharic on any PC**: phonetic typing (`selam` → ሰላም) in every field, so no Amharic keyboard is needed. Drafts survive power and network cuts; nothing is submitted twice; uploads resume; a **lite mode** switches on by itself for slow offices; phones for field inspectors. A **training system** lets staff practise without touching real data | Demo (Ethiopic typing, drafts, phone view); planned: lite mode and training system (Phase 1) |
| 10 | **The data stays in the region, safely** | Installed on the bureau's own server; backups to a second site **inside Ethiopia**; 2FA for staff; each office sees only its own work (enforced twice: application + database). Built to pass the INSA security evaluation and the Personal Data Protection Proclamation 1321/2024 | Demo (2FA, isolation); planned: INSA evaluation (Phase 1) |

## 3. For citizens (what the public notices)
| Feature | Status |
|---|---|
| **Appeal a decision** within 30 days (Proclamation 1074/2018 Art. 24), tracked like any case | Planned Phase 1 |
| SMS in the citizen's language at each milestone ("application received", "exam on Tikimt 12", "licence ready for pickup") | Planned Phase 1 (simulated in the demo) |
| Renewal reminders before expiry (licences, bolo, association licences); this also **raises revenue on time** | Planned Phase 1 |
| Public QR verification page, no sign-in | Demo |
| Pay by telebirr, CBE Birr or any licensed provider (MoF Directive 1069/2025) | Planned Phase 3, earlier on request |
| Exam and inspection appointment booking | Planned Phase 1 |
| Status by USSD / short code | Optional, depends on an Ethio telecom agreement |

## 4. Paper-to-digital acceleration
The biggest risk in any paper-replacement project is the existing archive. ITRMS treats it as a feature:
* **Bulk import** of registers already typed in Excel, with row-by-row validation, a dry run and re-runs that never
  duplicate (Phase 1).
* **Back-capture mode:** old records entered with their original date and paper reference, marked as migrated (Phase 1).
* **Scan-and-attach:** the original paper page is linked to the digital record (Phase 1).
* **Assisted data entry (optional):** printed Amharic forms can be OCR-read with Tesseract's Amharic model to pre-fill
  fields, which a clerk then confirms. Handwriting is not reliably recognisable, so a human always verifies, and the
  accuracy must be measured on the zone's real forms before this is promised.

## 5. State-of-the-art, made concrete
Leaders are not impressed by buzzwords but by things they can see. Each technical choice maps to a visible effect:

| Technology | Visible effect |
|---|---|
| Configuration engine (forms, workflows, fee rules, templates as versioned data) | The bureau changes services without programmers (differentiator 3) |
| Row-level security on an org tree + guards | An office can never see another office's cases, even by mistake |
| Transactional outbox + idempotency | No lost or duplicated applications, payments or SMS |
| QR verification + gapless counters + append-only audit | Forgery and "missing receipts" become visible immediately |
| Server-rendered UI, offline drafts (PWA), compact mode | Fast on old PCs and slow links; staff keep working through outages |
| OpenTelemetry + Grafana | The vendor sees problems before users report them; uptime can be reported |
| Keycloak with 2FA and passkeys | Bank-grade sign-in for staff |
| Open, versioned API | Ready for MESOB, Fayda and the national systems |

## 6. Proving the value (measure, don't claim)
The pilot (Phase 1 gate) measures **before and after** at one office. The zone's baseline comes from a two-week paper
sample, collected in the first weeks of Phase 1:

| Indicator | How it is measured |
|---|---|
| Days from application to licence issued | case timestamps vs. paper sample |
| % of cases within the service standard (SLA) | SLA records |
| Fees collected vs. fees due; unexplained differences at closing | cashier closings |
| Time to produce the quarterly report | before: staff estimate; after: report generation |
| Document verification checks performed | verification page log |
| Citizen notifications sent and delivered | SMS delivery reports |

## 7. The 15-minute "wow" sequence for the demo
Shown in this order (full journey: [demo-plan.md](demo-plan.md)):
1. Sign in with 2FA in Amharic; switch the screen to **Wolaytta**.
2. Register an applicant; the date picker is the Ethiopian calendar.
3. Submit a licence application at Boditi; the fee is calculated automatically.
4. Show that **Damot Gale cannot see it**, while the zone head can.
5. Approve. The PDF licence appears in Amharic and English.
6. **Scan its QR with a phone in flight mode:** "valid, signed by the (sample) regional bureau". Turn the network on: "valid".
7. Revoke it; scan again online: "revoked". Show a tampered copy: "signature invalid".
7a. Type an applicant's name in Amharic on a plain English keyboard (phonetic typing).
8. The bureau admin **changes the form live** (adds a field) and publishes; the next application shows it, while the old one
   keeps its version.
9. The leadership dashboard: cases, SLA, revenue per office, all from what was just done.
10. The audit trail of the case: every step, who and when.

## 8. Commercial points to decide (not technical)
* **Licensing model:** per installation (region) with zones included, per product (ADR-0027 entitlements), or per-zone
  subscription. The system supports all three.
* **Local partner** for installation, training and first-line support in the region.
* **Ownership of data:** stated plainly in the contract. The data is always the bureau's, exportable at any time in open
  formats.
* **References:** the Wolaita pilot becomes the reference for other zones of the South Ethiopia Region, then other
  regions.

Sources: [MESOB (Fayda/NIDP page)](https://id.gov.et/mesob), [Digital Ethiopia 2030 approval](https://shega.co/news/ethiopias-ministerial-council-approves-digital-2030-strategy),
[interoperable digital government](https://shega.co/news/ethiopia-gears-up-for-interoperable-digital-government),
[Amharic text-line OCR (Applied Sciences 2020)](https://doaj.org/article/f9807535c08a468586a6979c4612533f),
[Ge'ez handwriting recognition (2024)](https://arxiv.org/pdf/2411.13350).
