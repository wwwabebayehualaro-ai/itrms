---
name: task-review
description: Finish an ITRMS task and put it up for the product owner's review - verifies every "Done when" item and the definition of done with evidence, runs the task-verifier agent (and the reviewer agent for sensitive changes), commits, moves the task to "in review", and refreshes the progress dashboard. Also handles the product owner's approval (moving to done and merging). Use when a task's work is complete or the owner approves a task.
argument-hint: "[task id; default: the task in progress] | approve <id>"
---

# Review a task (and approve it)

Rules: `docs/engineering/workflow.md` §3–§5. **Never move a task to `done` without the product owner's explicit approval.**

## A. Put the task up for review
1. Identify the task: the argument, or the one `in progress`.
2. **Run the checks** that exist at this stage of the project:
   - lint, typecheck, unit, integration and e2e tests;
   - security scans and the i18n check.

   Delegate the runs to the `test-runner` agent and record the **actual counts**. Never write "should pass".
3. **Walk the "Done when" items** of the task (phase file) and the 12 points of the definition of done. Write one evidence
   line for each item: a command and its result, a test name, or a file path.
4. **Run the `task-verifier` agent** with the task id and branch. Fix whatever it reports as missing, or record it
   honestly as not done.
5. **Sensitive changes:** for security, money, tenancy or multi-module changes, also run the `reviewer` agent on the diff
   (`main...HEAD`). Fix its high findings, or record them for the product owner's decision.
6. **Commit** with a conventional message that names the task, plus the attribution trailer required by the session.
7. **Record the evidence:**

   ```
   node tools/progress/cli.mjs set <id> "in review" --commit <sha> --evidence "<command → result>" --evidence "..."
   ```

   Commit the regenerated `docs/engineering/progress.*` too.
8. **Refresh the dashboard:** publish the current progress (see `docs/engineering/dashboard.md`).
9. **Stop and present the review:**
   - the "Done when" checklist with its evidence;
   - what was deferred (follow-ups);
   - the verifier and reviewer verdicts;
   - the exact question: "Approve task <id>?"

## B. When the product owner approves (`/task-review approve <id>`)
Only after an explicit approval in the conversation:
1. Squash-merge the branch into `main` (workflow.md §5: linear history), with a conventional message naming the task:
   `git checkout main && git merge --squash task/<…> && git commit`. Branch commit SHAs recorded earlier become
   unreachable after the squash; the squash commit is the one that counts.
2. Record it: `node tools/progress/cli.mjs set <id> done --approved --commit <squash-sha>`. Mark the next task `ready`
   if its definition of ready holds.
3. Commit the progress files on `main` as a separate commit, `docs(progress): task <id> done`. Don't amend the squash
   commit: amending changes its SHA, and the recorded SHA would point at a commit that no longer exists.
4. Refresh the dashboard.
5. **Do not push**: pushing needs its own approval, and the guard hook asks for it.
