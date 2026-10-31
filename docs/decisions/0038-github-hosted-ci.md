# ADR 0038: GitHub-hosted CI is the CI record again

* Status: accepted (2026-10-31, task 0.21e). It **supersedes ADR-0034**.

## Context
* ADR-0034 made a local Linux run (`pnpm ci:local`) the CI record while GitHub-hosted runners were blocked by the
  account's billing.
* Since task 0.21c the jobs of `.github/workflows/ci.yml` run on GitHub-hosted runners for every pull request and every
  push to `main`. These jobs are checks, stories, the dev stack with the integration tests, the e2e journeys and
  performance.

## Decision
* The CI record of a task is the GitHub Actions run of its pull request (and of the merge on `main`). Its run id and URL
  go into the task's evidence in `progress.json`.
* `pnpm ci:local` stays as a tool for reproducing a CI failure on Linux, or as the record if hosted runners become
  unavailable again. A run of it is then a complete record under ADR-0034's rules.

## Consequences
* A task branch is pushed and its pull request opened before the task is declared done. A red run is fixed on the
  branch; no job is skipped.
