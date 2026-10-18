# Progress log

> **Generated** from [`progress.json`](progress.json) by `node tools/progress/cli.mjs render`. Do not edit by hand.
> Update it with the CLI or the `/task-*` skills. Rules: [workflow.md](workflow.md). Statuses: planned, ready, in progress,
> in review, done, blocked. Only the product owner moves a task to **done**.

Last updated: 2026-10-18. Planning: done (docs/reviews/2026-10-18-design-review.md (30 findings resolved); business questionnaire sent via the Wolaita channel).

## Phase 0: Core and demo — 1/28 done (4%)

**Gate:** Demo validated by officials of at least two bureaus or zones (feedback in docs/discovery/)

| Task | Title | Status | Branch / commits | Evidence | Notes / blockers |
|---|---|---|---|---|---|
| 0.1 | Baseline commit and repo hygiene | **done** | `task/0.1-baseline`, 67c0d93 (tag legacy-dfc), 9112b25, 1c712b2, ad48447, 0d8dbcd (squash on main) | git status clean; 525 tracked files; 0 env or Documents files tracked; regex secret scan over 522 new files: 8 hits, all placeholders or test fixtures (none real); AUTH_SECRET unused in code (not carried over); demo password removed from docs; LICENSE, NOTICE, README added; tag legacy-dfc created | Not pushed (needs approval). gitleaks runs in CI from 0.2. |
| 0.2 | Monorepo skeleton, CI, security scans | **ready** |  |  |  |
| 0.3 | Dev stack (Docker Compose) | planned |  |  |  |
| 0.4 | Move the web app and the design system | planned |  |  |  |
| 0.4a | Design-system documentation, visual tests and page templates | planned |  |  |  |
| 0.5 | Extract the form engine and shared schemas | planned |  |  |  |
| 0.6 | API skeleton | planned |  |  |  |
| 0.7 | Database foundation and audit log | planned |  |  |  |
| 0.8 | Org tree | planned |  |  |  |
| 0.9 | Row-level security and the isolation test matrix | planned |  |  |  |
| 0.10 | Keycloak, BFF sign-in, guards, group sync | planned |  |  |  |
| 0.11 | Numbering, idempotency, outbox, jobs | planned |  |  |  |
| 0.12 | Ethiopian calendar package | planned |  |  |  |
| 0.13 | i18n platform | planned |  |  |  |
| 0.14 | People and organisations register | planned |  |  |  |
| 0.15 | Files on object storage | planned |  |  |  |
| 0.16 | Forms API port with server-side validation | planned |  |  |  |
| 0.17 | Form engine for ITRMS, part 1 | planned |  |  |  |
| 0.18 | Form engine for ITRMS, part 2 | planned |  |  |  |
| 0.18a | Form governance: contracts, stability, checks, tests | planned |  |  |  |
| 0.19 | Workflow engine, part 1: definitions, cases, transitions | planned |  |  |  |
| 0.20 | Workflow engine, part 2: SLA, inbox, case page, drafts, notifications | planned |  |  |  |
| 0.21 | Service catalogue and configuration inheritance | planned |  |  |  |
| 0.22 | Fees, payment orders, cashier, receipts | planned |  |  |  |
| 0.23 | Document templates, PDF worker, QR verification | planned |  |  |  |
| 0.24 | Driver-licence slice (competency module) | planned |  |  |  |
| 0.25 | Demo data and the demo journey | planned |  |  |  |
| 0.26 | Demo installation and Phase 0 hardening | planned |  |  |  |

## Phase 1: Licensing services — 0/25 done (0%)

**Gate:** Entry: a signed pilot agreement. Gate: pilot at one zone office for 8 weeks, INSA evaluation passed

