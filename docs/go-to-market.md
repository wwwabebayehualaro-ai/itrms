# Go-to-market: a self-built product for every bureau in Ethiopia

**Vendor:** ABA Nexus Technologies (brand) / ABANEXUS SOFTWARE DEVELOPMENT PLC (licensed name), abanexustech.com,
abanexustech@gmail.com. ITRMS is the company's proprietary product. Its ownership is evidenced by the repository history,
a copyright notice in the code (task 0.1) and the company's records; bureaus will ask for this in tenders.

**Situation (2026-10-18):** ITRMS is developed on the product owner's own initiative. **No bureau has commissioned it.** The
plan is to build it and then propose it, first to the South Ethiopia Region (Wolaita Zone is the reference design) and then
to transport and road bureaus across Ethiopia. Most bureaus still work on paper, and many plan to buy a system.

Facts below are sourced; ⚠️ marks what still needs checking.

## 1. The market
* **Who buys:**
  * regional transport (and road) bureaus of the 12 regional states;
  * the transport authorities of the 2 city administrations (Addis Ababa, Dire Dawa);
  * through them, their zone departments, woreda offices and town units.
* **Why now:**
  * Licence issuance was delegated to regional and city administrations, which **operate autonomously without a central
    database, and registration and licensing are still largely manual** ([Addis Fortune, 2025](https://addisfortune.news/ministry-to-integrate-traffic-transport-management-systems-spending-107m)).
  * Digital Ethiopia 2030 and the national interoperability push (MESOB, Fayda) make digitisation a government priority
    ([ethiopia-context.md](ethiopia-context.md)).
* **What every bureau does (beyond licensing):** public transport, freight, road safety, road works and contracts,
  community participation, logistics, HR and planning. These are the same 10 work processes and 54 services we mapped for
  Wolaita. No national system covers this breadth.

## 2. Positioning against the national systems (the main competitive risk)
* **The risk:** the Ministry of Transport and Logistics is consolidating vehicle registration (Directive 1050/2025, national
  plates), driver licensing (a digital platform; a reported $107M system with smart licences) and traffic penalties (a
  point-based system with Ethio telecom). A bureau may ask "why buy ITRMS if the Ministry gives us a system?"
* **The answer, built into the architecture:**
  1. **ITRMS covers the work the national systems don't:** 54 services, of which licensing is about 11. Public transport,
     associations, tariffs, schedules, road safety programmes, accidents, road works, contracts and payment certificates,
     community works, machinery, HR, the payroll list, budget and planning. These are local and regional processes.
  2. **For licensing and registration, ITRMS is the bureau's operational layer around the national record:** intake,
     document checks, exams organisation, fees and receipts, approvals, print batches, local reports. It stores the national
     references and never competes with them (ADR-0013, adapters).
  3. **It makes national integration cheaper for the region:** clean, verified data with federal ids is ready to hand over,
     instead of paper.
* **What we never claim:** to replace the national registry, the driver platform or the penalty system.

## 3. Product implications (already in the design; this confirms them)
* **Region-agnostic from day one:**
  * org levels and names are configurable (regions without zones, city administrations with sub-cities);
  * unit types; per-region languages and the Afaan Oromo, Tigrinya, Somali, Afar and Sidaama catalogues to add;
  * fees, forms and workflows are configuration;
  * one installation per region (ADR-0008, ADR-0026).
* **Wolaita is the reference design, not a customer.** Its documents are the best real material we have. The demo shows
  Wolaita **and** a second, differently structured region, so every bureau sees itself (demo plan §1).
* **No official branding without permission.** Until a bureau signs, the demo uses "Sample Regional Transport Bureau" with a
  neutral emblem. Real names, logos, stamps and officials' names appear only for a bureau that has agreed. The Form 15 scans
  are used for structure only, never their names or signatures.
* **Configuration packages** (export and import of a configured service, enterprise-capabilities §1) let one region's
  setup be reused by the next, which lowers the cost of every new sale.

## 4. Discovery before and during Phase 0 (replacing "the bureau answers our questions")
Building without a customer is the biggest product risk. Mitigation:
* **The Amharic questionnaire** (`business-questions/`) becomes a **discovery interview guide**. Use it in conversations
  with officials you can reach: Wolaita and 2–3 other zones or bureaus.
* **Target:** at least 5 discovery conversations before task 0.24 (the licence slice). Collect blank paper forms, fee
  schedules and the approval chain from each. Record the answers in `docs/discovery/` (one file per conversation, no
  personal data beyond names and roles, used only with consent).
* Where answers differ between regions, the difference becomes **configuration**, never a fork.

### 4.1 The Wolaita channel
The product owner's partner works in Wolaita Zone and has a communication channel there. It is used for:
1. sending the Amharic guide (`business-questions/`), starting with the high-priority questions 1–6 and 12;
2. collecting **blank** paper forms (licence application, medical certificate, exam sheet, receipt, bolo checklist,
   association renewal);
3. short sessions with the zone and Boditi competency team leaders;
4. early feedback on work in progress (around tasks 0.18–0.20), not only the final demo;
5. Wolaytta translation review;
6. introductions to other zones (for the second-region view the Phase 0 gate needs).

**Guardrails:**
* **Conflict of interest:** if the partner is a zone employee with an interest in the selling company, the interest is
  **declared in writing** before any proposal, and the partner takes **no part in any decision, evaluation or tender**
  about ITRMS. Confirm the exact disclosure and recusal rules with the procurement lawyer.
* Documents from the zone are shared with the office's permission, and used for structure only.
* **No real citizen or staff personal data** leaves the zone for development. Only blank forms and generated data.

Wolaita is therefore the most likely **first pilot** (Phase 1), on the standard pilot agreement.

## 5. Selling to government ⚠️ (verify with a procurement lawyer)
* **Federal** procurement is governed by Proclamation 1333/2024 (enacted 9 Sept 2024; tenders on the e-GP portal,
  egp.gov.et). **Regional states have their own procurement laws**
  ([DM Ethio Lawyers](https://dmethiolawyers.com/ethiopia-issues-new-federal-public-procurement-and-property-administration-proclamation-proclamation-no-1333-2024/),
  [LEAP/FAOLEX](https://leap.unep.org/en/countries/et/national-legislation/federal-public-procurement-and-property-administration)).
* **Practical path to the first sale:**
  1. Demonstrate to the bureau's leadership and ICT directorate.
  2. Offer a **no-cost pilot** at one zone (Phase 1), under a pilot agreement covering data ownership, confidentiality,
     duration and exit.
  3. The pilot's measured results (value-proposition §6) support the bureau's budget request and a **tender**, which a
     ready product with a working reference wins on requirements, price and time.
* **Expect bureaus to require:**
  * a registered Ethiopian company with a valid trade licence and tax clearance;
  * proof that the software is owned or licensed by the company;
  * an INSA security evaluation;
  * local support capacity;
  * training;
  * source-code escrow or similar continuity guarantees;
  * data hosted in Ethiopia.
* **Prepare early:** company registration and trademark, a standard pilot agreement, a data-processing agreement (PDP
  1321/2024), an escrow option, and price models (per region installation, per product, or per zone subscription; ADR-0027).

## 6. Risks for a self-built product and how the plan handles them

| Risk | Mitigation |
|---|---|
| National systems make parts redundant | positioning §2; national ids and adapters; breadth of 54 services |
| Building the wrong thing without a customer | discovery conversations (§4); configuration absorbs regional differences; demo feedback before Phase 1 |
| Long procurement cycles, cash flow | no-cost pilot → measured results → tender; a demo-ready product early; the Phase 0 scope protects the demo |
| A single developer and a large scope | phases gate scope; modular monolith; reuse of the legacy engine; strict task discipline (engineering/workflow.md) |
| Using official documents and names | structure only; no branding or personal data without permission (§3) |
| Security evaluation delays | INSA pack prepared from Phase 0 (threat model, scans, SBOM) |

## 7. Changed gates (see the phase files)
* **Phase 0 gate:** the demo is validated by officials of **at least two bureaus or zones** (feedback recorded), not
  "approved by the bureau".
* **Phase 1 gate:** a **signed pilot agreement**, then the pilot runs as planned.
