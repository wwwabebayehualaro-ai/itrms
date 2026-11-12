# Sample forms received (the structures to build from)

The paper forms, letters and documents the Wolaita Zone sent on 2026-11-11, with the structure of each: who issues it,
its sections and fields, and the task or service that builds from it. **Structure only:** the scans carry real names,
numbers and signatures and stay local (`docs/business-questions/response/`, excluded from git). Seed and demo data are
generated, never copied from them. The scan file is named relative to that folder.

Where a form is ours to produce (a letter or certificate ITRMS prints), it becomes a document template. Where it is
filled in by the applicant or the officer, it becomes a form-builder form. Where it is someone else's (the insurer's, the
health bureau's, the finance bureau's), ITRMS records its number and key facts only.

Confidence as in the records: printed forms **H**; handwritten or inferred **M**/**L**.

## Applications

| Form | Issuer | Scan | Structure | Builds |
|---|---|---|---|---|
| **Driver and vehicle competency service application** (25 services, tick one) | zone or town DVC process | `2-vehicle-documents/40-…__2157`, `3-licence-documents/14-…__2232`, `35-…__2240` (older print) | Applicant, address (zone/town, kebele, house no.), phone; 25 services each with "mark X" and remarks: new licence, new vehicle inspection and registration, licence renewal, annual inspection and sticker, sticker only, replacement (licence, libre, bolo, plate), change of code, body, engine, colour, valuation and name transfer, file transfer (region change), licence transfer, learner registration, registering a vehicle that came with a transfer letter, school competency, school renewal, school grade, garage competency licence, data request, technical support to government vehicles (inspection, accident), special registration, foreign licence conversion, name change by court; signature and date | The service catalogue's DVC list (request R5); the intake of every DVC service |
| **Driver licence service request** | regional transport bureau | `3-licence-documents/13-annex-01-…__2231-2` | Applicant name, date; grade (motorcycle, three-wheel, automobile, public 1–2, dry 1–3, other); service (new, renewal, copy/changes); school and training round; applicant signature; for the issuer: holder name, licence number, issue and expiry dates, fee receipt number; filled by, verified by (team lead) | 1.6 licence intake |

## Vehicles

| Form | Issuer | Scan | Structure | Builds |
|---|---|---|---|---|
| **Temporary ownership libre** (ጊዜያዊ የባለቤትነት ሊብሬ) | zone, on its letterhead, numbered | `2-vehicle-documents/08-…__2146-2`, `3-licence-documents/38-…__2241-1` | 18 fields: plate (code-number-region), owner, address (region, zone, town, woreda, kebele), house no. and phone, vehicle type, model and cc and engine HP, year and country made, engine no., chassis no., fuel, colour and length/width/height (m), tyre size and count and cylinders, gross weight, net weight, capacity (persons or quintals), service, bolo number, issue date (E.C.); notes: "not the libre booklet; given until it comes" | 1.2d: the DVC-01 certificate (ADR-0050) |
| **Libre data page** (owner and vehicle description) | printed for the booklet | `2-vehicle-documents/06-…__2143`, `3-licence-documents/39-…__2241-2` | Owner: photo, name, nationality, region, town, sub-city, kebele, phone, plate, **previous plate**, print date (E.C.); vehicle: type, country, model, year, chassis, engine, body type, colour, fuel, HP, gross and net weight, load (quintals), cc, cylinders, service, axles; the manager signs | 1.2d (booklet fields); 1.1 registry fields |
| **Old regional libre booklet** | regional bureau | `3-licence-documents/47…49-old-libre-booklet-…` | p1 vehicle description (type, make, model, year, body, chassis, colour, body width/length/height, engine no., cc, fuel, cylinders), photo, plate; p2 BHP, tyres, axles, axle loads, gross/tare/payload (quintals), seats, plates (office code + code-number); p3 owner and possessor (special registration no., name, region, town, kebele, house no., phone); p4 declaration under a 5-Birr revenue stamp; p4–5 **renewals**: date, annual sticker number, registration officer, receipt number; serial no. | 1.13 back-capture of old booklets; 1.3 (sticker + receipt per year) |
| **Ownership transfer form with valuation** | zone | `2-vehicle-documents/10-…__2144-1` | I parties (seller, buyer, address); II vehicle (plate, engine, chassis, capacity, service) and technical inspection; III valuation: year made, purchase price, depreciation, market value, value set by the committee, contract value; IV verified by (technicians) | 1.4 valuation step |
| **Vehicle sale contract** | the parties, authenticated by the justice office | `2-vehicle-documents/09-…__2144`, `3-licence-documents/36-…__2240-1` | Seller (or attorney), buyer, addresses; vehicle (plate, chassis, engine, model, year, made in, seats, cylinders); price; the seller's guarantee against debts and claims; penalty for breach (to the other party and to the government); Civil Code articles; three witnesses; signatures | 1.4 attachment (not generated) |
| **Transfer letters** (three) | zone | `2-vehicle-documents/11…13-…`, `14…17-…copy-…` | To the **tax office**: register a code-3 vehicle owner as a business taxpayer. To the **justice office**: the plate has no debt or encumbrance, authenticate the contract. To the **revenue office**: the vehicle was valued at Birr …, collect stamp duty; valuation attached | 1.4 document templates |
| **Vehicle data transfer document** | zone, to the receiving bureau | `2-vehicle-documents/18-…__2148`, `3-licence-documents/37-…__2241` | Owner and address; **plate history** (plate, year, place, several regions); vehicle facts; customs declaration and tax receipt nos.; inspection valid until; **encumbrances** (stop orders; bank or insurance holds: letter no., date, amount, or "none"); value and excise paid; prepared and approved by. Rules: no erasure, empty rows crossed, remarks for the rest, **valid 15 days** | 1.4 zone-transfer document |
| **Plate demand letter and table**; **printed-forms demand letter**; **price list** | zone to the regional bureau | `2-vehicle-documents/02…05-…` | Per plate code and vehicle (car pair / motorcycle single): in stock, new, total; per form: quantity (stickers in pads, ጥራዝ); price list: item, quantity, unit price (Birr and cents), total | 1.2a plate stock; 1.12a stationery (unit price) |

## Bolo (annual inspection)

| Form | Issuer | Scan | Structure | Builds |
|---|---|---|---|---|
| **Light-vehicle annual inspection checklist** (serial-numbered) | regional bureau, filled at an inspection centre | `2-vehicle-documents/20…21-…`, cover with plate photo `22-…` | Place, owner, plate, chassis, engine, type, model, libre book no., capacity; ~40 items each correct / not correct (documents, identity, lights 6.1–6.10 incl. CO/HC, brakes 7.1–7.3, horn, body, suspension, glass, doors, mirrors, tyres, spare and jack, extinguisher, triangle, seat belts, hazard label…); overall result, remarks, inspector, stamp, date | 1.3 checklist (1.13a `Checklist` type); the form's serial recorded |
| **Third-party insurance certificate and sticker** | MoTL Road Safety & Insurance Fund format, issued by the insurer | `2-vehicle-documents/23…26-…` | Certificate no. (7 digits), issue date, insured and address, plate, engine, chassis, type, capacity, policy no., **policy period (1 year)**, conditions, who may drive, insurer, premium, insurance-fund tariff; Proclamation 799/2013; round sticker with the same number | 1.3 prerequisite (number, insurer, period) |
| **Bolo sticker with counterfoil** (regional, per category and year; national with barcode) | regional bureau (old plates), ministry (ETH plates) | `2-vehicle-documents/27…36-…`, `3-licence-documents/41-…` | Regional (7-digit serial on both parts): counterfoil 1 owner/capacity, 2 colour, 3 type, 4 zone, 5 plate, 6 month, 7 signature; sticker the same. National (6-digit serial + barcode): code, plate, chassis, engine, seats, capacity, **inspection place, receipt no.**, name, signature, date | 1.12a stock (variant, year); 1.3 issue |
| **Temporary bolo letter** | zone, numbered letter | `2-vehicle-documents/37…38-…` | To whom it may concern: plate, owner, engine, chassis, **receipt no.**, capacity; the sticker printed by the federal/regional authority has not arrived; do not stop the vehicle **from … to …** (≈ 6 months) | 1.3 temporary bolo certificate |

## Driver licences

| Form | Issuer | Scan | Structure | Builds |
|---|---|---|---|---|
| **Renewal requirements notice** | zone | `3-licence-documents/15-…__2234-2` | Card licence: 1,000-Birr deposit to the bureau's print fund, licence copy, blood group, school. Paper licence: the same, plus photo, education level, birth certificate, (one more, L) | 1.6 renewal requirements (configuration) |
| **Medical referral letter** | zone, to a health facility | `3-licence-documents/16-…__2232-1` | To … health centre/hospital: Mr/Ms …, whose licence renewal is due, please examine | 1.6 document template |
| **Drivers physical examination report** | regional health bureau, filled by the facility | `3-licence-documents/17…18-…` | No., to, agency, city, region; applicant and grade; vision (pupils, each eye, colour red/amber/green), distance, hearing, other findings, epilepsy, diabetes, hypertension, cardiac (each on follow-up or not), lab results; recommendation **grant / grant with conditions / refuse**; date, medical officer | 1.6: record facility, date, recommendation and conditions only (ADR-0052) |
| **Temporary driving permit letter** | zone, numbered letter | `3-licence-documents/33…34-…` | To whom it may concern: the holder of grade … licence no. … (card serial …), renewal due or licence lost (police report), may drive **from … to …** until the regional bureau prints the card | 1.6 temporary permit (QR, validity window) |
| **Licence verification letter** (Amharic and English) | zone | `3-licence-documents/44…45-…` | Requested by, date; holder's name, sex, date of birth, nationality; grade, licence number, card serial, issue and expiry dates; "equal value to the federal licence of that grade" | 1.6 verification document (two languages) |
| **Licence file request to another region** | zone | `3-licence-documents/43-…` | To the other region's licensing branch: the holder's earlier licences (grade, number), please send the original file | 1.6 transfer-in |
| **Licence print request and data list** | zone to the regional bureau | `3-licence-documents/28…32-…` | Letter: counts per grade, total, the school paid the region's 50% share into the bureau's account, deposit slips attached. List per candidate: previous card serial or NEW, grade code (4 digits), name, sex, date of birth, photograph number, zone code, woreda, kebele, school code; prepared by, team leader, licence-issuing head | 1.8 print batch export |

## Exams and driving schools

| Form | Issuer | Scan | Structure | Builds |
|---|---|---|---|---|
| **School renewal recommendation** | zone, to the regional bureau | `3-licence-documents/02…04-…` | The school applied (date, ref.); the zone's team inspected it against the standard and staff documents; vehicle and trainer pages attached; recommend renewal for the fiscal year | 1.7 document template |
| **Training-vehicle register** | regional bureau's form, filled by the school/zone | `3-licence-documents/05-…`, blank `46-…` | Per vehicle: type, grade trained, engine no., plate, chassis, model, service, seats, gross weight, year made, technical condition, insurance; prepared, verified | 1.7 school vehicles |
| **Trainer register** | the school/zone | `3-licence-documents/06-…` | Per trainer: name, age, education level, employment, years of service, agreement, salary, licence grade, instructor qualification | 1.7 school trainers |
| **Oversight findings report** | zone | `3-licence-documents/07…09-…` | Per school: numbered strengths and weaknesses (free text, some naming a vehicle) | 1.7 oversight visit |
| **Practical exam request and theory results** | the school, to the zone | `3-licence-documents/10…11-…`, `19…20-…` | Letter: these trainees (grades) passed the theory exam, give them the practical; list: name, grade, **round**, theory score, remark | 1.7 trainee list (partner account, ADR-0053) |
| **Exam appointment card** (serial-numbered) | regional bureau | `3-licence-documents/12-…__2231` | Photo; name; exam centre; zone, town; school; learner permit no.; grade; training hours (theory, practical); theory-test code; computer no.; table: exam type, attempt, date, time, score %, examiner, remark | 1.7 booking and results |
| **Practical exam checklist** (100 points) | regional bureau | `3-licence-documents/22…25-…` | Header: zone/town, candidate, age, sex, grade, sub-category, vehicle model, plate, date, start and end time, examiner. Items with max points: 1 pre-drive (1.1–1.4), 2 starting (2.1–2.4), 3 moving off (3.1–3.6), 4 a 5 km drive (4.1–4.22), 5 simulator (5.1–5.4); total 100; result; examiner signs | 1.7 `Checklist` form with weights |
| **Practical exam register / result sheet** | regional bureau's form; zone | `3-licence-documents/21-…`, `42-…` | Date, school; per trainee: name, sex, grade, round, simulator score, practical score, total, passed/failed; technician and **three observers** sign | 1.7 session result sheet |

## Money

| Form | Issuer | Scan | Structure | Builds |
|---|---|---|---|---|
| **Receipt Voucher** (form መ/ሂ/7) | regional finance bureau, pre-printed pads | `3-licence-documents/26…27-…` | Ethiopic series letter and printing ("ሴሪ/ለ/12ኛ"), 6-digit serial; date, zone, woreda; public body; received from, address; mode (cash, cheque, deposit slip, bank transfer; cheque/ref. no.); amount in figures and words; purpose; for accounts: budget category, account code, debit, credit, posted; prepared by, received by; copies: payer, accounts, pad | 1.12a stock (done); 1.12 pad receipts and remittance |
| **Fee sheets** (handwritten) | zone | `1-written-answers/03-…`, `2-vehicle-documents/19-…`, `39-…` | Fees by plate code and service (readings M) | Fee rules (request R2 for the typed schedule) |
