# Service catalogue (54 services) and stakeholders

**Source [D]:** `Documents/Transport_&_Road_Dev_Adm_Dep't_Services_&_stackholders.docx`, titled «በወላይታ ዞን የትራንስፖርትና
መንገድ ልማት መምሪያ በየሥራ ክፍል የሚሰጡ አገልግሎቶች ከየሥራ ሂደቱ ጋር የሥራ ግኑኝነት ያላቸው ባለድርሻ አካላት» ("Services given per work
unit by the Wolaita Zone Transport and Road Development Department, and the stakeholders that work with each process").

How the document is built: it contains no tables. Each process is a bold heading with numbered services, then a bold
"stakeholders" heading with numbered stakeholders, and **bulleted roles under each stakeholder**. Extracted 2026-10-18 with the
list structure preserved.

Below, processes keep **the document's order**, and the **Amharic service text is quoted verbatim**, including the source's
spelling. The English is our translation. The module numbers (1–10) are those used in `architecture.md`.

Columns:
- **Level:** the unit that decides the case. The document lists only the *zone department's* services; which services woreda
  and town offices take in is **[A]**, inferred from Form 15 ([tenant-wolaita.md](tenant-wolaita.md) §3).
- **Delivery:** **C** = configuration only (form + workflow + fee + template); **C+E** = configuration plus module effects
  that write registry facts; **M** = module screens on top of configuration.

---

## 2. Public transport: «የህዝብ ትራንስፖርት አገልገሎት አደ/ብቃ/ማረ/ ሥራ ሂደት» (document order: 1st)
Public transport service organisation, competency and assurance process. Module `public-transport`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| PT-01 | በዞኑ ውስጥ አዳዲስ መናኸሪያዎችን መገንባትና በትራንስፖርትና መንገድ ልማት አስተዳደር መምሪያ ስም የመናኸሪያ ባለቤትነት ፕላን ማሰራት | Build new terminals (menahariya) in the zone and have terminal ownership plans prepared **in the department's name** | zone | C+E | 1 |
| PT-02 | ዞኑን ከአጎራባች ዞኖች፣ ዞኑን ከወረዳ፣ ዞንን ከልዩ ወረዳ የሚያገናኙ አዳዲስ የስምሪት መስመሮችን መክፈት | Open new routes linking the zone with **neighbouring zones**, with **woredas**, and with **special woredas** | zone | C+E | 1 |
| PT-03 | በዞኑ ከተሞች አዲስ የታክሲ ማህበር ማደራጀት | Organise new taxi associations in the zone's towns | zone (towns assist [A]) | C+E | 1 |
| PT-04 | ለነባር የታክሲ ማህበራት ዓመታዊ ፍቃድ ዕድሳት ማድረግ | Annual licence renewal of existing taxi associations | zone | C+E | 1 |
| PT-05 | በዞኑ ውስጥ በሚገኙ ከተሞች አዳዲስ የከተማ ታክሲ የስምሪት መስመሮችን ማጥናትና ታሪፍ ማዘጋጀት | Study new town-taxi routes in the zone's towns and **prepare tariffs** | zone (tariff set by the bureau, see stakeholders) | M | 1 |
| PT-06 | ከዞን ተነሽ የሆኑ የህዝብ ማላለሻ ተሽከርካሪዎች ወርሃዊ የስምሪት መርሃ ግብሮችን መርምሮ ማጽደቅ | Examine and approve the **monthly deployment schedules** of public transport vehicles departing from the zone | zone | M | 1 |

**Stakeholders [D]**
| Stakeholder | Their role (bullets in the source) | ITRMS consequence |
|---|---|---|
| የክልሉ ትራንስፖርትና መንገድ ልማት አስተዳደር ቢሮ (regional bureau) | issues directives and rules; **prepares tariffs** for public and town transport | Tariffs are bureau configuration (versioned). The zone's PT-05 study is the input, and the bureau approves (workflow step at `region`) |
| የህዝብ እና ከተማ ትራንስፖርት ማህበራት (public and town transport associations) | provide the transport service directly; **prepare the monthly schedule through the scheduling committee made up of representatives of each association, and submit it for approval** | PT-06 is *submitted by an external party*: the association scheduling committee. Phase 1 needs either an association-representative account (limited external role) or intake by zone staff. **Open question** |
| መናኸሪያዎች (terminals) | — | Terminal register (PT-01); schedules reference terminals |
| የፓሊስ መዋቅር በተለይም የትራፊክ ፖሊስ (police, especially traffic police) | — | Contact register; joint enforcement (see road safety) |
| ኢንሹራንስ ኩባንያዎች (insurers) | — | Insurance proof on vehicles and association members |

## 4. Road traffic safety: «የመንገድ ትራፊክ ደህንነት ሥራ ሂደት» (document order: 2nd)
Module `road-safety`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| RS-01 | በዞኑ ለሚገኙ ህብረተሰብ ክፍሎች በመንገድ ደህንነት ዙሪያ ግንዛቤ እንዲፈጠር ማድረግ | Raise road-safety awareness among the zone's communities | zone, woreda | C | 2 |
| RS-02 | በቀበሌያት እና ት/ቤቶች አድስ የመንገድ ትራፍክ ደህንነት ክበባት ማቋቋም ነባር የመንገድ ትራፍክ ደህንነት ክበባት ማጠናክርና ግንዛቤ መፍጠር | **Establish new** road-safety clubs in kebeles and schools, **strengthen existing** clubs, and raise awareness | woreda | C | 2 |
| RS-03 | የእግረኛ ማቋረጫ ቦታዎችን ዜብራ መቀባት | Paint zebra crossings at pedestrian crossing points | woreda / town | C | 2 |
| RS-04 | መደበኛ ቁጥጥር ክትትል ማድረግ | Routine inspection and follow-up | woreda | C | 2 |
| RS-05 | በዋና ዋና መንገዶች ላይ ድንገተኛ ቁጥጥር ማድረግ | Surprise inspections on main roads | zone, woreda | C | 2 |
| RS-06 | የትራፍክ ደንብ በመተላለፍ የተከሰሱ አሽከርካሪዎች ላይ ገንዘብ መሰብሰብ | Collect money (fines) from drivers charged with traffic-rule violations | woreda / zone | C+E | 2 |
| RS-07 | የሚከሰቱ የትራፊክ አደጋዎችንና አደጋው ያስከተለውን የሰውና የንብረት ጉዳት መረጃ ማደራጀትና ለሚመለከተው አካል ማስተላለፍ | Organise data on traffic accidents and the **human and property damage** they cause, and forward it to the concerned bodies | woreda → zone | C+E | 2 |

**Stakeholders [D]**
| Stakeholder | Their role | ITRMS consequence |
|---|---|---|
| Regional bureau | issues directives and rules | Bureau configuration |
| የመድን ፈንድ አገ/ት (insurance fund service) | **supports victims** | Accident records (RS-07) are shared with the fund: injured persons, severity, minimum data set (PDP 1321/2024 [N]) |
| የፓሊስ መዋቅር በተለይም የትራፊክ ፖሊስ | enforces the traffic rules **jointly** with road safety; carries out inspections **jointly** with road safety | RS-04/RS-05 inspection records have participating police as a field; fines (RS-06) reference the police ticket; national penalty system adapter [N] |
| የኢትዮጵያ መንገዶች አስተዳደር (Ethiopian Roads Administration) | builds and maintains roads, places road signs, builds speed breakers in towns and dangerous spots | Accident black-spot reports can be sent to ERA as a request (Phase 2, export) |
| የማሰልጠኛ ተቋማት (training institutes) | make sure drivers get competent skills and ethics training | Shared organisation register with competency |
| የኢንሹራንስ ኩባንያች (insurers) | handle **compensation and cover** for vehicle accidents | Accident data sharing (RS-07), audited |
| የመገናኛ ብዙሀን (ፋና፣ ወላይታ ቴሌቪዥን፣ ወጌታ) (media: Fana, Wolaita TV, Wogeta) | broadcast mobilisation and awareness messages | RS-01 campaign records carry the media channels and reach; seeded as organisations |
| ት/ቤቶች (schools) | do awareness work by establishing student clubs | RS-02 clubs belong to a school or a kebele |

## 1. Driver and vehicle competency: «የአሽከርካሪ ተሽከርካሪ ብቃት ማረጋገጫ ዋና ሥራ ሂደት» (document order: 3rd; a *core* process, ዋና ሥራ ሂደት)
Module `competency`.

| Code | Service: source text [D] | English | Level | Delivery | Phase | National dependency [N] |
|---|---|---|---|---|---|---|
| DVC-01 | የተሸከርካሪ ምዝገባ ማከናወንና ሰሌዳ መስጠት | Register vehicles and issue plates | zone | C+E | 1 | National vehicle registry (Directive 1050/2025) |
| DVC-02 | የተሸከርካሪ ቴክኒክ ምርመራ ማድረግና ቦ/ሎ መስጠት | Technical inspection of vehicles and issue of the bolo | zone | C+E | 1 | Insurance proof; garages |
| DVC-03 | አዲስ የአሽከርካሪ ብቃት ማረጋገጫ ፈቃድ ማዘጋጀትና ማሰራጨት | Prepare and distribute new driver qualification licences | zone, or a town unit with a competency team (e.g. Boditi) [D: Form 15]; not woredas | C+E | **0 (demo)** | National driver platform; Proc. 1074/2018 |
| DVC-04 | ነባር የአሽከርካሪ ብቃት ማረጋገጫ ፈቃድ ማድስ | Renew existing driver licences | zone, or a town unit with a competency team [D] | C+E | **0 (demo)** | as above |
| DVC-05 | ዞኑን ለቀዉ ለሚሄዱ ተሸከርካሪዎች የማዛወር አገ/ት መስጠት | Transfer service for vehicles leaving the zone | zone | C+E | 1 | National vehicle registry |
| DVC-06 | ለጠፋ ሊበሬ ቦሎና ሰሌዳ ምትክ መስጠት | Replacement for a lost libre, bolo or plate | zone | C+E | 1 | National vehicle registry |
| DVC-07 | ማስልጠኛ ተቋማት በየጊዘዉ ስልጠና አሰጣጥና ክትትል ማድረግ | Periodic follow-up of how training institutes deliver training | zone | C+E | 1 | — |
| DVC-08 | ወደ ውጭ ሀገር ለሚወጡ አሽ/ች መንጃ ፈቃዳቸውን ኢንተር ናሽናል ማደርግ | Make the licence international for drivers going abroad | zone intake; issued by the federal Authority (Art. 5(11) [N]) | C+E | 1 | National driver platform |
| DVC-09 | ከአገ/ት ተቀባዮች የገልግሎት ክፍያ መሰብሰብ | Collect service fees from service recipients | zone (who holds the till: open question) | platform `fees` | 0 | MoF Directive 1069/2025; revenue offices |
| DVC-10 | የዕጩ አሽከርካሪዎች ስልጠና አጠናቀው በማሰልጠኛ ተቋም በኩል ተረጋግጦ ሲቀር የንድፈ ሀሳብ (የኮምፒውተር) እና የሜዳ ፈተና ማከናወን | Hold the theory (**computer**) and field exams for candidates **once the training institute has confirmed they completed training** | zone | M | 0 (step of DVC-03) / 1 | National driver platform |
| DVC-11 | ሥልጠና አጠናቀውና የንድፈ ሀሳብ(የኮምፒውተር) እና የሜዳ ፈተና የጠናቀቁ ሠልጣኞች መንጃ ፍቃድ እንዲታተምላቸው ለክልል ማስተላለፍና ታትሞ የመጣውን ማሰራጨት | Send the trainees who completed training and both exams **to the region for licence printing**, and distribute the printed licences | zone | M | 0 (print batch) / 1 | Regional (later national) printing |

**Stakeholders [D]**
| Stakeholder | Their role | ITRMS consequence |
|---|---|---|
| Regional bureau | issues directives and rules; **supplies plates** (ሠሌዳ በማቅረብ); **prints driver licences** (የመንጃ ፍቃድ ህትመት); **collects service fees** (የአገልግሎት ክፍያ በመሰብሰብ) | Plate stock arrives from the bureau. DVC-11 print batches go to the bureau. **Fees: the bureau collects some or all of them**, so the zone may record payment *references* rather than cash (open question, with the revenue offices) |
| የማሰልጠኛ ተቋማት (training institutes) | train drivers in theory and practice; **present the qualified ones for assessment** (ብቁ የሆኑትን ለምዘና በማቅረብ) | DVC-10 needs a **readiness list from the school** first. Phase 0: zone staff enter it. Phase 1: an optional school account submits the list (external role, open question) |
| የጤና ተቋማት (health institutions) | issue the **medical certificate** of fitness to drive | Medical certificate record (facility, date, result) required by DVC-03/04; facilities seeded as organisations |
| የትራንስፖርት ማህበራት (የደረቅና ፍሳሽ ጭነት እንዲሁም የህዝብና የከተማ ትራንስፖርት ማህበራት) (transport associations: dry and liquid cargo, public and town transport) | — | Organisation register shared with public transport and freight |
| አሽከርካሪዎች እና ተሸከርካሪ ባለቤቶች (drivers and vehicle owners) | — | The applicants: the persons and organisations register |
| የገቢ ሰብሳቢ ቢሮዎች (revenue collection offices) | — | Payment may be made at the revenue office. Payment orders, receipt references and the remittance report are designed for this (architecture §9) |
| የመንገድ ፈንድ (Road Fund) | — | Fee share or road-fund levy reported (open question) |
| ጋራጆች (garages) | — | Bolo inspection (DVC-02) may be done at or with garages; garages as organisations |

## 3. Freight transport competency: «በጭነት ትራንፖርት ብቃት ማረጋገጫ ዋና ሥራ ሂደት» (document order: 4th; core process)
Module `freight`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| FR-01 | ለአዲስ ለሚመጡ ከተሸከርካሪዎች ብቃት ማረጋገጫ የምስክር ወረቀት መሰጠት | Competency certificate for newly arriving vehicles | zone | C+E | 1 |
| FR-02 | ለነባር ተሸከርካሪዎች ማረጋገጫ የምስክር ወረቀት ዕድሳት ማድረግ | Certificate renewal for existing vehicles | zone | C+E | 1 |
| FR-03 | የጭነት ትራንስፖርት ማመላለሻ ማህበራት ፈቃድ ዕድሳት ማድረግ | Licence renewal of freight transport associations | zone | C+E | 1 |

**Stakeholders [D]:** የጭነት ትራንስፖርት ማህበራት (freight associations), ኢንሹራንስ ኩባንያዎች (insurers). No roles are listed. Insurance
proof is part of the certificate check [A].

## 5. Road quality control and safety audit: «የመንገድ ጥራት ቁጥጥር ደህንነት ኦዲት ሥራ ሂደት» (document order: 5th)
Module `road-quality`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| RQ-01 | የቀበሌ ተደራሽ መንገድ ነባር ፕሮጀክቶች ቀሪ የአፈር ሥራ ፣ጠጠር ዳምፕ የማድረግና ብተና ሥራ፣የስትራክቸር ሥራዎችን ማከናወን | Carry out the remaining earthworks, gravel dumping and spreading, and structure works of **existing** kebele access road projects | zone | M | 2 |
| RQ-02 | የግንባታ ቁጥጥር ማድረግ በቁጥር | Construction supervision, **counted by number** (a target of supervision visits) | zone | C+E | 2 |

**Stakeholders [D]**
| Stakeholder | Their role | ITRMS consequence |
|---|---|---|
| Regional bureau | issues directives and rules; **sends the unit rates** (የቁርጥ ዋጋ አውጥቶ በመላክ (ዩኒት ሬት)) | Unit-rate catalogue imported from the bureau (versioned) |
| የመንገድ ሥራ አማካሪ ማህበራት (road-works consultant associations) | — | Organisation register; supervision reports |
| የመንገድ ሥራ ተቋራጭ ማህበራት (road-works contractor associations) | — | Organisation register; contracts |
| የፍናንስና ፕላን መምሪያ (Finance and Plan department) | — | Payment documents and progress go to it |

## 6. Design and contract administration: «በዲዛይን ኮንትራት አስተዳደር ሥራ ሂደት» (document order: 6th)
Module `design-contracts`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| DC-01 | አዳዲስ የመንገድ ፕሮጀክቶች ዲዛይን ስራዋች ማሰራት | Have design works done for new road projects | zone | C+E | 2 |
| DC-02 | የተቋራጭና የአማካሪ የዉል ሰነድ ማዘጋጀት | Prepare contractor and consultant contract documents | zone | M | 2 |
| DC-03 | አዲስ ለተመረጡ ፕሮጀክቶችን ዉል መስጠት | Award contracts for newly selected projects | zone | M | 2 |
| DC-04 | የዲዛይን እና የሱፐርቪዥን የቁርጥ ዋጋ ማዘጋጀት | Prepare design and supervision unit rates | zone | M | 2 |
| DC-05 | ደረጃቸዉ የሚሻሻሉ/Dc3/ መንገዶች መለየትና ለግንባታ ማዘጋጀት | Identify roads to be upgraded (DC3) and prepare them for construction | zone | C+E | 2 |
| DC-06 | ለተሰራ የድልድይ ስራ ክፍያ ሰነድ ማዘጋጀት | Prepare payment documents for completed bridge works | zone | M | 2 |
| DC-07 | ለአዲስ መንገድ ፕሮጀክቶች ግንባታ ቅድመ ክፍያ ሰነድ ማዘጋጀት | Prepare advance-payment documents for the construction of new road projects | zone | M | 2 |

**Stakeholders [D]:** the same as road quality: the bureau (directives; sends unit rates), consultant associations,
contractor associations, and the Finance and Plan department.

## 7. Community participation and stakeholders: «የህብረተሰብ ተሳትፎና ባለድርሻ አካላት ሥራ ሂደት» (document order: 7th)
Module `community`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| CP-01 | በህብረተሰብ ተሳትፎ መደበኛ ጥገና ማከናወን | Routine maintenance through community participation | woreda [A] | C | 2 |
| CP-02 | በህብረተሰብ ተሳትፎ ወቅታዊ ጥገና ማከናወን | Periodic maintenance through community participation | woreda [A] | C | 2 |
| CP-03 | የህብረተሰብ ተሳትፎ በገንዘብ መተመን/መቀየር | Value or convert community participation into money | woreda → zone | C+E | 2 |
| CP-04 | ካፒታል በጀት በወረዳና በዞን እንዲያዝ ማድረግ | Get capital budget allocated at woreda and zone level | zone | M | 2 |
| CP-05 | የባለድርሻ አካላት ተሳትፎ ማሳደግ | Increase stakeholder participation | zone | C | 2 |

**Stakeholders [D]:** የህዝብ ክንፍ አካላት (the public wing), የንግዱ ማህበረሰብ (the business community), ኢንቨስተሮች (investors). No roles
are listed. CP-05 records their contributions (in kind or money) [A].

## 8. Logistics: «የሎጀስቲክስ ሥራ ሂደት» (document order: 8th)
Module `logistics`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| LG-01 | በመንገድ ግንባታ እና ጥገና ሥራ ላይ ለሚሳተፉ ጊዜያዊና ቋሚ የሥራ ዕድል መፍጠር | Create temporary and permanent jobs for people in road construction and maintenance | zone, woreda | C | 2 |
| LG-02 | የአከባቢ ጥበቃ ሥራን ማሻሻልና መንገዶች በጎርግና በነፋስ እንዳይወድሙ ችግኞችን መትከል | Improve environmental protection and plant seedlings so that roads are **not destroyed by floods and wind** | woreda | C | 2 |
| LG-03 | የመንገድ ግንባታ ሥራን ለማከናወን የተገዙ ማሽነሪዎች ለተቋራጭ ውል በማስገባት በኪራይ እንዲጠቀሙ ማድረግ | Rent the machinery **bought for road construction** to contractors **under contract** | zone | M | 2 |

**Stakeholders [D]:** የክልሉ መንገዶች ባለሥልጣን ሶዶ ዲስትሪክት (regional roads authority, Sodo district), የማሽን ኦፕሬተሮች (machine operators),
የመንገድ ሥራ ተቋራጮች (road contractors).

## 9. HR management: «የሰዉ ሀብት ሥራ አመራር ሥራ ሂደት» (document order: 9th)
Module `hr`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| HR-01 | የሰዉ ሃይል ማሟላት | Staffing (filling positions; Form 15) | each unit | M | 3 |
| HR-02 | የዓመት ዕረፍት ጥያቄ ሲቀርብ ተቀብሎ ማስተናገድ | Receive and handle annual-leave requests | each unit | C+E | 3 |
| HR-03 | የሰራተኞች እና አመራሮች ጥቅማ ጥቅም ማስከበር | Secure the benefits of staff and leaders | each unit | C | 3 |
| HR-04 | የሰራተኞች በየወሩ ደሞዝ ለፋይናንስ ማስተላለፍ | **Forward staff salaries to Finance every month** (the payroll list, ADR-0016) | each paying unit | M | 3 |
| HR-05 | የሰራተኞች መረጃ ለፐብሊክ ሰርቪስ ማስተላለፍ | Forward staff data to the civil service | zone | R | 3 |
| HR-06 | ጡረታ የሚወጡ ሰራተኞችን ጡረታ ማስወጣት | Process the retirement of retiring staff | each unit | C+E | 3 |

**Stakeholders [D]:** የመ/ቤቱ ሠራተኞች (the office's staff), የክልሉ ሲቪል ሰርቪስ ቢሮ (regional civil service bureau), የዞን ሲቪል ሰርቪስ
መምሪያ (zone civil service department), የጡረታ ዋስትና ኤጄንሲ (pension agency).

## 10. Development plan and budget preparation: «የልማት ዕቅድ በጀት ዝግጅት ሥራ ሂደት» (document order: 10th)
Module `planning`.

| Code | Service: source text [D] | English | Level | Delivery | Phase |
|---|---|---|---|---|---|
| PB-01 | የሴክተሩን ዓመታዊ በጀት መረጃ ማዘጋጀት እና ማደራጀት | Prepare and organise the sector's annual budget data | zone | M | 3 |
| PB-02 | የበየሩብ ዓመቱ ዕቅድ አፈጻጸም ማዘጋጀት እና ለሚመለከተዉ አካል ማስተላለፍ | Prepare the quarterly plan performance and forward it to the concerned body | zone (from woredas) | R | 3 |
| PB-03 | የሴክተሩ ዓመታዊ ግዥ ዕቅድ ማዘጋጀት እና ለሚመለከተዉ አካላት ማቅረብ | Prepare the sector's annual procurement plan and submit it to the concerned bodies | zone | M | 3 |
| PB-04 | በሴክተር በጀት የሚሰሩ የካፕታል ፕሮጀክት ፊዝካል አፈጻጸም መከታተል አስፈላጊ መረጃዎችን ለሚመለከተዉ አካል ማስተላለፍ | Monitor the physical performance of capital projects **funded by the sector budget** and forward the needed data | zone | R | 3 |

**Stakeholders [D]:** የዞኑ ፍናንስና ፕላን መምሪያ (the zone's Finance and Plan department), የመንገድ ሥራ ተቋራጮች (road contractors).

---

## Totals [D]
Public transport 6 + road safety 7 + competency 11 + freight 3 + quality 2 + design 7 + community 5 + logistics 3 + HR 6 +
plan 4 = **54**.

By delivery ([ADR-0030](decisions/0030-hybrid-delivery-builder-and-code.md)): **C 11**, **C+E 23**, **M 16**, **R 3**
(report/data product), platform 1 (DVC-09 fees). The reasoning for each service is in
[platform/delivery-decisions.md](platform/delivery-decisions.md); the builder is used in 50 of the 54.

### How to classify a new or changed service
Use the five ordered questions in [platform/delivery-decisions.md](platform/delivery-decisions.md) §2 (report → multi-record → money beyond a fee rule → registry, legal rule, fee or national system → otherwise configured). Even M modules use builder forms for intake and simple steps.

## What the stakeholder roles change in the design
1. **External submitters exist.** Association scheduling committees submit monthly schedules (PT-06), and training institutes
   present qualified trainees (DVC-10). Phase 0 has zone staff enter these. Phase 1 decides whether those bodies get limited
   accounts. Such an account would be scoped to their own organisation, with no access to other cases. This becomes a new
   role kind in [roles-and-permissions.md](roles-and-permissions.md).
2. **Fees may be collected by the bureau or the revenue offices, not by the zone's own till.** The demo therefore supports
   both: a cashier at the office, or "paid at revenue office" with a receipt reference to verify. Who holds the money is an
   open question (see [demo-plan.md](demo-plan.md) §5).
3. **Licences are printed by the region.** DVC-11 print batches are a core flow, not an extra.
4. **Tariffs are set by the bureau.** The zone studies and proposes (PT-05), and the bureau approves.
5. **Unit rates come from the bureau** (quality and design processes): an imported, versioned catalogue.
6. **Accident data goes to the insurance fund (victim support), insurers (compensation) and police.** These are three
   sharing purposes, each with its own minimum data set.
7. **Media and schools are part of the safety work.** Campaigns record the channels (Fana, Wolaita TV, Wogeta), and clubs
   belong to schools or kebeles.