| Task | Title | Status | Branch / commits | Evidence | Notes / blockers |
|---|---|---|---|---|---|
| 1.1 | Vehicle registry | planned |  |  |  |
| 1.2 | Registration and plates | planned |  |  |  |
| 1.3 | Bolo technical inspection | planned |  |  |  |
| 1.4 | Ownership transfer and zone transfer out/in | planned |  |  |  |
| 1.5 | Replacements | planned |  |  |  |
| 1.6 | Driver licence family | planned |  |  |  |
| 1.7 | Exams and training schools | planned |  |  |  |
| 1.8 | Licence print batches | planned |  |  |  |
| 1.9 | Freight competency | planned |  |  |  |
| 1.10 | Public transport, part 1 | planned |  |  |  |
| 1.11 | Public transport, part 2 | planned |  |  |  |
| 1.12 | Cashier operations | planned |  |  |  |
| 1.12a | Controlled stationery | planned |  |  |  |
| 1.12b | Appeals and correspondence | planned |  |  |  |
| 1.12c | Training installation | planned |  |  |  |
| 1.13 | Paper-record migration tooling | planned |  |  |  |
| 1.13a | Form platform, part 3 | planned |  |  |  |
| 1.14 | National system adapters | planned |  |  |  |
| 1.15 | SMS gateway (real) | planned |  |  |  |
| 1.16 | Licensing reports and dashboards | planned |  |  |  |
| 1.16a | Upload scanning | planned |  |  |  |
| 1.17 | Data protection | planned |  |  |  |
| 1.18 | Production operations | planned |  |  |  |
| 1.19 | Security and INSA evaluation pack | planned |  |  |  |
| 1.20 | Pilot preparation | planned |  |  |  |

## Phase 2: Roads and safety — 0/14 done (0%)

**Gate:** Zone-wide use for one fiscal quarter, quarterly report accepted

| Task | Title | Status | Branch / commits | Evidence | Notes / blockers |
|---|---|---|---|---|---|
| 2.1 | Roads parties and projects | planned |  |  |  |
| 2.2 | Unit rates and designs | planned |  |  |  |
| 2.3 | Contract administration | planned |  |  |  |
| 2.4 | Payment certificates | planned |  |  |  |
| 2.5 | Construction supervision and quality audits | planned |  |  |  |
| 2.6 | Rural access road works progress | planned |  |  |  |
| 2.7 | Community participation | planned |  |  |  |
| 2.8 | Logistics | planned |  |  |  |
| 2.9 | Road safety programmes | planned |  |  |  |
| 2.10 | Traffic inspections and fines | planned |  |  |  |
| 2.11 | Accident records | planned |  |  |  |
| 2.12 | Field capture on phones | planned |  |  |  |
| 2.13 | Roads and safety reports | planned |  |  |  |
| 2.14 | Zone-wide rollout | planned |  |  |  |

## Phase 3: Office and scale — 0/13 done (0%)

**Gate:** Regional rollout: all zones live, payroll list accepted 3 months, second region contracted

| Task | Title | Status | Branch / commits | Evidence | Notes / blockers |
|---|---|---|---|---|---|
| 3.1 | Staff register and positions | planned |  |  |  |
| 3.2 | Leave | planned |  |  |  |
| 3.3 | Benefits, retirement, HR reports | planned |  |  |  |
| 3.4 | Payroll configuration | planned |  |  |  |
| 3.5 | Monthly payroll list | planned |  |  |  |
| 3.6 | Annual budget and procurement plan | planned |  |  |  |
| 3.7 | Quarterly performance and capital project progress | planned |  |  |  |
| 3.8 | Online payments | planned |  |  |  |
| 3.9 | Fayda integration | planned |  |  |  |
| 3.10 | Onboarding tooling | planned |  |  |  |
| 3.11 | Further zones and languages | planned |  |  |  |
| 3.12 | Cross-region transfer API | planned |  |  |  |
| 3.13 | Scale and operations | planned |  |  |  |

## Follow-ups

| Found in | Item | Moved to |
|---|---|---|
| 0.1 | No .gitattributes: Windows CRLF conversion warnings | 0.2 (* text=auto eol=lf) |
| 0.1 | gitleaks not installed locally: regex scan used instead | 0.2 (pre-commit hook + CI) |
| 0.1 | Legacy e2e/demo scripts contain the local demo password literal | 0.4 / 0.25 (env-based fixtures) |
| 0.1 | First commit b3e108e on origin/main (private repo) still contains the government documents in history | product owner decision before sharing the repository |
