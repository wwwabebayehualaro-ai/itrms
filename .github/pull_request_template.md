<!-- Title: conventional commit naming the task, e.g. "feat(platform): RLS policies and isolation matrix (task 0.9)" -->

## Task
Phase task: `0.x` · [phase file](../docs/phases/) · progress: `node tools/progress/cli.mjs show 0.x`

## Done when
<!-- The task's "Done when" items as a checklist, each with its evidence (docs/engineering/workflow.md §4). -->
- [ ] …

## Evidence
<!-- Commands and their actual results (counts, not "pass"). -->
- `pnpm turbo run lint typecheck test build` →
- `pnpm boundaries` →
- `pnpm test:int` (when the database is touched) →

## Definition of done (workflow.md §3)
- [ ] Tests pass locally and on CI
- [ ] Tenant isolation: new tenant tables have RLS policies and are in the isolation matrix
- [ ] i18n keys in `am` and `en`; data names are `I18nText`
- [ ] Audit rows for every new write path (a test asserts it)
- [ ] Migrations generated, reviewed, applied from zero; OpenAPI regenerated if the API changed
- [ ] Money in santim, numbers from counters, Gregorian dates in storage
- [ ] Security scans clean; no secrets; new dependencies are in tech-stack.md
- [ ] Docs and progress updated
- [ ] Reviewer agent report attached for security, money or tenancy changes

## Deferred
<!-- Follow-ups recorded with `cli.mjs followup`, and where they went. -->
