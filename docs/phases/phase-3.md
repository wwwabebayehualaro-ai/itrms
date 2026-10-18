# Phase 3: Office and scale

## Goal
Bring the office functions onto ITRMS:
- HR records and leave;
- the **office payroll list** sent to Finance (ADR-0016);
- the development plan, budget, procurement plan and performance reports.

Add online payments and Fayda identity, then scale from one zone to further zones and regions, with transfers between
regional installations.

**Gate: regional rollout.** Every zone of the first region is live on ITRMS:
- the payroll list has been sent to Finance from ITRMS for 3 consecutive months and accepted;
- the annual budget and procurement plan were prepared in ITRMS;
- online payment reconciles daily;
- a second region is installed, or contracted with an onboarding date.

## Scope
In:
- HR: staff register, positions (Form 15), leave, benefits, retirement; reports to the civil service office and the pension
  agency.
- **Payroll list:** salary scales, pay components, tax and pension tables, monthly list, approval, sending to Finance,
  monthly change report.
- Planning: annual budget, procurement plan, quarterly performance reports, capital project progress.
- Online payments from several NBE-licensed providers; Fayda verification.
- Region and zone onboarding tooling; more languages; cross-region transfer API; scale work.

Out: disbursement, bank transfers, accounting and IFMIS posting (Finance's work); Finance's own recalculation.

## Tasks (in order)

| # | Task | Done when | Tests |
|---|---|---|---|
| 3.1 | **Staff register and positions:** staff (person link, position, grade, step, unit, department, employment dates, status, bank account), Form 15 establishment import (title, job code, grade, count), vacancy view | Filled vs approved positions per unit match the Form 15 tables | Import tests; RLS (HR data is sensitive: masked by default) |
| 3.2 | **Leave:** annual leave rules per civil-service regulation (entitlement by service years, carry-over), other leave types, requests with approval, balances, unpaid leave feeding the payroll list | Balances are correct across the Ethiopian year boundary | Entitlement goldens; EC date tests |
| 3.3 | **Benefits, retirement, HR reports:** benefits records, retirement processing (age/service, pension agency file), staff data to civil service | Retirement candidates list is correct for the next 12 months | Rule tests; export format tests |
| 3.4 | **Payroll configuration:** versioned salary scales (grade × step, effective dates; the Sept 2025 scale first), pay components (allowances/deductions: taxable, pensionable, formula), income tax bands (Proclamation 1395/2025), pension rates (Proclamation 1267/2022, verified first) | A scale change on an effective date applies only from that month | Effective-date tests |
| 3.5 | **Monthly payroll list:** compute per office (basic, allowances, unpaid-leave and absence deductions, arrears, tax, pension, other deductions such as loans or court orders, net); review and correction; head approval; frozen lines; **send to Finance** (numbered QR-verified PDF + Excel/CSV in Finance's format); monthly change report | Golden cases agreed with the zone finance office match to the santim; an approved list cannot change; corrections appear in a later month as adjustments | Payroll calculation goldens (pure function); freeze and adjustment tests; export format tests |
| 3.6 | **Annual budget and procurement plan** (Ethiopian fiscal year): budget lines by programme and project, procurement plan items, approval, submission to Finance and Plan | Totals reconcile; the plan is exportable in the required format | Aggregation tests |
| 3.7 | **Quarterly performance and capital project progress:** plan vs actual from the operational data of Phases 1–2, physical progress, narrative, submission | The quarterly report is generated from data, with manual narrative only | Report cross-check tests |
| 3.8 | **Online payments:** the `PaymentProvider` interface with several providers at once (a licensed aggregator such as Chapa, plus telebirr and CBE Birr direct where required) per MoF Directive 1069/2025; payment links/USSD/QR on payment orders; signed webhooks; idempotent settlement; daily reconciliation; provider fees never reduce the recorded fee | A duplicate webhook settles once; the daily reconciliation report shows zero unexplained differences on test data | Webhook signature and idempotency tests; reconciliation goldens |
| 3.9 | **Fayda integration** (NIDP agreement required): verify identity at the counter, fill demographics with consent, store the verification result | A verified person cannot be duplicated in the register | Adapter contract tests with the NIDP sandbox |
| 3.10 | **Onboarding tooling:** a region setup wizard (levels and names, units import, languages, holidays, document headers, service overrides), installation provisioning scripts, seed of the 54 services | A new region goes from empty to configured in one day by a trained admin | Wizard e2e; provisioning smoke test |
| 3.11 | **Further zones and languages:** onboard the remaining zones of the first region; Afaan Oromo / Tigrinya / regional language catalogues as contracted | Catalogue completeness per enabled language | i18n completeness |
| 3.12 | **Cross-region transfer API** between installations: signed packets over mTLS, two-phase offer → accept, idempotent, audited on both sides; vehicles and driver records | A transfer completes once even with retries and a crash between phases; the record moves, never duplicates | Contract tests between two Compose stacks |
| 3.13 | **Scale and operations:** load test at regional volumes (10⁶ cases/year), a read replica for reports if needed, archive of closed cases, partitioning review | p95 targets met at 3× the expected load | Load test in the nightly pipeline |

## Phase acceptance criteria
1. Three consecutive monthly payroll lists accepted by Finance with no recalculation differences (or agreed differences only).
2. Budget and procurement plan for one fiscal year prepared and approved in ITRMS.
3. Online payments reconciled daily for a month with zero unexplained differences.
4. All zones of the first region live; the onboarding wizard used for at least one zone without developer help.

## Tests to write in this phase
Payroll goldens agreed with Finance (incl. tax band edges at 2,000 / 4,000 / 7,000 / 10,000 / 14,000 Birr, pension base,
unpaid leave mid-month, arrears); leave entitlement goldens; effective-dated configuration tests; payment webhook,
idempotency and reconciliation; Fayda contract tests; cross-installation transfer tests; load tests.

## Open questions
1. **Payroll calculation split:** does Finance expect the office to compute income tax and pension, or only gross items?
   Which allowances and deductions apply (transport, position, hardship, housing; loans, association dues, court orders)?
   Finance's import format.
2. Pension base and rates under Proclamation 1267/2022 (basic or gross; 7% / 11%?).
3. Should the payroll list come earlier than Phase 3? It is monthly and visible to every office, so it is a strong selling
   point.
4. Which payment providers the region already has agreements with.
5. NIDP integration terms (relying-party agreement, sandbox access).
