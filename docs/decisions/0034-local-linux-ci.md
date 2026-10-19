# ADR 0034: Local Linux CI while GitHub-hosted runners are unavailable

* Status: accepted (2026-10-19). It **amends ADR-0009** (testing and CI): the CI record can come from a local Linux run.

## Context
* GitHub Actions jobs don't start: the account's billing blocks them (follow-up 11), and the company can't pay for it now.
* The definition of done requires tests "locally and on CI". The point of the CI half is a clean, reproducible run on
  Linux, independent of the developer's working tree. Tasks 0.2–0.4 have local Windows evidence only.
* The options:
  * a **self-hosted GitHub runner**: still depends on the GitHub account's Actions being enabled, and runs workflow code
    on the developer's machine;
  * **another hosted CI** (GitLab, Codeberg/Woodpecker): an account, a mirror and a second pipeline definition to keep in
    step, and free tiers need a card or have small minute quotas;
  * a **public repository** (free minutes): not possible; ITRMS is proprietary;
  * **the same jobs in Linux containers on the development machine**, from a clean copy of the commit, with a written
    record.

## Decision
* `pnpm ci:local` (`tools/ci-local.mjs`) runs the jobs of `.github/workflows/ci.yml` in Docker's Linux engine:
  * **checks:** clones the commit inside `node:<.nvmrc>-bookworm` and runs exactly the `run:` commands of the `checks` job
    (a test fails if they differ), then the licence report;
  * **infra:** the dev stack (Linux containers) and the S3 contract suite, when the commit is the clean HEAD;
  * **gitleaks, Trivy, Semgrep:** the same pinned images and options as `ci.yml`. Trivy, which runs through an action in
    `ci.yml`, is pinned by digest in the tool to a release after the March 2026 compromise.
* What decides how a commit is tested (`.nvmrc`, `packageManager`, `ci.yml`, the Trivy summary script) is read from
  that commit, not from the working tree. The report names the tool's own commit and says if the working tree was dirty.
* Only a run of every job, none skipped, is a **complete record**: `.ci-local/<sha>/report.md` and `report.json` (the
  commit, the engine, the image digests, every step's exit code and duration). Any other run writes `report-partial.*`,
  says PARTIAL in its evidence line, and never replaces the record. The one-line evidence of a complete record goes into
  `progress.json` with the task's other evidence.
* gitleaks fails a run that scanned no commits or reported git errors. It scans the commits not yet on `origin/main`,
  or the whole history up to the commit when it is already there, with merge commits' changes.
* **"On CI"** in the definition of done means: GitHub Actions for the commit, **or** a complete, passing local Linux CI
  record for the commit that is merged.
* `ci.yml` stays as it is. When GitHub-hosted runners are available again, they become the record again, without other
  changes.

## Consequences
* Evidence for the done tasks 0.2–0.4 is completed with a local Linux run of `main`.
* A local record is weaker than a hosted one: the same person controls the machine and the result. The report includes
  digests and exit codes so a reviewer can rerun it, and the INSA pack says which kind of record each release has.
* Renovate updates the Trivy image pin in `tools/ci-local.mjs` (custom manager).
* **Exception to SEC-DV-3** (branch protection with required checks), as the security standard requires one:
  * risk: without Actions, GitHub can't block a merge that has no passing record;
  * compensating control: a complete local record for every merged commit, checked by `/task-review` and the task
    verifier before the merge;
  * owner: the product owner;
  * expiry: when hosted CI is available again, reviewed on 2027-06-30 at the latest.
* The infra job uses the developer's dev stack, so it runs from the main checkout (with its `infra/compose/.env`), not
  from a second worktree.
