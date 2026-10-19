# Ethiopian context (researched 2026-10-17)

The laws, national systems and recent changes that shape ITRMS. Each point says what it means for the design. **Most
sources are news reports and law-firm summaries, not the Negarit Gazette.** Every rate and rule is configuration in ITRMS, so
a figure verified later changes data, not code. Items marked ⚠️ must be confirmed with the bureau or the official text before
they are relied on.

## 1. Administrative structure

- Ethiopia has 12 regional states and 2 chartered cities. The **South Ethiopia Regional State** was formed in August 2023 from
  the southern part of the former SNNPR (the rest became Central Ethiopia Regional State). Its capital is **Wolaita Sodo**.
  Zones include Wolaita, Gamo, Gofa, Gedeo, South Omo, Ari, Konso, Gardula, Burji, Amaro, Basketo and Ale. Wolaita Zone has
  about 2.34 million people. ([Wikipedia: South Ethiopia Regional State](https://en.wikipedia.org/wiki/South_Ethiopia_Regional_State), [Wolayita Zone](https://en.wikipedia.org/wiki/Wolayita_Zone), [regional site](https://www.southethiopiarspo.gov.et/overview/))
- The scans in `Documents/forms` show woreda categories (e.g. Damot Gale = "ምድብ 1 ወረዳ") and graded town administrations
  (Boditi = ፈርጅ 1, Gesuba = ፈርጅ 3, Bitena = ፈርጅ 4). The stamps belong to the **South Ethiopia Regional State Transport and Road Development
  Administration Bureau** and the regional **Civil Service Commission**.
- **Design:** the org tree needs configurable levels (done: ADR-0011) and unit attributes `category` / `grade`, because staffing
  and possibly fees differ by category.

## 2. Vehicle registration is becoming national ⚠️ (largest impact)

- **Directive No. 1050/2025** of the Ministry of Transport and Logistics (MoTL) replaces region-based vehicle registration with a
  **unified national system**. Plates carry "ETH" / "ኢት", three Latin letters and four digits. Each vehicle gets a **unique
  federal identification number** and a digital sticker held in a central database. That database reportedly **blocks
  registering a vehicle in more than one region**. Existing vehicles must exchange their plates. Issuance began in Addis Ababa
  on 11 June 2026 for new registrations, and regions start "once they finish their preparations". The ministry imported about
  4 million plates. ([The Reporter](https://www.thereporterethiopia.com/51124/), [Ethiopian Business Review](https://ethiopianbusinessreview.net/ethiopia-unveils-new-vehicle-plates-featuring-geez-and-eth-symbol/), [Borkena](https://borkena.com/2026/06/11/ethiopia-rolling-out-new-vehicle-license-registration-system/), [Addis Insight](https://addisinsight.net/2026/06/11/ethiopias-new-vehicle-plates-roll-out-with-fees-of-up-to-56000-birr/), [The Reporter: vanity plates](https://www.thereporterethiopia.com/47371/))
- **Design consequences:**
  - ITRMS is **not the national vehicle register**. It is the bureau's *operational* system: it runs the service (application,
    inspection, fees, approval, documents) and keeps a regional working copy of each vehicle with the **federal vehicle id**
    and plate as external keys.
  - A `NationalVehicleRegistry` adapter (fake first) is needed. Where the ministry's system is the system of record, ITRMS
    records the federal reference that system returns. Where no interface exists yet, staff key it in (double entry, flagged
    for later reconciliation).
  - Plate stock is federal (`plates.source = federal`), and the old regional plate codes are kept as history for the
    migration of paper records.
  - The plate-exchange campaign (old regional plate → national plate) is a likely **early, high-volume service** for zones.
  - **Question for the bureau:** what may regions do in the national system themselves, and what does the ministry expect
    them to use?

## 3. Driver licensing and traffic penalties are being centralised ⚠️

- Licences fall under **Proclamation 1074/2018** (drivers' qualification certification licence, replacing 600/2008).
  Service fees moved from Regulation 450/2019 to **Council of Ministers Regulation 572/2025** (fee rates for MoTL services).
  The amounts were not found online. ([LawEthiopia index](https://www.lawethiopia.com/index.php/legislation/federal-legislation/transportation-and-communication), [Proclamation 1074/2018 text](https://www.metaappz.com/References/ethiopian_laws/federal/pr_1074_2018/en/pdf))
- MoTL and Ethio telecom launched a **National Traffic Point-Based Penalty Management System** (central driver infraction
  database, points, fine payment by web, app or SMS), plus a cross-country public transport system and a fuel system. Federal
  and regional governments can use these "without extra cost". ([Ethiopian Business Review](https://ethiopianbusinessreview.net/ethiopia-unveils-nationwide-digital-systems-to-transform-transport-fuel-and-traffic-management/), [Developing Telecoms](https://developingtelecoms.com/telecom-technology/oss-service-management/18486-transport-and-telecoms-come-together-in-new-services-across-ethiopia.html), [Shega](https://shega.co/news/ethiopia-integrates-fuel-fares-and-fines-in-sweeping-digital-reform))
- A May 2026 report describes a **fully digital driver registration, training, assessment and certification platform**, with
  retesting of existing drivers. The report is unconfirmed. ([Birr Metrics](https://birrmetrics.com/transport-ministry-forces-all-drivers-into-mandatory-retesting-under-new-digital-control-system/)) Earlier reports covered digital
  licences with chips and a World Bank-funded consolidation of licensing and registration. ([Addis Fortune](https://addisfortune.news/ministry-to-integrate-traffic-transport-management-systems-spending-107m), [Addis Fortune: digital licence](https://addisfortune.news/digital-driving-license-becomes-trans-national-ids))
- **Design consequences:**
  - Licensing, fines and cross-country transport each need an **integration adapter** (`NationalDriverPlatform`,
    `TrafficPenaltySystem`, `CrossCountryTransport`). ITRMS must never be a second source of truth for points or national
    licence status.
  - ITRMS keeps the **zone's work** that the national systems do not cover: the counter workflow, document checks, exams
    organisation, training-school oversight, print batches, fee receipts, campaigns, accident records, reports.
  - **Strategic risk:** the Phase 0 demo (driver licence) sits in the area the ministry is centralising. The demo should show
    the workflow, configuration and reports value, and a fake national adapter, so the bureau sees ITRMS as *complementing*
    the national platform. Confirm with the bureau which licensing steps stay local.

### 3.1 Licence rules in Proclamation 1074/2018 (they drive the Phase 0 forms, workflows and fees)
Source: the proclamation text as published by [Chilot](https://chilot.wordpress.com/2021/03/12/drivers-qualification-certification-license-proclamation-no-1074-2018/)
([PDF](https://chilot.wordpress.com/wp-content/uploads/2023/02/7c328-proclamation-no.-1074-2018-drivers-qualification-certification-license-proclamation.pdf)).
The schedule of categories was not in the page text, so the categories come from Art. 12. Check them against the Negarit
Gazette and any later amendment ⚠️.

| Category | Min. education | Min. age | Prerequisite (Art. 12) |
|---|---|---|---|
| Motorcycle; Automobile | grade 4 | 18 | — |
| Three-wheel motorcycle | grade 10 | 20 | — |
| Truck I; Public transport I | grade 10 | 22 | — |
| Truck II; Public transport II; Tanker I | grade 10 | 24 | 1 year on a permanent Truck I / Public transport I licence (not for Tanker I) |
| Truck III; Public transport III; Tanker II | grade 10 | 26 | 1 year on a permanent Truck II / Public transport II / Tanker I licence |
| Machinery operator | grade 10 | 20 | — |
| Taxi driving | grade 10 | — | permanent automobile or public transport licence + taxi driver certificate |

- **Upgrades** go step by step within a category (Art. 7(2)), with theory and practical training and testing (Art. 7(3)–(4)).
- **Application documents** (Art. 14(2)): education certificate; birth certificate, passport or kebele ID; medical
  examination result; proof of training from a training institution. Applications may be made in person, by post or
  **electronically** (Art. 14(1)).
- **Medical fitness** (Art. 13): certificate from a medical institution. A disputed result may go to a second and a third
  institution.
- **Temporary licence:** valid **2 years** (Art. 15(2)). It becomes permanent depending on the offence and accident record
  of those 2 years (Art. 15(3)).
- **Permanent licence:** valid **4 years** (Art. 19(1)). It is renewed for 4 years on a medical examination and the fee
  (Art. 19(2)), and **every 2 years for holders over 55** (Art. 19(4)). No renewal through an agent twice in a row
  (Art. 19(3)).
- **Late renewal** of more than 1 year after expiry: practical exam required; temporary holders also need an offence record
  check (Art. 19(5)).
- **Replacement** of a lost, damaged or outdated licence after paying the fee. A found old licence must be returned for
  cancellation (Art. 18).
- **Foreign and international licences:** an equivalent Ethiopian licence where there is reciprocity. Visitors may drive 45
  days on a foreign licence (Art. 15(4)–(5)). The international licence (1949 Geneva Convention) is issued by the
  **federal Authority** (Art. 5(11)).
- **Licensing bodies** are federal or regional institutions acting under delegation from the federal Authority (Art. 2(6),
  Art. 6). Decisions can be appealed within 30 days (Art. 24).

**Design consequences:**
- The `licence_grades` catalogue is seeded from this table (configuration, versioned).
- Eligibility rules (age, education, prerequisite with months held) are server-side checks in the `competency` module.
- The renewal fee rule and workflow branch on "expired more than 1 year" (practical exam step) and on "over 55" (2-year
  validity).
- Validity dates are computed by the effects. They are never typed in.
- **DVC-08 (international licence):** the zone takes the application and forwards it, because issuing is federal.

## 4. Payments

- **Ministry of Finance Directive No. 1069/2025:** federal public institutions must accept payment from **any NBE-licensed
  payment provider**, with no preference for telebirr or CBE Birr. The institution must receive the full service amount. There
  was a 90-day integration deadline and 30-day progress reports. Cash is not banned. ([Techpoint Africa](https://techpoint.africa/news/ethiopia-mandates-government-offices-digital-payments/), [Shega](https://shega.co/news/ethiopia-mandates-government-offices-to-accept-digital-payments-from-all-service-providers), [Addis Fortune](https://addisfortune.news/finance-ministry-mandates-open-access-to-digital-payments-in-public-sector), [Addis Insight](https://addisinsight.net/2025/06/24/ethiopias-latest-digital-payment-directive/))
- **Design consequences:**
  - The `PaymentProvider` interface must allow several providers at once. A licensed aggregator plus direct telebirr and CBE
    Birr covers it. Provider charges must never reduce the recorded fee.
  - Cash at the counter stays a first-class method.
  - Regional bureaus may follow the federal directive. Consider moving online payment earlier than Phase 3 if the region asks.

## 5. Identity: Fayda

- The Fayda digital ID (Digital ID Proclamation 1284/2023) has over 29 million registrations and integrations with dozens of
  agencies. A relying party may make it mandatory with its regulator's approval. Banks require it by 31 Dec 2026, and it is
  being linked to passports. ([Biometric Update](https://www.biometricupdate.com/202501/mandatory-digital-id-for-banking-policy-goes-into-effect-in-ethiopia), [MOSIP country spotlight](https://connect.mosip.io/resources_pdf_2026/Inclusive_Identity_at_Scale_Ethiopia.pdf), [Ethio telecom FAQ](https://www.ethiotelecom.et/national-id/), [Biometric Update: passports](https://www.biometricupdate.com/202606/ethiopia-links-digital-id-with-passport-system-in-utility-first-adoption-push))
- **Design consequences:**
  - Capture the Fayda number (FIN/FAN) as an optional, verified-or-not field from Phase 0.
  - Matching people by Fayda number prevents duplicate persons in the register.
  - Real verification (NIDP, MOSIP-based APIs) stays in Phase 3 and needs an NIDP agreement.

## 6. Data protection, hosting and security ⚠️

- **Personal Data Protection Proclamation No. 1321/2024** (in force July 2024) applies to public and private bodies. It
  requires registration of controllers and processors with the authority (reported as the Ethiopian Communication
  Authority), security measures, records, impact assessments, a data protection officer, and **breach notification within 72
  hours**. It reportedly also requires **storing locally collected personal data on servers in Ethiopia**. ([Digital Policy Alert](https://digitalpolicyalert.org/event/24905-adopted-personal-data-protection-proclamation-proclamation-no-13212024-including-cybersecurity-regulation), [Mehrteab Leul](https://mehrteableul.com/legal-update-on-the-ethiopian-personal-data-protection-proclamation-no-1321-2024/), [text](https://www.metaappz.com/References/ethiopian_laws/federal/pr_1321_2024/en/txt))
- The **Critical Infrastructure Cybersecurity Proclamation No. 1426/2026** is in force (Federal Negarit Gazette No. 41,
  July 2026). Its twelve critical-infrastructure sectors include **Transport** and **Government Services**. Owners that
  INSA designates must, among 18 duties, implement INSA's mandatory frameworks, hold and renew INSA cyber-audit and
  inspection certificates, obtain **INSA security clearance before integrating new or upgraded ICT systems** (Art. 7(12)),
  secure their supply chain (Art. 7(11)) and report incidents to the national CERT **within 48 hours** (Art. 7(14)). ([text](https://www.insa.gov.et/pdf/critical-infrastructure-cybersecurity-proclamation-no-14262026-1786083598), [The Reporter](https://www.thereporterethiopia.com/50524/), [Ethio-CERT](https://www.ethiocert.gov.et/news/africas-cybersecurity-threat-and-ethiopias-new-security-proclamation))
- **How INSA audits:** against its **Critical Mass Cyber Security Requirement Standard (CMCSRS) v2.0** for organisations,
  and Common Criteria for products. Documents are reviewed first, then compliance and substantive tests; findings are
  major or minor nonconformities or observations, and the result is a 0–100 maturity score (76–90 "mature"). CMCSRS 6.14(f)
  expects INSA to evaluate a system's requirements and design before it is procured or developed. Web applications are
  submitted to INSA's Cyber Security Audit Division with its *Web Applications Audit Request* form (OF/AEAD/001). ([Audit and Evaluation Guideline](https://www.insa.gov.et/pdf/cyber-security-audit-and-evaluation), [CMCSRS](https://www.insa.gov.et/pdf/critical-mass-cyber-security-requirement-satandard), [request form](https://cyberaudit.insa.gov.et/guidelines/Web_Application_Security_Testing_Requirements_Document_4_5.pdf))
- **Design consequences:**
  - On-premise installation per region fits localisation.
  - **Off-site backups must go to a second site inside Ethiopia** (another bureau server, a zone server, or an Ethiopian
    data centre such as Ethio telecom's or Wingu Africa's), never a foreign cloud (ADR-0012 updated).
  - The rules are written down in the [security standard](platform/security.md) (ADR-0033), mapped to CMCSRS.
  - An **INSA security evaluation** becomes part of the Phase 1 pilot gate. Prepare for it from Phase 0: threat model,
    dependency licence/vulnerability list, pentest findings closed, audit log.
  - Add the PDP duties to the product: breach-notification runbook, records of processing, DPIA template per service, DPO
    contact per installation, access logging for personal data.

## 7. Electronic documents and signatures

- **Electronic Signature Proclamation 1072/2018** and **Electronic Transactions Proclamation 1205/2020** give electronic
  records and reliable electronic signatures legal standing. The 2018 law aims explicitly at e-government services. Its scope
  is debated for documents as opposed to messages. ([DM Ethio Lawyers](https://dmethiolawyers.com/electronic-signature-in-ethiopia/), [Shega DFS hub](https://digitalfinance.shega.co/resource/policy-and-regulations/policy-and-regulation-6))
- **Design consequences:**
  - Printed certificates keep the wet stamp and signature (current practice). QR verification proves the record exists.
  - PKI digital signatures on PDFs (PAdES) are a later option, once the bureau has a certificate from the national root CA.
    Keep a `signature` hook in the document pipeline.

## 8. Civil service pay, tax and pension (HR / payroll list) ⚠️

- **Salary scale:** the Civil Service Commission revised the federal and regional scale from September 2025. The minimum
  rose from 4,760 to 6,000 birr and the maximum from 21,492 to 39,000 birr (one report tables up to 50,000), and degree entry
  pay from 6,940 to 11,500 birr. Each employee is mapped to a step on the new scale. A 2024 revision came before it. Grades
  run I–XV+ with steps (the Form 15 scans show grades IV–XV). ([ENA](https://www.ena.et/web/eng/w/eng_7157077), [Addis Standard](https://addisstandard.com/ethiopia-raises-civil-servants-salaries-degree-holder-entry-pay-set-at-11500-birr-from-september/), [Addis Insight](https://www.addisinsight.net/2025/10/02/ethiopias-new-civil-service-salary-scale-from-6000-to-50000-birr/))
- **Employment income tax:** Income Tax (Amendment) **Proclamation 1395/2025** (from July/August 2025) sets monthly bands:
  0–2,000 exempt; 2,001–4,000: 15%; 4,001–7,000: 20%; 7,001–10,000: 25%; 10,001–14,000: 30%; above 14,000: 35%. ([EY](https://taxnews.ey.com/news/2025-2542-ethiopia-issues-a-new-income-tax-proclamation), [PwC](https://taxsummaries.pwc.com/ethiopia/individual/significant-developments), [Chambers](https://chambers.com/articles/what-s-changed-under-ethiopia-s-new-income-tax-amendment-proclamation-no-1395-2025), [TaxDev](https://www.taxdev.org/news-events/ethiopias-revised-income-tax-explained))
- **Pension:** the Public Servants Pension **Proclamation 1267/2022** governs public servants. Secondary sources give **7%
  employee + 11% employer**, but this is not verified in the proclamation text, and the base (basic or gross) is disputed. ([text](https://www.metaappz.com/References/ethiopian_laws/federal/pr_1267_2022/en/pdf))
- **Design consequences** (payroll list scope, ADR-0016):
  - Salary scales, allowances, tax bands and pension rates are **versioned configuration tables with effective dates**,
    because they changed in 2024 and 2025. They are not code.
  - The calculation is a pure, tested function: integer santim, explicit rounding. A sample is reviewed with the zone finance
    office before go-live.
  - The office prepares and approves the monthly payroll list. Finance pays and does its own accounting.

## 9. Languages and calendar

- Amharic is the federal working language. Afaan Oromo, Tigrinya, Somali and Afar were added as federal working languages.
  Regions and zones use their own languages. Wolaytta (ISO 639-3 `wal`) is taught in schools in Latin script
  ([Wikipedia](https://en.wikipedia.org/wiki/Wolaytta_language)); ITRMS uses `wal-Latn` for Wolaita.
- **Design:** per-tenant language list (ADR-0015); fonts for Ethiopic (Noto Sans Ethiopic) and Latin-script languages.
- The Ethiopian calendar is used officially (the scans are dated "10/07/2018 ዓ.ም" = Ethiopian year 2018). The fiscal year is
  Hamle 1 – Sene 30 (≈ 8 July – 7 July).

## 10. What this changes in the plan (summary)

| Change | Where |
|---|---|
| Vehicles carry the federal vehicle id; national registry adapter; plate exchange service | architecture §6, §16; phase-1 |
| National driver platform and point-based penalty adapters; ITRMS complements, never duplicates | architecture §16; phase-0 demo framing; phase-2 fines |
| Several payment providers at once; cash stays | architecture §9; phase-3 |
| Backups stay inside Ethiopia; PDP duties; INSA evaluation before pilot | ADR-0012; phase-1 gate |
| Office payroll list is in scope (prepare, approve, send to Finance); disbursement and accounting are not | ADR-0016; phase-3 |
| Org units carry category/grade | architecture §5 |
