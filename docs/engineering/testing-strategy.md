# Testing strategy

What is tested where, with which data, and what blocks a merge. It refines ADR-0009.

## 1. Layers

| Layer | Tool | What it covers | Data | Blocks merge |
|---|---|---|---|---|
| Unit | Vitest | pure logic: calendar, formula/fee evaluator, workflow definition checks, resolvers, form validation, money helpers | inline fixtures; property tests (fast-check) for calendar, money, numbering patterns | yes |
| Component | Vitest + Testing Library; Storybook + axe | design-system components, form fields, screens in isolation, in am/en | stories' fixtures | yes |
| Integration | Vitest + Testcontainers (PostgreSQL 16, Valkey, SeaweedFS, Keycloak when needed) | repositories, RLS, audit, counters, outbox, transitions, effects, API endpoints | per-test schema; generated seed via factories | yes |
| **Isolation matrix** | Vitest, generated per table | every tenant table × own/child/parent/sibling/other zone/other region/no context (also on a reused connection) × read/write | factories | yes |
| Contract | Vitest | adapter fakes vs. real implementations (same suite), S3 contract, OpenAPI drift, module manifests | — | yes |
| End-to-end | Playwright + axe | user journeys per role (demo journey, cashier day, approval), phone viewport for field screens | the demo seed | yes on `main`; nightly full |
| Visual | Playwright screenshots of stories | am/en, light, comfortable | stories | yes for `packages/ui` |
| Load | k6 | inbox, query API, search, transitions at 1× and 3× regional load | generated 10⁶-scale data set | nightly; release gate |
| Upgrade | CI job | install previous release, seed, upgrade to the candidate, run smoke e2e | demo seed | release gate |
| Restore | scheduled job | restore the latest backup into a scratch stack; verify row counts, audit chain, file objects | real (on site) / demo (CI) | monthly; alerts |

## 2. Rules
* **Test the behaviour, not the mock.** Database-touching code is tested against real PostgreSQL. Mocks are allowed only at
  external boundaries (adapters use their fakes).
* **Every bug fix starts with a failing test.**
* **Money, numbering, RLS and audit** have property or concurrency tests, not just examples.
* **Test data is generated** by factories (`packages/testing`). It is never copied from real people, including the
  `Documents/` scans.
* **Ethiopic in tests:** every text-handling test includes Ethiopic, mixed-script and Wolaytta (apostrophe) samples.
* **Determinism:** time is injected (a fixed clock in Africa/Addis_Ababa), and random ids are seeded. Tests that depend on
  the current date are bugs.
* **Flaky tests** are quarantined within a day with an issue and an owner, and fixed or deleted within a week. Retries are
  never used to hide them.
* **Coverage** is reported, not targeted. Critical paths (money, RLS, audit, workflow) must have explicit test lists in
  their task's "Tests".

## 3. CI pipeline (per PR)
install (pnpm cache) → lint + typecheck + dependency-cruiser → unit + component → integration + isolation matrix
(Testcontainers) → migrations from zero → contract tests → build → e2e smoke → security scans (gitleaks, Trivy, Semgrep) →
i18n check → licence report (artefact). The full e2e, load and upgrade tests run nightly and on release candidates.
