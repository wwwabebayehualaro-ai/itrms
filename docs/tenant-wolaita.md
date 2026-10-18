# First customer: Wolaita Zone

**Wolaita Zone** (ወላይታ ዞን), in the **South Ethiopia Regional State** (ደቡብ ኢትዮጵያ ክልል), is the **reference design** and the main
demo tenant: its documents are the real material ITRMS is modelled on. It is **not a customer**. ITRMS is a self-built
product for bureaus across Ethiopia ([go-to-market.md](go-to-market.md)). The languages are Amharic, English and
**Wolaytta** (Wolaytattuwa).

Sources: **[D]** `Documents/` (service list `.docx`, 25 Form 15 scans dated 10/07/2018 E.C., 5 photos) · **[N]**
[ethiopia-context.md](ethiopia-context.md) · **[A]** assumption, to be confirmed with the zone department.

## 1. Who is who

| Body | Amharic | Role in ITRMS | Source |
|---|---|---|---|
| South Ethiopia Regional State Transport and Road Development **Bureau** | የደቡብ ኢትዮጵያ ክልል ትራንስፖርትና መንገድ ልማት አስተዳደር ቢሮ | **Region** unit and owner of the installation (bureau defaults for services, fees, templates). Issues directives, tariffs and unit rates; supplies plates; prints licences; collects some fees | [D] stamps on every scan; service list stakeholders |
| Regional Civil Service Commission | የደቡብ ኢትዮጵያ ክልል ሲቪል ሰርቪስ ኮሚሽን | External. Approves the Form 15 staffing tables (HR, Phase 3) | [D] stamps and signatures on Form 15 |
| Wolaita Zone Transport and Road Development **Department** | ወላይታ ዞን ትራንስፖርትና መንገድ ልማት አስተዳደር መምሪያ | **Zone** unit: the department that delivers the 54 services | [D] service list title; Form 15 headers |
| Woreda Transport and Road Development **Offices** | … ወረዳ ትራንስፖርትና መንገድ ልማት አስተዳደር ጽ/ቤት | **Woreda** units, with a category (ምድብ 1, 2, …) | [D] Damot Gale cover: "ምድብ 1 ወረዳ" |
| Town administration Transport and Logistics **Units** | … ከተማ አስተዳደር ትራንስፖርትና ሎጂስቲክስ (አገልግሎት) ዩኒት | **Town** units, graded by **ፈርጅ** (1–4) | [D] covers: Boditi ፈርጅ 1, Gesuba ፈርጅ 3, Bitena ፈርጅ 4 |
| Wolaita Zone Finance (and Plan) Department | የዞኑ ፋይናንስና ፕላን መምሪያ | External. Receives the payroll list and plans; pays (ADR-0016) | [D] service list stakeholders |

Signatories on Form 15: prepared by the bureau's HR development directorate director, checked by a Commission job-evaluation
expert, approved by the Commission's payment director **[D]**. ITRMS models this approval chain for staffing changes in Phase 3.
Names are not recorded here.

## 2. Org tree (seed for task 0.8)

Level definitions for the South Ethiopia region: `region` (ክልል) > `zone` (ዞን) > `woreda` (ወረዳ) | `town` (ከተማ አስተዳደር).
Woredas and towns are siblings under the zone **[D]**. A town of level 1 may have sub-cities or kebele-level units; that is not
needed for the demo **[A]**.

