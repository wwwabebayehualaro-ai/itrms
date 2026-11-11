# 2026-11-11 · Wolaita Zone: first written answers to the business questions

| | |
|---|---|
| **Organisation** | Wolaita Zone Transport and Road Development Administration Department (the reference design, not a customer) |
| **Questions** | [`ITRMS-business-questions-am.pdf`](../business-questions/ITRMS-business-questions-am.pdf), version 1.0 (ጥቅምት 15 ቀን 2019 ዓ.ም.) |
| **Received** | 2026-11-11 (ኅዳር 2 ቀን 2019 ዓ.ም.): 39 phone scans (CamScanner). One sheet is dated 17/2/2019 E.C. (2026-10-27). |
| **Form** | Handwritten Amharic: in the printed questionnaire's answer boxes, and on added sheets that the respondents numbered |
| **Who answered** | Several directorates, each in its own hand (roles below). Two sheets are signed. No names are recorded here, and the scans stay out of the repository because they carry signatures (see [the README](../business-questions/README.md)). |
| **Status** | **Partial.** Questions 11, 12, 13, 16, 17 and 19 have answers, plus some unprompted notes. Questions 1–10, 14, 15, 18 and 20–23 have none in this batch. |

## How to read this record

- **Numbers:** the questions are numbered **as printed** (1–23), the way the respondents numbered them. The generator
  (`build/questions-am.cjs`) keeps its own internal numbers. The two differ from question 6 on:

  | Printed | Generator | Printed | Generator |
  |---|---|---|---|
  | 6 | 7 | 15 | 17 |
  | 7 | 8 | 16 | 18 |
  | 8 | 9 | 17 | 19 |
  | 9 | 10 | 18 | 20 |
  | 10 | 12 | 19 | 21 |
  | 11 | 13 | 20 | 22 |
  | 12 | 14 | 21 | 23 |
  | 13 | 15 | 22 | 25 |
  | 14 | 16 | 23 | 26 |

- **Confidence of the reading:** each answer is marked **H** (clear), **M** (mostly legible) or **L** (hard to read,
  likely wrong in details). **Amounts and counts marked M or L are not configuration.** They must be confirmed against an
  official copy before a fee rule, a seed or a demo uses them.
- **"Design impact"** sets the answer against the current design. A conflict with an accepted ADR is raised as a
  decision for the product owner (end of this file). This record does not reopen the ADR by itself.

## Who answered (roles)

| Hand | Role (directorate) | Covers |
|---|---|---|
| 1 | Driver and vehicle competency directorate (vehicle registration side) | Q11, Q12, Q13, the plate codes, a fee sheet |
| 2 | Driver and vehicle competency directorate (licensing side) | An unprompted overview of the licence services (pages A–E) |
| 3 | Community participation | A short unprompted note |
| 4 | Road traffic safety directorate | Q16, signed |
| 5 | Road sector (construction and maintenance) | Q17, and Annex B rows 30–37 |
| 6 | Process owner (stakeholders) | Q19, signed |

---

## Q11 · Vehicle registration, plates and transfer (DVC-01, DVC-05, ownership transfer)

**11.1 Who registers, and with which documents (M).**
- Who registers: the competency offices (zone and town).
- Documents:
  - **All vehicles:** the application, the purchase evidence, and the owner's **Fayda ID** and photo.
  - **Imported vehicles:** the **customs declaration**, the **Bill of Lading**, the **commercial invoice**, the **packing
    list**, the declaration number and the removal (release) paper.
  - **Insurance:** the insurance letter or policy.
  - **Businesses:** the **trade licence**, the **TIN** and the tax papers.
- Design impact: DVC-01's request form (task 1.2b) asks for the customs declaration, the purchase evidence, the owner's
  ID and the insurance certificate. **To add:** the import shipping documents and, for businesses, the trade licence and
  TIN. All are attachments, so this is a configuration change.

**11.2 Plates (M).**
- Plates are **supplied by the federal Ministry of Transport and Logistics**.
- Numbers are given in sequence.
- Damaged plates are recorded with a report.
- Design impact: **confirms** the federal plate stock (task 1.2a, `plates.source = federal`) and the next-free-plate rule
  of 1.2b. The damaged-plate report fits the existing write-off with a reason.

