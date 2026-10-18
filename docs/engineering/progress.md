# Progress log

> **Generated** from [`progress.json`](progress.json) by `node tools/progress/cli.mjs render`. Do not edit by hand.
> Update it with the CLI or the `/task-*` skills. Rules: [workflow.md](workflow.md). Statuses: planned, ready, in progress,
> in review, done, blocked. Only the product owner moves a task to **done**.

Last updated: 2026-10-18. Planning: done (docs/reviews/2026-10-18-design-review.md (30 findings resolved); business questionnaire sent via the Wolaita channel).

## Phase 0: Core and demo — 2/28 done (7%)

**Gate:** Demo validated by officials of at least two bureaus or zones (feedback in docs/discovery/)

| Task | Title | Status | Branch / commits | Evidence | Notes / blockers |
|---|---|---|---|---|---|
| 0.1 | Baseline commit and repo hygiene | **done** | `task/0.1-baseline`, 67c0d93 (tag legacy-dfc), 9112b25, 1c712b2, ad48447, 0d8dbcd (squash on main) | git status clean; 525 tracked files; 0 env or Documents files tracked; regex secret scan over 522 new files: 8 hits, all placeholders or test fixtures (none real); AUTH_SECRET unused in code (not carried over); demo password removed from docs; LICENSE, NOTICE, README added; tag legacy-dfc created | Not pushed (needs approval). gitleaks runs in CI from 0.2. |
| 0.2 | Monorepo skeleton, CI, security scans | **done** | `task/0.2-monorepo-skeleton`, ce13bce, 065097f, 158f2c1 (squash on main) | pnpm install --frozen-lockfile → ok, 20 workspace projects, lockfile passes pnpm minimumReleaseAge 14 days; pnpm turbo run lint typecheck test build --force → 60 successful, 60 total (19 packages); pnpm boundaries → no dependency violations (78 modules); deliberate packages/schemas → packages/ui import in the real tree → exit 1 (leaf-packages-import-nothing-internal), reverted; pnpm test:tools → 39/39: every dependency-cruiser rule has a failing fixture (incl. work-process → work-process, system pool via re-export and via job registration), allowed imports clean, scaffold tests; pnpm check:slices → 8 slices follow the slice shape; turbo gen module+feature+screen+effect → generated slice passed lint, typecheck, test (1 spec); pnpm --filter @itrms/module-sdk test → 5/5; pnpm format:check → clean; pnpm audit --audit-level high → 0 vulnerabilities; licence report → 188 packages, 2 MPL-2.0 for review (lightningcss, dev only); lefthook pre-commit (prettier, eslint, gitleaks) ran on both commits → pass; task-verifier (Sonnet) → ready with caveats (CI on a PR unverifiable until pushed); reviewer (Opus) → 12 findings, 11 fixed in 065097f, 1 deferred to 0.6; NOT SHOWN: CI green on a PR — needs the product owner's approval to push | Toolchain pinned to current releases at least two weeks old (2026-10-04 cutoff): pnpm 12.9.1, Turborepo 2.11.7, TypeScript 6.0.3 (typescript-eslint 8.71 supports <6.1, so not TS 7 yet), ESLint 10.12, Vitest 5.0.3, dependency-cruiser 18.5, lefthook 2.1.16; tech-stack T24/T25 updated. pnpm 12 blocks dependency build scripts: esbuild and lefthook allowed in pnpm-workspace.yaml allowBuilds. turbo agentGuidance disabled (it writes AGENTS.md when an agent runs it). Trivy action pinned to a commit SHA because its tags were re-published on 2026-03-20. Closes 0.1 follow-ups: .gitattributes (* text=auto eol=lf) and gitleaks (lefthook pre-commit when installed + CI job). Verifier (task-verifier): ready with caveats; CI-on-PR unverifiable until pushed. Its gap fixed: contracts-are-isomorphic is now an allow-list (schemas, own contracts, other slices' public contracts) with a new bad-ui fixture; tool tests 28/28. Reviewer (Opus) report pending. Reviewer (Opus) found 12 issues; all fixed except the registry dependsOn check (follow-up, 0.6): system pool unreachable from HTTP entries (reachability rule + ./api/worker entry + worker-only jobs/handlers), unresolved @itrms/# imports fail, tighter tool/ui package rules, ignore files anchored, renovate.json valid with digest capture, gitleaks scans the whole push range, main runs never cancelled, scanner images digest-pinned, Trivy coverage check + pnpm audit, turbo transit for cache correctness, ESLint no-DOM in core/contracts/api, scaffold escaping and duplicate-name check, pnpm minimumReleaseAge 14 days (re-resolved 24 transitive entries that were too new). Pushed main (b3e108e..e110d22) on the owner's go-ahead. First CI run 39124679969: no job started; GitHub annotation: recent account payments failed or the spending limit needs raising (Billing & plans). CI-green evidence still outstanding. |
| 0.3 | Dev stack (Docker Compose) | **in review** | `task/0.3-dev-stack`, 2f549cc, f2ed76e, 0ca59ce, 5823cc1, 97e3a20 | Windows/WSL2 from zero (volumes and .env deleted): pnpm dev:infra --observability → healthy and seeded in 104 s (16 services; host-side readiness for Loki, Tempo, Alloy, GlitchTip); pnpm dev:infra:check → 10/10: S3 buckets, Keycloak users dev.admin/dev.officer/dev.cashier, storage isolation with control, OTLP log in Loki and trace in Tempo via Alloy, GlitchTip reads its database; pnpm test:int → S3 contract suite 17/17 against SeaweedFS 4.48 (POST policy size/type, presigned PUT/GET, signed type and size, expiry, tampering, credentials, anonymous, multipart incl. bounded part URLs and abort, copy, lifecycle, delete, list), every refusal with a positive control; S3_ENDPOINT passes through turbo: a dead endpoint fails the suite; .env drift guard refuses up; status writes no secrets; .env ACL = owner only; pnpm turbo run lint typecheck test → 57/57; pnpm test:tools → 44/44; pnpm boundaries → 0 violations; pnpm audit → 0 vulnerabilities; pre-commit hooks pass; task-verifier → ready with caveats; reviewer (Opus) → 12 findings, all fixed in 97e3a20 (3 parts recorded for 0.15/0.26); NOT SHOWN: Linux — CI job infra exists but GitHub Actions is blocked by account billing (follow-up 11) |  |
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

