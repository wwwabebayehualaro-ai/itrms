# Progress log

One row per task, updated when a task changes state. Evidence follows [workflow.md](workflow.md) §4. Statuses: planned,
ready, in progress, in review, done, blocked.

## Phase 0: Core and demo

| Task | Title | Status | PR / commit | Evidence | Notes |
|---|---|---|---|---|---|
| — | Planning documentation | done | (uncommitted) | design review: `../reviews/2026-10-18-design-review.md` (30 findings resolved) | business questions sent to the zone (docx) |
| 0.1 | Baseline commit and repo hygiene | **in review** | branch `task/0.1-baseline`: 67c0d93 (tag `legacy-dfc`), 9112b25, 1c712b2 + this log | `git status` clean; 525 tracked files, 0 env/Documents files tracked; regex secret scan over 522 new files: 8 hits, all placeholders or test fixtures (none real); `AUTH_SECRET` unused in code (not carried over); demo password removed from docs; LICENSE/NOTICE/README added | not pushed (needs approval); gitleaks itself runs in CI from 0.2 |
| 0.2 | Monorepo skeleton, CI, security scans | planned | | | |
| 0.3 | Dev stack (Docker Compose) | planned | | | |
| 0.4 | Move the web app and the design system | planned | | | |
| 0.4a | Design-system documentation, visual tests, page templates | planned | | | |
| 0.5 | Extract the form engine and shared schemas | planned | | | |
| 0.6 | API skeleton | planned | | | |
| 0.7 | Database foundation and audit log | planned | | | |
| 0.8 | Org tree and unit types | planned | | | |
| 0.9 | RLS and the isolation matrix | planned | | | |
| 0.10 | Keycloak, BFF, role assignments, shell | planned | | | |
| 0.11 | Numbering, idempotency, outbox, jobs | planned | | | |
| 0.12 | Ethiopian calendar package | planned | | | |
| 0.13 | i18n platform and Ethiopic input | planned | | | |
| 0.14 | People and organisations register | planned | | | |
| 0.15 | Files on object storage | planned | | | |
| 0.16 | Forms API port with server-side validation | planned | | | |
| 0.17 | Form engine for ITRMS, part 1 | planned | | | |
| 0.18 | Form engine for ITRMS, part 2 | planned | | | |
| 0.18a | Form governance: contracts, stability, checks, tests | planned | | | |
| 0.19 | Workflow engine, part 1 | planned | | | |
| 0.20 | Workflow engine, part 2 | planned | | | |
| 0.21 | Service catalogue, configuration inheritance, settings | planned | | | |
| 0.22 | Fees, payment orders, cashier, receipts | planned | | | |
| 0.23 | Documents, PDF worker, signed QR verification | planned | | | |
| 0.24 | Driver-licence slice | planned | | | |
| 0.25 | Demo data and journey | planned | | | |
| 0.26 | Demo installation and hardening | planned | | | |

## Follow-ups
Items found during tasks that belong elsewhere (with the task or issue they were moved to).

| Found in | Item | Moved to |
|---|---|---|
| 0.1 | No `.gitattributes`: Windows CRLF conversion warnings | 0.2 (`* text=auto eol=lf`) |
| 0.1 | gitleaks not installed locally: regex scan used instead | 0.2 (pre-commit hook + CI) |
| 0.1 | Legacy e2e/demo scripts contain the local demo password literal | replaced with env-based fixtures in 0.4 / 0.25 |
| 0.1 | The first commit `b3e108e` on `origin/main` (private repo) still contains the government documents in history | product owner decision: keep, or rewrite history before sharing the repository |
