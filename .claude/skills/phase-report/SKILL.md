---
name: phase-report
description: Produce an ITRMS progress report for the product owner or partner - every phase's completion, active and blocked tasks, gate status, risks and follow-ups - saved under docs/engineering/reports/ and pushed to the progress dashboard. Use for weekly updates, before meetings with bureaus, or when asked for a project overview.
argument-hint: "[optional: week | phase <n>]"
---

# Phase report

1. Run `node tools/progress/cli.mjs report` for the base tables.
2. Add the judgement the numbers don't show:
   - **Gate status:** for the current phase, what is still missing for its gate (from the phase file and
     `docs/go-to-market.md` §7). For example: "demo shown to 0 of 2 bureaus".
   - **Discovery:** answers received in `docs/discovery/` (questionnaire, blank forms) and what is still blocking tasks
     0.22 and 0.24.
   - **Risks:** the top 3 at the moment (schedule, business answers, national systems, scope), each with a mitigation.
   - **Next 2 weeks:** the tasks expected to reach review.
3. Save the report as `docs/engineering/reports/<YYYY-MM-DD>.md` (English). Write a short Amharic summary paragraph at the
   top if the report is meant for the partner or a bureau.
4. Refresh the dashboard (see `docs/engineering/dashboard.md`).
5. Show the report in the conversation and offer to commit it.

Facts only: every completion claim must match `progress.json`, and every number must come from a command run in this
session.