**11.3 The libre (M).**
- The **libre is printed by the federal ministry**.
- A lost libre is replaced after a police letter and a newspaper notice published 15 days before.
- A new libre is issued once 11.1's requirements are met.
- Design impact: this **challenges [ADR-0049](../decisions/0049-libre-as-itrms-document.md)**. The ADR's default is that
  ITRMS issues the libre as its own numbered document. The ADR already provides the fallback: an office that issues
  pre-printed booklets records each booklet's serial instead. → Decision D1.
- The lost-libre rules (police letter, 15-day newspaper notice) belong to replacements, task 1.5.

**11.4 Ownership transfer (M; percentages L).**
- **Sale documents:** the application, a sale contract **authenticated by the documents authentication office (DARA)**,
  the seller's and the buyer's Fayda IDs, the libre, the fee receipt, a tax clearance and a photo.
- **Inheritance or gift:** a court decision or the authenticated deed, the libre and the IDs.
- **Taxes:** paid to the revenue office before the transfer: a stamp duty and a transfer tax, by percentages of the
  value. The figures (about 2% and 4%, with 0.5% elsewhere) are **L**.
- Design impact: task 1.4.
  - The case holds a **revenue clearance** as evidence; ITRMS does not compute the revenue office's taxes.
  - `ACQUIRED_BY` already has `sale`, `inheritance`, `gift` and `court_order`.

**11.5 Leaving or entering the zone (M).**
- The file is sent to the receiving office with a covering letter, and that office is told by letter.
- The fee is **2,000 Birr** (M).
- The documents are as for 11.1.
- Design impact: task 1.4 (zone transfer out/in): a linked case and a handing-over letter.
  - A transfer between two offices that both run ITRMS needs no paper.
  - The letter stays for an office without ITRMS.

**11.6 and the separate fee sheet: fees (M to L).**
- The sheet dated 17/2/2019 and page 6 list amounts:
  - **Plate fees** by plate code: code 3 → 6,070; code 2 (private) → 5,161; trailer → 15,030.
  - **Registration:** 5,437.
  - **New libre:** 2,000.
  - **Lost libre** and **other libre services:** 1,000 to 1,500.
  - **Zone transfer:** 2,000.
  - **Name change:** 1,000 (L).
- Several lines are **L**.
- Design impact: the `dvc-01-registration` demo rule (task 1.2b) uses placeholder amounts and stays marked `demo`. The
  real schedule needs the legal basis (Q2, not answered yet) and a typed copy. → Request R2.

**11.7 How many vehicle files (M).**
- Ranges by plate code:

  | Plate code and type | Files |
  |---|---|
  | Code 1, bajaj (three-wheelers) | 35,000–50,000 |
  | Code 1, taxis | 180–300 |
  | Code 2, motorcycles | 80,000–120,000 |
  | Code 2, cars | 1,000–2,000 |
  | Code 3, cars | 15,000–20,000 |
  | Code 3, motorcycles | 10,000–20,000 |
  | Code 4, cars | 1,580–2,500 |
  | Code 4, motorcycles | 20,000–30,000 |
  | Code 5, cars | 1,200–3,000 |
  | Code 5, motorcycles | 2,500–4,000 |
  | Trailers | 2,000–3,000 |

- **All are on paper.**
- Design impact:
  - Roughly **170,000–250,000 paper vehicle files**, about two-thirds of them motorcycles and bajajs. That is the size of
    the back-capture work (task 1.13) and of the plate-exchange campaign (task 1.2c).
  - The NFR sizing and the perf test (10^6 rows) cover it.

**Plate codes (unprompted; M).** The respondents listed the old regional plate codes:

| Code | Use | Vehicles |
|---|---|---|
| 1 | Public transport | Bajaj, taxi |
| 2 | Private | Motorcycle, car |
| 3 | Commercial (business, association) | Motorcycle, car, truck |
| 4 | Government | Motorcycle, car |
| 5 | International NGO | Motorcycle, car |
| 35 | Local NGO (L) | Motorcycle, car |
| Police | Police | — |
| Defence (L) | Defence | — |
| Special | — | Tractors, excavators, loaders, rollers |

