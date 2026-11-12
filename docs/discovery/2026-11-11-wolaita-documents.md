# 2026-11-11 · Wolaita Zone: the documents behind the written answers

| | |
|---|---|
| **Organisation** | Wolaita Zone Transport and Road Development Administration Department (the reference design, not a customer) |
| **Answers** | The same questionnaire as the [written answers](2026-11-11-wolaita-written-answers.md). These are the documents those answers refer to. |
| **Received** | 2026-11-11, in the evening: 40 phone scans (CamScanner). Each is marked by hand with the printed question it answers ("ጥያቄ 11.2", "12.4 …"). |
| **Form** | Official documents: letters and forms on the zone department's letterhead, the regional bureau's and the ministry's printed forms (bolo stickers, the inspection checklist, the insurance certificate), and two handwritten notes. |
| **Personal data** | Several documents carry real names, plates, chassis numbers and signatures. **This record keeps their structure only:** fields, steps, numbering, prices and rules. Nothing personal is copied, and the scans stay out of the repository (`docs/business-questions/response/2-vehicle-documents/`, excluded in `.git/info/exclude`). |
| **Confidence** | Printed text is read with high confidence (**H**) unless marked. Handwritten notes are medium (**M**) or low (**L**). |

## What the documents settle

1. **The zone buys its controlled forms from the regional bureau** (Q11.2, two letters and a price list, 2016–2017 E.C.).
   - **Plates and libre booklets come from the regional bureau:**
     - by request letter, with the demand per plate code;
     - car plates in **pairs** (front and rear), motorcycle plates **single**.
   - **Bolo stickers are printed per category and per fiscal year, and come in pads (ጥራዝ):**
     - categories: taxi, commercial, private (የቤት), government, public enterprise (ህዝባዊ ድርጅት), NGO;
     - each category × year is its own design and colour.
   - **Each item has a unit price, in Birr and cents:**
     - a code-1 plate pair: 2,657 Birr;
     - a libre booklet: 130 Birr;
     - a 2017 E.C. pad of taxi bolo stickers: about 1,200.76 Birr;
     - one order totalled 2,515,708.14 Birr.
   - The bureau prints for the whole region.
   - **The ministry prints its own national stickers** for ETH plates. They carry a 6-digit serial and a barcode, next to the bureau's 7-digit regional ones.
   - → **Task 1.12a:** controlled stationery with kinds, a **variant** (the category), a **valid year**, the **source** and a
     **unit price** per delivery.
2. **The zone issues a TEMPORARY LIBRE** (ጊዜያዊ የባለቤትነት ሊብሬ ደብተር, Q11.3).
   - It is a numbered document on the zone's letterhead with 18 fields: plate, owner, address, vehicle facts, dimensions, weights, capacity, service, **bolo number** and date.
   - It says on its face that it **is not the libre booklet** and is given until the booklet comes.
   - A full libre data page (owner and vehicle description, photo, print date) was also sent.
   - → **ADR-0050 stands, with the zone's own name:** the ITRMS registration certificate *is* the temporary libre. The booklet's serial is recorded when the booklet is issued.
3. **When stickers run out, the zone issues a TEMPORARY BOLO LETTER** (ጊዜያዊ ቦሎ, Q12.4).
   - It is a numbered letter to whom it may concern, naming the plate, owner, engine, chassis and **receipt number**.
   - It asks that the vehicle not be stopped between two dates. One example covers about 6 months: 18/11/2017 to 30/05/2018 E.C.
   - The reason given: the stickers are printed by the federal (2017) or regional (2018) transport authority and have not arrived.
   - → **Task 1.3:** a bolo can end in a temporary bolo certificate (QR, a validity window) when the office holds no sticker of the category and year. The sticker is issued against the same case later.
4. **Ownership transfer is three letters and a valuation** (Q11.4).
   1. A letter to the **tax office**: a vehicle on a commercial plate (code 3) must be registered as a business taxpayer.
   2. A letter to the **justice office** (documents authentication): it confirms the plate has **no debt or encumbrance**
      (ዕዳ ዕገዳ የለበትም) and asks that the sale contract be authenticated.
   3. A letter to the **revenue office**: the zone's technical expert has **valued** the vehicle, and stamp duty is to be paid on that value. The valuation form is attached.
   - **The valuation form** records:
     - the parties;
     - the vehicle's identity;
     - a technical inspection;
     - year, purchase price, depreciation and market value;
     - the value set by the committee and the contract value;
     - who verified it.
   - **The sale contract** is authenticated and cites the Civil Code. It names the seller (possibly by power of attorney), the buyer, the vehicle and the price, with three witnesses.
   - → **Task 1.4:**
     - three generated letters;
     - a valuation step with its own form (value in santim);
     - the encumbrance check before the justice-office letter;
     - the tax registration letter for code-3 vehicles.
