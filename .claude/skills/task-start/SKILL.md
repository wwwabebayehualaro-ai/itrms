---
name: task-start
description: Start an ITRMS phase task (e.g. /task-start 0.2) - checks the definition of ready, creates the task branch, marks the task "in progress" in progress.json, and lays out the plan from the phase file. Use whenever the product owner asks to begin or continue a numbered task.
argument-hint: "[task id, e.g. 0.2; default: the next ready task]"
---

# Start a task

Follow `docs/engineering/workflow.md`. One task at a time; never start without the product owner asking.

1. **Pick the task.** Use the argument, or the next `ready` task from `node tools/progress/cli.mjs summary`.
   Show it with `node tools/progress/cli.mjs show <id>`.
2. **Read its entry** in `docs/phases/phase-<n>.md`: the "Do", "Done when" and "Tests" items. Read the ADRs and docs it
   links.
3. **Check the definition of ready** (workflow.md §2):
   - no open question changes the design (business data may be a marked placeholder);
   - the tasks it depends on are `done`;
   - the decisions it relies on are accepted ADRs;
   - it fits one session (otherwise propose a split into `<id>a`/`<id>b` and stop).

   If anything fails, report it, and if the product owner agrees, record it with
   `node tools/progress/cli.mjs set <id> blocked --blocker "<reason>"`. Then stop.
4. **Check the workspace:**
   - `git status` must be clean;
   - no other task may be `in progress` (the CLI refuses it anyway);
   - the previous task should be merged into `main`. If it is approved but not merged, say so and ask whether to branch
     from it instead.
5. **Branch:** `git checkout -b task/<id>-<short-slug>` from `main` (or the agreed base).
6. **Mark it:**
   - if it is still `planned`, run `node tools/progress/cli.mjs set <id> ready` first (only after step 3 passed);
   - then run `node tools/progress/cli.mjs set <id> "in progress" --branch task/<id>-<short-slug>`.
7. **Present the plan:**
   - the "Done when" items as a checklist, with how each will be shown;
   - the tests to write;
   - which subagents you will use (per the user's global rules).

   Then begin the work.

During the task, record notable decisions with `node tools/progress/cli.mjs note <id> "..."`. Record work found that
belongs elsewhere with `node tools/progress/cli.mjs followup <id> "<item>" "<moved to>"`.
