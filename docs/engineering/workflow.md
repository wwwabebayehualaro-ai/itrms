# Engineering workflow: how a task is started, done and proven

Rules for every task in [`../phases/`](../phases/phase-0.md), whether it's done by a person or a Claude Code session.
**A task is complete only when the evidence below is recorded in [progress.md](progress.md).** "It works on my machine" and
"tests should pass" do not count.

## 1. Task lifecycle

```
planned → ready → in progress → in review → done
                         ↘ blocked (reason + what unblocks it)
```

| State | Meaning | Who moves it |
|---|---|---|
| planned | listed in a phase file | — |
| **ready** | meets the definition of ready (§2) | the product owner, or the session after checking §2 |
| in progress | one branch, one task | the implementer |
| in review | PR open, CI green, self-check done (§4) | the implementer |
| **done** | meets the definition of done (§3); evidence in progress.md; merged | after review (§5) |
| blocked | can't continue; the reason and the unblocker are written down | anyone |

**One task at a time, in order, and only when asked** (CLAUDE.md). A task never starts while the previous one is in
progress or in review, unless the product owner says otherwise.

## 2. Definition of ready
A task may start only when:
1. Its "Do", "Done when" and "Tests" in the phase file are clear, with no open question that changes the design. Business
   questions that only change data (fees, names) are not blocking; placeholders are used and marked.
2. The tasks it depends on are done.
3. The decisions it relies on are accepted ADRs. A new design question gets a short ADR first.
4. It fits one session. If not, it is split into 0.xa / 0.xb in the phase file first.

## 3. Definition of done (all must hold)
1. **Acceptance:** every "Done when" item of the task is demonstrated.
2. **Tests:** the task's listed tests exist and pass. Lint, typecheck, unit, integration (real PostgreSQL 16) and the
   affected e2e journeys are green locally and on CI. "On CI" is GitHub Actions for the commit, or a complete, passing local
   Linux CI record (`pnpm ci:local`, ADR-0034) for the commit that is merged. No test is skipped or deleted to get green.
3. **Isolation:** every new or changed tenant table has RLS policies of its class (`TO itrms_app`, null-safe), and the
   isolation matrix covers it, including the no-context case on a reused connection.
4. **Audit:** every new write path writes audit rows in the same transaction, with sensitive fields masked (test asserts
   it).
5. **i18n:** keys present in `am` and `en`; new data names are `I18nText`; no user-visible string outside catalogues.
6. **Data rules:** money in santim (`bigint`); document numbers from counters only where ITRMS issues the document; dates
   Gregorian in storage; no floats in money paths.
7. **Security:** default-deny (`@Require` on every route); inputs validated by Zod; no secrets in the diff; gitleaks,
   Trivy and Semgrep show no new high findings.
8. **Performance:** any query on a large table has EXPLAIN (under RLS) attached to the PR; the screen stays within its JS
   budget (≤ 250 KB compressed).
9. **Accessibility:** new screens pass axe in the e2e journey; keyboard path works.
10. **Contracts:** migrations generated, reviewed and applied from zero in CI; OpenAPI regenerated if the API changed;
    module manifest valid at startup.
11. **Docs:** the task's status and evidence in progress.md; ADRs, architecture or READMEs updated if the design changed;
    module README updated for new public APIs and events.
12. **Review:** for security-, money-, tenancy- or multi-module changes, the **reviewer agent** has reviewed the diff and
    its high findings are fixed (or recorded as accepted risk by the product owner).

## 4. Evidence (recorded in progress.md for every task)
* Commit/PR reference.
* Commands run and their results (counts, not just "pass"), e.g. `pnpm turbo run test → 412 passed`,
  `test:int → 87 passed`, isolation matrix size.
* How each "Done when" item was shown (a test name, a screenshot path, EXPLAIN output path).
* Reviewer verdict and what was fixed.
* Anything deferred, with where it was written down (a follow-up task or an issue). Nothing is silently dropped.

## 5. Branches, commits, reviews
* `main` is always releasable and protected (CI must pass, linear history).
* One branch per task: `task/0.9-rls-isolation`. Squash-merge with a conventional commit
  (`feat(platform): RLS policies and isolation matrix (task 0.9)`).
* PR description = the task's "Done when" as a checklist plus the evidence (§4). The template is
  `.github/pull_request_template.md` (created in task 0.2).
* Code review: the product owner (or a named reviewer) approves. For sensitive changes, the reviewer agent's report is
  attached.

## 6. Versions and releases
* **Semantic versioning** for the product (`1.4.2`). One release line for all customers; no per-customer branches.
* Every merge to `main` appends to `CHANGELOG.md` (generated from conventional commits, edited for readers), plus
  **release notes in Amharic and English** for "What's new" (enterprise-capabilities §8).
* A release is a signed bundle: images (cosign), migrations, the upgrade notes, the SBOM. It's tested by an upgrade from
  the previous release in CI.
* Database migrations are forward-only (expand/contract). A release never requires a downgrade.

## 7. Environments
| Environment | Purpose | Data |
|---|---|---|
| local | developer and Claude sessions (`pnpm dev:infra`) | generated seed |
| CI | every PR: tests, isolation, migrations from zero, upgrade from previous release | generated |
| demo | the Phase 0 demo server | generated demo data |
| training | per installation (separate Compose project) | generated, reset nightly |
| pilot / production | per region | real |

Real personal data never leaves production. Bug reproduction uses generated data or masked extracts approved by the bureau.

## 8. Rules for Claude Code sessions
* Read CLAUDE.md, this file and the task's phase entry first; check §2 before starting.
* Work only on the current task; don't refactor beyond it. Note other problems as follow-ups in progress.md.
* Delegate per the user's global rules (`scout`, `test-runner`, `implementer`, `translator`, `doc-writer`, `reviewer`), and
  check their results before relying on them.
* Report results faithfully: failing tests are reported with output; skipped steps are named.
* Stop at "in review" and present the evidence; the product owner moves the task to done.
* Change task status only through `node tools/progress/cli.mjs`. `progress.json` is the source of truth, and
  `progress.md` is generated from it. Use the skills `/task-start`, `/task-status`, `/task-review` and `/phase-report`.
  The hooks print the status at session start, guard destructive git commands, and remind the session to record progress.
  See [dashboard.md](dashboard.md).
