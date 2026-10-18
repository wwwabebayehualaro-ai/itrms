# Delivery decisions: form builder or code, per service

For each of the 54 services, this records **how it is built and why**. The method is fixed by
[ADR-0030](../decisions/0030-hybrid-delivery-builder-and-code.md). The decisions are made carefully, because a zone buying
ITRMS depends on them:
* too much in the builder → money, legal rules or registries rest on configuration that a zone admin can break;
* too much in code → every directive change waits for a developer and a release.

## 1. Delivery types

| Type | Built with | Code involved | Who changes it later |
|---|---|---|---|
| **C**: configured | builder: form, workflow, fee rule, templates | none specific to the service | bureau (zones within the override policy) |
| **C+E**: configured + effects | builder for forms, steps, fees and templates | **effects** with typed input contracts ([form-platform.md](form-platform.md) §3) that write registries or money, enforce legal rules, or call national systems | bureau for everything except the contract-locked fields; developers for the effects |
| **M**: module | dedicated screens for planning, grids or batches; **builder forms for intake and simple steps** | module services and screens | developers (screens), bureau (the forms inside) |
| **R**: report / data product | generated from existing data; a small builder form only for narrative or sign-off | report definition (`reports` module) | developers (definition), bureau (layout and narrative form) |
| **P**: platform | a shared capability used by many services | platform code | — |

## 2. Decision criteria (asked in this order; the first decisive answer wins)

| # | Question | If yes |
|---|---|---|
| 1 | Is the output a report or data product computed from existing records, with no new data entry? | **R** |
| 2 | Does the work need **many records at once** (a grid, a plan, a batch, a timetable, a BOQ, a payroll list), or conflict checks across records? | **M** (intake forms still from the builder) |
| 3 | Does it compute or move **money beyond a fee rule** (certificates with retention or advance recovery, payroll, rentals with hours)? | **M** |
| 4 | Does it **create or change a registry record**, enforce a **legal eligibility rule**, collect a fee, or call a **national system**? | **C+E** |
| 5 | Otherwise (records an activity, a visit, a campaign, an inspection without legal effect) | **C** |

Secondary factors, which never override a "yes" above but tip close cases:
* **Variability:** does the form differ between regions or change with directives? That favours the builder for the form
  part.
* **Volume and speed:** high-volume counter work needs keyboard-fast forms; the builder renderer must meet G9.
* **Legal weight of the output:** issued documents always go through the `documents` platform, whatever the type.

## 3. The 54 services

PT = public transport, RS = road safety, DVC = driver and vehicle competency, FR = freight, RQ = road quality,
DC = design and contracts, CP = community participation, LG = logistics, HR = human resources, PB = plan and budget.