| # | Found in | Item | Moved to | Closed |
|---|---|---|---|---|
| 1 | 0.1 | No .gitattributes: Windows CRLF conversion warnings | 0.2 (* text=auto eol=lf) | ✔ 0.2: .gitattributes with * text=auto eol=lf |
| 2 | 0.1 | gitleaks not installed locally: regex scan used instead | 0.2 (pre-commit hook + CI) | ✔ 0.2: gitleaks in lefthook pre-commit (when installed) and in CI |
| 3 | 0.1 | Legacy e2e/demo scripts contain the local demo password literal | 0.4 / 0.25 (env-based fixtures) | open |
| 4 | 0.1 | First commit b3e108e on origin/main (private repo) still contains the government documents in history | product owner decision before sharing the repository | open |
| 5 | 0.2 | Generator templates feature/screen/effect produce compile-safe placeholders; fill them with the real kernel APIs (db.scoped, @Require, Drizzle + withRls, @Effect, page templates) | 0.4 (screen), 0.6 (controller, service), 0.7/0.9 (repository, table), 0.19 (effect) | open |
| 6 | 0.2 | Trivy and Semgrep skip the legacy dirs Frontend/, Backend/, contracts/, features/ | 0.4–0.6: remove the skips when the legacy code is moved or retired | open |
| 7 | 0.2 | Dev machine has Node 22.16 and global pnpm 9.15; the repo requires Node 24 LTS and pnpm 12.9.1 | product owner: install Node 24 LTS and run npm i -g pnpm@12.9.1 | ✔ 0.2: Node 24.20.0 LTS (winget) and pnpm 12.9.1 (npm -g) installed on the dev machine; .nvmrc pinned to 24.20.0; checks re-run on Node 24: 60/60 tasks, 39/39 tool tests |
| 8 | 0.2 | TypeScript 7 (native compiler) is out but typescript-eslint supports <6.1 | Renovate: upgrade when typescript-eslint supports TS 7 | open |
| 9 | 0.2 | A registry importing another registry that its manifest's dependsOn does not name is not checked (dependency-cruiser can't read manifests; only cycles are caught) | 0.6: manifest loader compares dependsOn with the package's imports | open |
| 10 | 0.2 | Trivy's reading of the two-document pnpm-lock.yaml could not be confirmed locally (Docker not running); CI now fails if Trivy lists fewer than vitest/eslint/typescript | first CI run after the push: check the 'Trivy findings and coverage' step | open |
| 11 | 0.2 | GitHub Actions jobs are not starting: account billing / spending limit (run 39124679969) | product owner: fix Billing & plans on github.com, then re-run the ci workflow and check the Trivy coverage step | open |
| 12 | 0.2 | ubuntu-latest moves to Ubuntu 26 from 2026-10-19 (GitHub notice in run 39124679969) | 0.3: pin runs-on to ubuntu-24.04 (exact runner image, like every other pin) | ✔ 0.3: runs-on pinned to ubuntu-24.04 in every CI job (f2ed76e) |
| 13 | 0.3 | AWS SDK v3 signs a default CRC checksum into presigned PUT URLs, so every browser upload fails with BadDigest; set requestChecksumCalculation/responseChecksumValidation to WHEN_REQUIRED (done in the contract suite) | 0.15: the ObjectStore adapter uses the same client settings and the same contract suite | open |
| 14 | 0.3 | Presigned PUT and part URLs bind content type and size only when they are signed headers (the SDK signs only host by default); POST policy enforces both (contract suite proves it) | 0.15: sign content-type and content-length on every presigned PUT/part URL; POST policy for small files | open |
| 15 | 0.3 | SeaweedFS stores lifecycle rules, but expiry after 24 h can't be proven in a test run | 0.15: the purge job is the guarantee for incomplete and unconfirmed uploads; its test is in 0.15 | open |
| 16 | 0.3 | SeaweedFS master/volume/filer have no authentication (isolated on its own network in dev) | 0.26: SeaweedFS security.toml JWT, internal network with only api/worker/nginx | open |