- What each code records:
  - **Codes 1, 2 and 3, a person:** name, address, Fayda ID, photo.
  - **Code 3, a business:** trade licence.
  - **Code 4:** a letter from the government body.
  - **Codes 5 and 35:** the organisation's name.
- **Encumbrances (ዕገዳ)** are recorded on a vehicle: a bank loan, a court order, revenue or customs.
- Design impact: `VEHICLE_USES` already covers these uses (`public_transport`, `private`, `commercial`, `government`,
  `international_org`, `ngo`, `police`, `defence`).
  - "Special" is a vehicle category (`machinery`), not a use.
  - **Encumbrances are not modelled yet.** A vehicle under a bank loan or a court order must not be transferred → a
    follow-up for task 1.4.

## Q12 · Technical inspection and bolo (DVC-02)

**12.1 (M).** The zone has **one technical inspection station** (L: private).

**12.2 (M).**
- A checklist and a result register exist.
- A vehicle that fails is sent to a garage for repair and comes back.

**12.3 Before a bolo (M).** The proofs required depend on the plate code:

| Plate code | Required before the bolo |
|---|---|
| 1 | Road fund payment, third-party insurance, the driver's licence, the inspection receipt |
| 3 | The same |
| 2, 4, 5, NGO | Insurance, licence and inspection, without the road fund payment |

**12.4 (M).**
- The bolo sticker has a **serial number**. Who prints it is **L**: possibly the ministry or the insurers.
- A lost bolo is replaced on a police letter and an application, for a fee of **1,000–1,500 Birr**.

**12.5 Bolo fee (M).** The fee varies by plate code, tonnage and seats:

| Vehicles | Fee (Birr) |
|---|---|
| Codes 1 and 2 (cars and motorcycles) | 1,000 |
| Code 3, 1–12 t | 1,000 |
| Code 3, 13–44 t | 1,500 |
| Code 3, over 44 t | 2,000 |
| Buses, 1–35 seats | 1,500 |
| Buses, up to 62 seats | 2,000 |
| Codes 4 and 5, police, defence, NGO | 1,500 |

**12.6 (L).** Inspection results are reported to the region monthly, quarterly, half-yearly and yearly.

**Design impact for Q12:**
- Task 1.3:
  - A checklist form per vehicle category.
  - Prerequisite proofs that **depend on the vehicle's use (plate code)**.
  - A fee table by use, tonnage and seats. The fee engine's table lines and conditions already do this.
  - A failed result with a re-inspection.
- Task 1.12a: the sticker serials (controlled stationery).

## Q13 · Training institutions (DVC-07, task 1.7)

**13.1 (M).**
- The institutions' operating licence is **issued and renewed by the regional transport bureau**; the zone follows them
  up.
- Requirements:
  - **Staff:** a manager with a degree, trainers with a diploma or degree and their own licence, a technical trainer,
    a secretary and a cashier.
  - **Premises:** classrooms, an office, a store, a computer room, a library, a practice area and toilets.
  - **A training vehicle for each licence grade, at most 10 years old (L).**
- Renewal and follow-up check:
  - For each vehicle: its bolo, insurance, road fund payment, technical inspection and libre copy.
  - For each trainer: the licence copy, the certificates and the experience.
  - The ratio of vehicles to trainers.

**13.2 (M).**
- Institutions are inspected **twice a year** against a checklist.
- Sanctions are graduated: a first written warning, a second warning, a suspension, then cancellation (L).

**13.3 and 13.4 (M).**
- Institutions send their **trainee lists by letter** before the exam, and the office sets the exam schedule.
- The theory exam is taken on computer (L).
- **Capacity per day: 50–70 theory and 30–50 practical candidates.**