5. **A vehicle leaving the zone travels with a VEHICLE DATA TRANSFER DOCUMENT** (Q11.5), addressed to the receiving bureau.
   - **Contents:**
     - owner and address;
     - the **plate history** (plate, year, place);
     - the vehicle facts;
     - the customs declaration and tax receipt numbers;
     - inspection validity;
     - an **encumbrance section**: stop orders, bank or insurance holds, each with letter number, date and amount, or "none";
     - purchase value and excise paid;
     - prepared by, approved by.
   - **Its rules:** no erasure; empty rows crossed out; remarks for anything else; **valid 15 days**, void if the service is not given in time.
   - → **Task 1.4:** the zone-transfer document is an ITRMS document with these sections and a 15-day validity.
6. **The annual inspection is done at a private inspection centre** (Q12.2), for example an authorised dealer's garage, on the bureau's **serial-numbered** checklist form "Vehicle annual inspection for light vehicle".
   - **About 40 items, each correct / not correct:**
     - title certificate, chassis and engine;
     - lights, indicators and emissions (CO/HC);
     - brakes;
     - body, suspension, glass, mirrors and tyres;
     - fire extinguisher, warning triangle, seat belts and the hazard label.
   - The form ends in an overall result, the inspector and a stamp. A photo of the plate is attached.
   - → **Task 1.3:**
     - the checklist form as configuration (light vehicle first; heavy vehicles to ask);
     - the inspection centre as a partner organisation (ADR-0053);
     - the checklist's own serial recorded.
7. **Third-party insurance before the bolo** (Q12.3).
   - It is a **certificate of insurance** in the format of the MoTL **Road Safety & Insurance Fund Service**, under **Proclamation 799/2013**.
   - **It records:** a 7-digit certificate number, the insured and address, plate, engine, chassis, vehicle type, capacity, policy number, a **policy period of one year**, the insurer, the premium and the **insurance fund tariff**.
   - It comes with a round windscreen insurance sticker carrying the same number.
   - → **Task 1.3:** the bolo records the certificate number, insurer and policy period, and refuses an expired policy.
8. **The zone's service application form lists 25 driver and vehicle competency services** (one form, tick the service).
   - It is finer than the catalogue's DVC-01…11. It adds:
     - **change services** on the register: plate code to code, body, engine, colour, name by court order;
     - valuation with the name transfer;
     - assembled and special vehicle registration;
     - registering a vehicle that came with a transfer letter;
     - garage competency licence;
     - technical support to government offices' vehicles;
     - data requests.
   - → **The service catalogue:** reconcile with the zone (request R5 below).
9. **Bolo fees by code** (handwritten, M), as in the written answers:
   - codes 1, 2 and 3: 1,000 Birr;
   - codes 4 and 5: 1,500 Birr.

## Files (local only)

The scans are in `docs/business-questions/response/2-vehicle-documents/`, named `NN-<content>__<time>.pdf`, where `<time>` is the
scan time below without its dot (`21.41 (1)` → `__2141-1`).

| Scans | Question | Content |
|---|---|---|
| 21.40 | 11 | The printed page, its box empty (the attachments follow) |
| 21.41, 21.41 (1), 21.42, 21.42 (1) | 11.2 | Plate demand letter and table (pairs and singles); printed-forms demand letter; purchase price list |
| 21.43, 21.43 (1), 21.46 (2) | 11.3 | Libre data page; temporary libre cover; temporary ownership libre (18 fields) |
| 21.44, 21.44 (1), 21.45, 21.45 (1), 21.46, 21.47 – 21.47 (3) | 11.4 | Sale contract; transfer valuation form; stamp-duty, justice-office and tax-registration letters (some twice) |
| 21.48 | 11.5 | Vehicle data transfer document (15 days) |
| 21.48 (1) | 11.6 | Fees, handwritten (M) |
| 21.48 (2), 21.49, 21.49 (1) | 12.2 | Light-vehicle inspection checklist (serial-numbered) and the inspection centre's cover with the plate photo |
| 21.50, 21.50 (1), 21.50 (2), 21.55 (2) | 12.3 | Insurance sticker and certificate (Proclamation 799/2013); the insurer's VAT invoice; an insurer's own sticker |
| 21.51 – 21.55 (1) | 12.4 | Bolo stickers: regional 2018 (taxi, government, private, public enterprise) and 2017 (taxi); national 2018 (commercial, with barcode) |
| 21.56, 21.56 (1) | 12.4 | Temporary bolo letter (2017) and its 2018 template |
| 21.56 (2) | 12.5 | Bolo fees, handwritten (M) |
| 21.57 | — | The service application form (25 services) |

## Requests back to the zone (added to R1–R4 of the written answers)

- **R5.** Confirm the 25-service list against the catalogue's DVC-01…11, and which of them a woreda or town may give.
- **R6.** The heavy-vehicle inspection checklist (only the light-vehicle form was sent), and whether the inspection centre or the zone keeps the original.
- **R7.** How many stickers one pad (ጥራዝ) holds, and whether pads or single stickers are allocated to offices.
- **R8.** Who signs the temporary libre and the temporary bolo letter, and whether either is reported to the bureau.