The zone's official site lists **16 woredas** and **7 urban administrations**. The urban administrations are "considered as
districts for all administrative purposes", so they sit beside the woredas under the zone, even when a town is the seat of a
woreda ([wolaita.gov.et/en/structure](https://wolaita.gov.et/en/structure/),
[addresses](https://wolaita.gov.et/en/addresses/)) **[N]**.

| # | Unit | Kind | Seat | Category / grade | Source |
|---|---|---|---|---|---|
| — | South Ethiopia Regional State bureau | region | Wolaita Sodo | — | [D] [N] |
| — | Wolaita Zone department | zone | Wolaita Sodo | — | [D] |
| 1 | Abala Abaya | woreda | Faracho | ? | [N] |
| 2 | Bayra Koysha | woreda | Beklo Segno | ? | [N] |
| 3 | Boloso Bombe | woreda | Bombe | ? | [N] |
| 4 | Boloso Sore | woreda | Areka | ? | [N] |
| 5 | **Damot Gale** (ዳሞት ጋሌ) | woreda | Boditi | **category 1** (ምድብ 1 ወረዳ) | [D] [N] |
| 6 | Damot Pulasa | woreda | Shanto | ? | [N] |
| 7 | Damot Sore | woreda | Gununo | ? | [N] |
| 8 | Damot Weyde | woreda | Bedessa | ? | [N] |
| 9 | Diguna Fango | woreda | Bitena | ? | [N] |
| 10 | Hobicha | woreda | Bada | ? | [N] |
| 11 | Humbo | woreda | Tebela | ? | [N] |
| 12 | Kawo Koysha | woreda | Lasho | ? | [N] |
| 13 | Kindo Didaye | woreda | Halale | ? | [N] |
| 14 | Kindo Koysha | woreda | Bale Hawassa | ? | [N] |
| 15 | Offa | woreda | Gesuba | ? | [N] |
| 16 | Sodo Zuria | woreda | Sodo | ? | [N] |
| 17 | **Wolaita Sodo** city administration | town (city) | — | ? (zone and regional capital) | [N] |
| 18 | Areka town administration | town | — | ? | [N] |
| 19 | **Boditi** town administration (ቦዲቲ) | town | — | **ፈርጅ 1** | [D] [N] |
| 20 | Gununo (Hamus) town administration | town | — | ? | [N] |
| 21 | Tebela town administration | town | — | ? | [N] |
| 22 | Bale Hawassa town administration | town | — | ? | [N] |
| 23 | **Gesuba** town administration (ገሱባ) | town | — | **ፈርጅ 3** | [D] [N] |
| 24 | **Bitena** town administration (ቢጠና; seat of Diguna Fango) | town | — | **ፈርጅ 4** | [D] only; not on the zone site's list of 7 |

**Corrections from the full scan review (2026-10-18):**
- **More towns exist.** The zone site lists 7 urban administrations, but the scans also include **Bitena (ፈርጅ 4)**.
  Lower-grade towns (ፈርጅ 3–4) have their own transport units, so the real list is longer than 7, and the org seed must let
  the zone add towns.
- **Town grade is "ፈርጅ"; woreda category is "ምድብ"** (cover pages). Both are stored in `org_units.category`.
- **Wolaita Sodo city may sit directly under the region.** The handwritten structure chart (photo `21-23-25`) shows two
  branches under the regional bureau:
  - **zone departments**, with town units and woreda offices below them;
  - **city-administration transport and logistics departments**, with sub-city and kebele levels below them.

  This is to be confirmed (business question 5).

Still open [A]:
- the official Amharic spellings (the table uses the zone site's English spellings);
- the category of the other woredas and the grade of the other towns (known so far: Damot Gale, Boditi, Gesuba, Bitena);
- whether Wolaita Sodo has sub-cities, and whether it reports to the zone or the region.

The zone confirms these in the org-tree admin screen (task 0.8).

The seed is a data file (`apps/api/seed/org/south-ethiopia.wolaita.yaml`), not code. The automated isolation tests also use a
synthetic second zone ("Test Zone B"), which is never shown in the demo.

## 3. Directorates and teams (from Form 15) [D]

Form 15 lists the approved positions per organisational unit. It shows which work processes exist at which level, and this
decides the **handling level** of each service (see [service-catalogue.md](service-catalogue.md)).

All 25 scans and 5 photos were read on 2026-10-18; the index is at the end of this section. Grades are Form 15 grades
(I–XV). Each table pairs "the position as it is now" with "the new position". **Form 15 is therefore a restructuring
table:** it maps every old position to a new title and job code, dated 10/07/2018 ዓ.ም.

**Zone department** (job codes `16/ወሶ-1` … `16/ወሶ-81`):

| Team | Amharic | Process | Positions (grade), codes | Scan |
|---|---|---|---|---|
| Head and support | መምሪያ ኃላፊ (by appointment) and support | 9, 10 | department head; secretary, HR, plan and budget, finance, records, ICT, drivers, guards, cleaners (I–XIII); 1–25 | 17.02, 17.02 (1) |
| Road traffic safety | የመንገድ ትራፊክ ደህንነት | 4 | process coordinator XIV; competency/control experts III XII ×2; education and training expert III XII ×2; support and data expert III XI; 26–31 | 17.03 |
| Public transport | የህዝብ ትራንስፖርት አገ/ብቃ/ማረ/ ዳይሬክቶሬት | 2 | directorate head XIV; route and monitoring experts IV XIII ×2; town transport coordination expert IV XIII; 32–35 | 17.03 (1) |
| Driver and vehicle competency | የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ ቡድን | 1 | **team leader XV**; licensing and control experts III XII, II XI; training-institute assurance expert IV XIV; data experts III XI, II X; driver/vehicle quality experts III XI, II IX; records VIII ×2; vehicle competency control expert II X; **vehicle inspection institutions assurance expert IV XIV**; 36–48 | 17.04 |
| Freight transport | የጭነት ትራንስፖርት | 3 | zone/town driver competency team coordinator (freight) XIV; freight capacity study expert IV XII; town transport and freight logistics expert III XII; 49–51 | 17.04 (1) |
| Road quality control | የመንገድ ጥራት ቁጥጥር | 5 | road quality and safety audit team leader (engineer) XV; road quality engineers IV XV, III XIII, II XI; road asset engineer III XIII; assistant engineers III IX ×2; surveyor II X; 52–59 | 17.04 (2) |
| Design and contract management | የዲዛይንና ኮንትራት አስተዳደር | 6 | team leader XV; design and contract engineer IV XV; construction engineers III XIII, II XI; hydrologist XIII; bridge engineer II XI; surveyor III XII; 60–66 | 17.05 |
| Logistics supply | የሎጂስቲክስ አቅርቦት | 8 | team leader XIV; logistics expert XIII; data and documentation expert XII; **machinery and vehicles supply team leader XIII**; mechanical engineer XIII; auto mechanic IX; dozer, grader and excavator operators IX; loader operator VIII; driver VIII; 67–77 | 17.06 |
| Community participation | የህዝብ ተሳትፎና ባለድርሻ አካላት | 7 | team leader XIV; experts XIII ×2; resource mobilisation expert XI; 78–81 | 17.06 (1) |

**Damot Gale woreda office** (ምድብ 1; job codes `16/ወሶ/06-1` … `06-45`):

| Team | Process | Positions (grade), codes | Scan |
|---|---|---|---|
| Head and support | 9, 10 | office head; secretary VII; HR team leader XIII and expert XII; plan and budget team leader XIII and expert XII; finance expert; records team leader X and officer VI; women and social inclusion team leader XIV; ICT expert XI; gardener, messenger, guards ×3, cleaner; 1–16 | 17.07 (1) |
| Road traffic safety | 4 | team leader XIV; experts XII, XII, XI; 17–20 | 17.07 (2) |
| Public transport | 2 | team leader XIII; officers IX ×2; 21–23 | 17.08 |
| Road quality control | 5 | road quality and safety audit team leader (engineer IV) XV; road quality engineer II XI; road asset engineers III XIII, II IX, VIII; 24–28 | 17.08 (1) |
| Design and contract management | 6 | team leader (engineer IV) XV; construction engineers II XI, II IX; surveyor I VIII; 28–32 | 17.08 (2) |
| Logistics supply and administration | 8 | team leader XIV; expert XII; data expert XI; auto mechanic IX; **dozer, grader and excavator operators IX; loader operator VIII; driver VIII**; 33–41 | 17.08 (3) |
| Community participation | 7 | team leader XIV; experts XIII ×2; resource mobilisation expert IX; 42–45 | 17.09 |

The woreda has **no driver/vehicle competency, freight or licensing positions**. It does run road safety, public transport,
**road works** (quality, design and contract, machinery) and community participation.

**Boditi town Transport and Logistics Service Unit** (ፈርጅ 1; job codes `16/ቦዲቲ-ከ/አስ-01` … `28`):

| Team | Process | Positions (grade), codes | Scan |
|---|---|---|---|
| Road traffic safety | 4 | coordinator XIV; competency/control experts III XII ×2; education expert III XII; data expert III XI; 01–05 | 17.10 (1) |
| **Driver and vehicle competency** | 1 | **team leader XV**; licensing and control expert II X; training-institute assurance expert IV XIV; data experts III XI ×2; quality expert II IX; records VIII; vehicle competency control expert II X; **vehicle inspection institutions assurance expert IV XIV**; 06–14 | 17.11 |
| Freight transport | 3 | competency team coordinator (freight) XIV; town transport and freight logistics expert III XII; 15–16 | 17.11 (1) |
| Public transport and terminal | 2 | team leader XIII; officers IX ×2; town transport study and monitoring expert VIII; **daily revenue collectors (የእለት ገንዘብ ሰብሳቢ) VII ×2**; **terminal security guards IV ×6**; 17–28 | 17.11 (2) |

**What this means for ITRMS (it corrects earlier assumptions):**
1. **A ፈርጅ-1 town handles driver and vehicle competency itself.** Boditi has a full competency team, including vehicle
   inspection. The earlier assumption ("woredas and towns take applications, the zone decides") is **wrong for towns**.
   The default is now:
   - competency services are handled by the **zone department or by a town unit that has a competency team**;
   - **woredas do not handle them** (they have no such positions);
   - who gives the final approval for a town's cases (its team leader, or the zone) remains a business question.
2. **Towns collect fees locally.** Boditi has daily revenue collectors and terminal guards, so a town is a cash-collecting
   unit and runs a terminal.
3. **Woredas run road works.** Road quality engineers, design engineers and machinery operators sit at Damot Gale, so
   road-quality, design and contract, logistics (machinery) and community services can be handled at woreda level.
4. **Freight competency** exists at the zone and at ፈርጅ-1 towns.
5. **Structure** (from the handwritten charts, photos `21-23-25` and `21-23-30`; partly legible, to confirm):
   - The **regional bureau** has a head and **two deputy heads**:
     - a **transport sector**: competency, road safety, public transport, freight;
     - a **road sector**: design and contract, logistics supply, road quality, community participation.
   - Below the bureau: the zone departments, and the city-administration transport and logistics departments (with sub-city
     and kebele levels).
   - Below a zone: town transport and logistics units (Boditi, Areka, …) and woreda offices (Damot Gale, …).
   - Photos `21-23-17` and `19-34-57` list the support positions that report directly to the department head: secretary,
     driver, records, HR, planning, finance, ICT, HIV/AIDS focal person, procurement, women's affairs, gardener, messengers,
     guards, cleaner.
   - Photo `21-23-35` is an identical copy of `21-23-17`.

**Scan index** (`Documents/forms/CamScanner 10-13-2026 …`):

| File | Unit | Content |
|---|---|---|
| 17.02, 17.02 (1) | Zone | Head and support staff (1–25) |
| 17.03 | Zone | Road traffic safety |
| 17.03 (1) | Zone | Public transport |
| 17.04 | Zone | Driver and vehicle competency |
| 17.04 (1) | Zone | Freight transport |
| 17.04 (2) | Zone | Road quality control |
| 17.05 | Zone | Design and contract management |
| 17.06 | Zone | Logistics supply |
| 17.06 (1) | Zone | Community participation |
| 17.07 | Damot Gale | Cover: ምድብ 1 ወረዳ |
| 17.07 (1) | Damot Gale | Head and support |
| 17.07 (2) | Damot Gale | Road traffic safety |
| 17.08 | Damot Gale | Public transport |
| 17.08 (1) | Damot Gale | Road quality control |
| 17.08 (2) | Damot Gale | Design and contract management |
| 17.08 (3) | Damot Gale | Logistics supply and administration |
| 17.09 | Damot Gale | Community participation |
| 17.10 | Boditi | Cover: ፈርጅ 1 ከተማ |
| 17.10 (1) | Boditi | Road traffic safety |
| 17.11 | Boditi | Driver and vehicle competency |
| 17.11 (1) | Boditi | Freight transport |
| 17.11 (2) | Boditi | Public transport and terminal |
| 17.12 | Gesuba | Cover only: ፈርጅ 3 ከተማ |
| 17.12 (1) | Bitena | Cover only: ፈርጅ 4 ከተማ |

Not in the folder: the inside pages for Gesuba and Bitena.

### Form 15 fields → `positions` table (Phase 3, used for roles now)
| Form 15 column | Amharic | Column |
|---|---|---|
| Position title | የሥራ መደብ መጠሪያ | `title I18nText` |
| Job code | የሥራ መደብ መለያ ቁጥር (e.g. `16/ወሶ-8-1/03`, `16-12-ወላ-10-001`) | `job_code` (unique per unit) |
| National code | ሀገራዊ ኮድ (e.g. `160481`, `010102`) | `national_code` (national job classification) |
| Grade | ደረጃ (I–XV) | `grade` (roman, stored as an integer 1–15) |
| Remarks | ምርመራ | `remarks` |
| Header | organisation, unit, directorate | `unit_id`, `department_id` |
| Footer | prepared / checked / approved, date (E.C.) | approval workflow on establishment changes |

## 4. Languages (decided) [D: product owner]
| Language | Tag | Script | Use |
|---|---|---|---|
| Amharic | `am` | Ethiopic | **Default** for staff UI, the regional working language; printed certificates |
| English | `en` | Latin | Second UI language; bilingual certificates (Amharic + English, as on national documents [A]) |
| Wolaytta (Wolaytattuwa) | `wal-Latn` | Latin | UI language for staff who choose it; public-facing texts (SMS, notices, verification page) [A] |

Fallback chain: `wal-Latn → am → en`. Details: [i18n-and-languages.md](i18n-and-languages.md).

## 5. Calendar, holidays, numbering
- Ethiopian calendar for all display and printing (Form 15 is dated `10/07/2018 ዓ.ም`) [D]. Fiscal year Hamle 1 – Sene 30 [N].
- **Holidays** (business-day calendar for SLAs) are seeded per year as data:
  - Federal public holidays: Enkutatash, Meskel, Genna, Timket, Adwa, Labour Day, Patriots' Victory Day, the Downfall of the
    Derg, Good Friday, Fasika, Eid al-Fitr, Eid al-Adha, Mawlid. Movable dates are entered every year. [N, from general
    knowledge; verify the year's official list]
  - **Gifaata** (the Wolaita new year, around September): add it if the zone observes it as an office holiday [A].
- **Number prefixes:** the unit's code (e.g. `WLT` for the zone, `WLT-DG` for Damot Gale) + key + Ethiopian fiscal year, e.g.
  receipt `WLT/RCT/000123/2019` [A]. The zone confirms the formats used on its paper receipts and licences.

## 6. Open items for the zone (collected)
1. The Amharic spellings, woreda categories and town grades for all units in §2 (24 so far) (the list itself comes from the zone's
   official site).
2. Which services each woreda and town office handles: intake only, or decisions too?
3. Whether Gifaata is an office holiday.
4. The current paper forms of the Phase 0 services (licence application, medical certificate, exam result, renewal, receipt).
5. The receipt and licence number formats in use.
6. Who translates into Wolaytta (a named person or office), and who signs translations off.