**Licence grades (M).** As listed by the respondents:
- Motorcycle.
- Taxi-1 (bajaj).
- Taxi-2 (up to 8 people).
- Automobile (up to 12).
- Public-1 (24 seats), public-2 (44) and public-3 (over 44).
- Dry cargo 1, 2 and 3 (trailers).
- Liquid 1 (up to 12,000 l) and liquid 2 (over 12,000 l).
- Special.

**Design impact for Q13:**
- Task 1.7: the oversight visit form, the sanctions ladder, the trainee lists and the exam session capacity.
- Licence grades: the seeded grades (`modules/competency/seed/grades.ts`) have one `taxi` and one `three-wheel`. Taxi-1
  vs taxi-2 is to be confirmed against Proclamation 1074/2018 before the grades change.

**Licence numbers (M).** Numbers are given **by region code, then a sequence**: "06-00001", where 06 is South Ethiopia.
They are recorded with the name, Fayda ID, address, photo and blood group (L).
- Design impact: ADR-0047 takes the national platform's number when it issues one, and otherwise the office's gapless
  counter. "06-00001" suggests the counter pattern should start with the **region code**, with one sequence for the
  region rather than one per office. → Decision D2.

## Unprompted · The licence services (pages A–E, M to L)

The licensing side listed its services:
- New licence after training.
- Foreign licence converted to an Ethiopian one.
- Licences for foreign nationals, new and renewed.
- Renewal.
- Grade upgrade (after a waiting period, L: 2 years).
- Replacement of a lost licence (police letter, licence number, Fayda ID, photo, fee).
- International driving permit (L).
- Verification of a licence.
- Suspension and cancellation, by a court or the traffic police (L).

The card shows:
- Name, sex, nationality, date of birth, address and blood group (L).
- Photo.
- Issue, renewal and expiry dates.
- Grade and number.
- **A QR code** and a signature.

A health certificate from a recognised institution (eyes and hearing, L) is required for a new licence and for renewal.

**Design impact:**
- These match the DVC services in [service-catalogue.md](../service-catalogue.md) and task 1.6.
- The card's QR **confirms** the QR verification design (ADR-0006, ADR-0045).
- Blood group is a new field to confirm: it is health data, so if kept it is sensitive (field-encrypted, revealed through
  `reveal()`).

## Q16 · Road traffic safety (signed; mostly L)

**16.1 (L).**
- Routine and sudden controls are carried out by the road traffic safety directorate with the traffic police.
- Findings are recorded on a form; a regulation number (read "557/16", L) is cited.

**16.2 (L).**
- Charges against drivers are written by the traffic police.
- The penalty is paid outside the department.
- The department's role is the licence records (suspension).

**16.3 (L).** The traffic police record accidents and report them to the zone and the region. The road fund and the
insurance fund receive data (L).

**16.4 (L).**
- **Traffic safety clubs** exist in schools and kebeles. The counts read as 554 and 334 overall, and 231 school and 331
  kebele clubs in 2018 E.C.
- Membership is counted by sex, with totals such as 2,572 men and 1,464 women.
- Awareness is raised through the media (radio, TV).

**16.5 (L).**
- On the federal penalty-point system: the regulation is cited, and it appears not to be in use yet.
- Challenges and proposals follow; the page is signed.

**Design impact for Q16:**
- The road-safety module (Phase 2):
  - Clubs as records with membership **counted by sex**.
  - Control findings as a form.
  - Accident data received from the police, not created by the department.
- **The regulation number must be confirmed** before any document cites it.

## Q17 · Road construction and maintenance (mostly L)

**Annex B, rows 30–37 (H).** The department **has**:
- The construction performance report.
- The payment certificate (roads and bridges).
- The advance payment document.
- The unit-rate list.
- The periodic reports to the region.

It does **not** have the tender documents. The contract documents row is blank.

**17.1–17.5 (L).**
- **Network:** the zone and the woredas manage **rural roads, community roads and roads upgraded to DC3**, and town
  roads (L).
- **Funding:** projects come from woreda and kebele requests and are funded by the road fund, the region, NGOs and the
  community.
- **Maintenance:** inspected periodically.
- **Unit rates:** priced by the **fixed rate (unit rate)** that the region sends.
- **Reporting:** physical and financial progress goes from the woredas to the zone and on to the region, monthly and
  quarterly (L).