| Code | Service | Type | Deciding criterion | Builder part | Code part |
|---|---|---|---|---|---|
| PT-01 | New terminals and ownership plans | C+E | 4: creates a terminal record | proposal form, site documents, approval steps | `publicTransport.registerTerminal` |
| PT-02 | New inter-zone / zone–woreda routes | C+E | 4: route registry | route request form, survey attachments | `publicTransport.openRoute` |
| PT-03 | Organise new taxi associations | C+E | 4: association registry | application, member list (rows), documents | `associations.register` |
| PT-04 | Annual association renewal | C+E | 4: registry + fee | renewal form, member updates | `associations.renew` (+ fee rule) |
| PT-05 | Town taxi routes and tariffs | M | 2: tariff tables (versioned, per route and distance), regional approval | study request form | tariff editor and approval |
| PT-06 | Monthly schedule approval | M | 2: timetable grid with conflict checks | submission cover form | schedule grid, conflict rules |
| RS-01 | Awareness campaigns | C | 5 | campaign report (channels, reach, photos) | — |
| RS-02 | School and kebele safety clubs | C | 5 | club registration and activity forms | — |
| RS-03 | Zebra crossings | C | 5 | request, painting record (location, photo) | — |
| RS-04 | Routine inspections | C | 5 | inspection form (checklist, joint police officers) | — |
| RS-05 | Surprise inspections | C | 5 | as RS-04 | — |
| RS-06 | Traffic fines collection | C+E | 4: money + national penalty system | ticket capture form | `roadSafety.recordFine` (+ fee, + adapter) |
| RS-07 | Accident records and sharing | C+E | 4: typed accident data shared with police, insurers, the insurance fund | accident form (vehicles and persons as rows, injuries, damage) | `roadSafety.recordAccident`, sharing exports |
| DVC-01 | Vehicle registration and plates | C+E | 4: registries + national registry | application form, documents | `vehicles.register`, plate allocation, national adapter; **plate stock screen (M part)** |
| DVC-02 | Technical inspection and bolo | C+E | 4: registry + document | inspection **checklist** form (per vehicle category) | `vehicles.recordInspection`, bolo validity rule |
| DVC-03 | New driver licence | C+E | 4: legal eligibility (Proclamation 1074/2018) + registry + national platform | application, documents, step forms | eligibility guard, `competency.createPendingLicence` / `activateLicence` |
| DVC-04 | Licence renewal | C+E | 4: as DVC-03 | renewal form | validity rule (4 years, 2 years over 55), late-renewal branch |
| DVC-05 | Transfer out of the zone | C+E | 4: registry handling unit | transfer request | `vehicles.transferOut` / `transferIn` |
| DVC-06 | Replacement of a lost libre, bolo or plate | C+E | 4: supersedes documents | replacement request, police report upload | `documents.supersede`, `vehicles.replace…` |
| DVC-07 | Training-school oversight | C+E | 4: school compliance status | oversight **checklist** form | `drivers.recordSchoolCompliance` |
| DVC-08 | International licence (federal issue) | C+E | 4: forwards to the federal Authority | application form | `competency.forwardInternational` (adapter) |
| DVC-09 | Service fee collection | P | — | — | `fees` platform |
| DVC-10 | Theory and field exams | M | 2: exam sessions, capacity, bulk result entry | readiness list submission form | session scheduler, result grid |
| DVC-11 | Licence print batches and distribution | M | 2: batches of many licences | — | batch screen (select, send, receive, distribute) |
| FR-01 | Freight competency certificate, new | C+E | 4: certificate + registry | application, inspection | `freight.issueCertificate` |
| FR-02 | Certificate renewal | C+E | 4 | renewal form | `freight.renewCertificate` |
| FR-03 | Freight association renewal | C+E | 4 | renewal form | `associations.renew` |
| RQ-01 | Kebele access road works | M | 2: project quantities and progress over time | progress report form | project progress module |
| RQ-02 | Construction supervision | C+E | 4: non-conformities tracked against a project | supervision visit form (checklist, photos, GPS) | `roadAssets.recordSupervision`, NC follow-up |
| DC-01 | Road project designs | C+E | 4: design record linked to a project | design submission and approval form | `roadAssets.recordDesign` |
| DC-02 | Contract documents | M | 2–3: contract with BOQ lines and amounts | — | contract and BOQ editor |
| DC-03 | Contract award | M | 2: bids/award over a contract | award decision form | award screen |
| DC-04 | Design and supervision unit rates | M | 2: rate catalogue (versioned table) | — | rate editor, import from the bureau |
| DC-05 | DC3 upgrade identification | C+E | 4: marks road assets for upgrade | assessment form | `roadAssets.markForUpgrade` |
| DC-06 | Bridge works payment documents | M | 3: payment certificate maths | — | certificate module |
| DC-07 | Advance payment documents | M | 3: advance and recovery schedule | — | certificate module |
| CP-01 | Routine maintenance by the community | C | 5 | activity form (labour days, materials, photos) | — |
| CP-02 | Periodic maintenance by the community | C | 5 | as CP-01 | — |
| CP-03 | Valuing participation in Birr | C+E | 4: computed money value recorded | valuation form | valuation rule (santim) + `community.recordValue` |
| CP-04 | Capital budget allocation | M | 2: allocation across woredas and projects | — | allocation module |
| CP-05 | Stakeholder participation | C | 5 | contribution record form | — |
| LG-01 | Job creation | C | 5 | job record form | — |
| LG-02 | Tree planting | C | 5 | planting record (location, count, species) | — |
| LG-03 | Machinery rental | M | 3: hours × rates, overlap checks, invoices | rental request form | rental module |
| HR-01 | Staffing (Form 15) | M | 2: establishment tables | hiring request form | position and staff module |
| HR-02 | Annual leave | C+E | 4: balance rules | leave request form | `hr.applyLeave` (balance, carry-over) |
| HR-03 | Benefits | C | 5 | benefit request form | — |
| HR-04 | Monthly payroll list to Finance | M | 2–3: payroll list | — | payroll module (ADR-0016) |
| HR-05 | Staff data to the civil service | R | 1 | sign-off form | report definition |
| HR-06 | Retirement processing | C+E | 4: status change + pension agency file | retirement case form | `hr.retire`, export |
| PB-01 | Annual budget | M | 2: budget lines | — | budget module |
| PB-02 | Quarterly performance report | R | 1: generated from operational data | narrative and sign-off form | report definition |
| PB-03 | Annual procurement plan | M | 2: plan lines | — | procurement plan module |
| PB-04 | Capital project physical performance | R | 1: from project progress data | narrative form | report definition |

**Totals:** C 11 · C+E 23 · M 16 · R 3 · P 1 = 54. The builder is used in **50 of the 54** services (all but DVC-09,
DVC-11, DC-02 and DC-04, whose work is entirely grids or tables).

## 4. Revisiting a decision
* A decision is changed by updating this table, with the reason, in a reviewed PR (a new ADR if the criteria change).
* **C → C+E → M upgrades keep data:** submitted answers stay readable (G3), and the new code reads them.
* Triggers to revisit:
  * a zone needs a rule the builder can't express safely;
  * a form's error rate (from form analytics) stays high;
  * a national system starts owning the data.
