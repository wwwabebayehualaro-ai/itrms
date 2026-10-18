# ADR 0009: Vitest, Playwright and GitHub Actions

* Status: accepted (2026-10-17, fixed)

## Context
The copied project has Vitest and Playwright suites but **no CI**. ITRMS handles money, identity and tenant isolation, so
regressions must be caught before a merge.

## Decision
* **Vitest** for unit and integration tests in every package and app. API integration tests run against a real PostgreSQL 16
  (Testcontainers or a CI service container), never SQLite. The RLS and isolation tests are mandatory in CI.
* **Playwright** for end-to-end journeys against the Compose stack, with axe accessibility checks.
* **GitHub Actions**:
  * On every PR: install (with the pnpm cache), lint, typecheck, unit tests, integration tests (Postgres, Valkey and S3
    services), migrations from zero, the i18n key check, security scans (gitleaks, Trivy, Semgrep), the licence report (not a gate, ADR-0025) and the build.
  * On main: e2e tests and image builds.
  * Branch protection requires these jobs to pass.

## Consequences
* The definition of done in CLAUDE.md refers to these jobs.
* A flaky test is quarantined with an issue, never silently retried.

## Licences
Vitest: MIT. Playwright: Apache-2.0. Testcontainers: MIT. GitHub Actions is a hosted service, and minutes for private repos
are billed.