**Design impact for Q17:**
- Confirms the design and contract module's unit rates (glossary: የቁርጥ ዋጋ) and the payment certificates.
- → Request R3 for copies of the documents marked "have".

## Q19 · Stakeholder integration (signed; mostly L)

**19.1 (L).**
- Today data is exchanged **by letter, reports and meetings**, monthly or quarterly.
- The stakeholders include the regional bureau, the traffic police, the insurers, the road fund, the woredas and towns,
  and others.

**19.2 (L).** The three most urgent to link: the traffic police, the insurers and the road fund, and revenue/finance.

**19.3 (H).** **"የለም"**: as far as the department knows, none of its stakeholders has an electronic system to connect to.

**19.4 (L).** An **MoU is needed**, signed by the department head with each stakeholder.

**19.5 (L).** **Yes:** training institutions, inspection centres, garages, insurers and associations should get limited
accounts of their own.

**Extra sheet (L).** The stakeholders in two groups:
- Government: the bureau, the police, the woredas, health, education and others.
- Others: insurers, banks, NGOs, associations and the media.

**Design impact for Q19:**
- Confirms the plan: integrations are fakes first, and the first exchanges are reports and exports.
- External partner accounts are a later phase.

## Unprompted · Community participation (L)

**Purpose:** mobilising the community's labour and money for roads.

**Recorded by kebele and woreda (16 woredas):**
- The km built with community participation.
- The value of the contributions, in cash and in kind.

**Reporting:** from the kebeles to the woredas and on to the zone.

**Design impact:** the community module (Phase 2). Contributions in kind need a valuation in santim.

---

## What this confirms in the design

1. **Plates are federal stock**, given in sequence (tasks 1.2a and 1.2b).
2. **Vehicle uses and the old plate codes** match `VEHICLE_USES` and the legacy plate setting.
3. **Records are on paper.** The back-capture tooling (task 1.13) and the plate-exchange campaign (task 1.2c) are
   central, with roughly 170,000–250,000 vehicle files.
4. **Documents carry a QR** (licence card): the verification design stands.
5. **No stakeholder has a system to connect to.** The national adapters stay fakes, and exchanges start as reports.
6. **The region sends the unit rates**, and payment certificates and advance payments are in use.

## Decisions for the product owner

- **D1. The libre (ADR-0049).** The zone says the federal ministry prints the libre.
  - Option (a): switch DVC-01's default to *record the federal booklet's serial* (the fallback the ADR already
    describes), and keep the ITRMS document only as a registration certificate.
  - Option (b): keep the ITRMS libre until a bureau confirms.
  - A new ADR is needed only if (a) is chosen.
- **D2. Licence number format.** Should the counter pattern carry the region code ("06-00001") with **one regional
  sequence**, instead of a per-office pattern (ADR-0047)?
- **D3. Blood group on the licence.** Keep it as sensitive health data (encrypted, audited reveal), or leave it out?

## Requests back to the zone

- **R1. Missing answers:**
  - Questions 1–10: forms, fees, payments, roles, the org units, the national systems, visibility, external parties,
    payroll, holidays and numbering.
  - Questions 14, 15, 18 and 20–23.
  - Pages for Q12.6 and Q16.5 that may be missing.
- **R2. Fee schedule:** a typed copy of the current fee schedule and its legal basis (Q2), to replace the readings above.
- **R3. Document copies:** the documents marked "have" in Annex B, with personal data covered:
  - The inspection checklist and result register (Q12.2).
  - The training institution checklist (Q13.2).
  - The construction performance report and the payment certificate.
  - The unit-rate list.
- **R4. Readings to confirm:**
  - The regulation cited in Q16 ("557/16").
  - The transfer tax percentages (Q11.4).
  - Who prints the bolo sticker (Q12.4).
  - Plate code 35.
  - The road-safety counts.

## Files

The scans are kept locally in `docs/business-questions/response/`, which `.git/info/exclude` keeps out of git. Their
index (scan → hand → page) is in that folder's `INDEX.md`, which is also local.
