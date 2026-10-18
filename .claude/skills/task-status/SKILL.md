---
name: task-status
description: Show where the ITRMS project stands - the current phase progress, the focus task and its "Done when" checklist, tasks waiting for approval, blockers, follow-ups and the git state. Use when the product owner asks about status, progress or what is next.
---

# Project and task status

1. Run `node tools/progress/cli.mjs summary`.
2. For the **focus task** (in progress, else in review):
   - read its "Done when" items in `docs/phases/phase-<n>.md`;
   - mark each as shown, not yet shown, or unclear, from the task's evidence in `progress.json` and the branch's commits
     (`git log --oneline main..<branch>`).
3. Show `git status --short` and the current branch. Flag uncommitted work, or a branch that doesn't match the focus task.
4. List open follow-ups and any blockers.
5. End with **one line: the next action** (e.g. "0.1 awaits your approval", "continue 0.9: isolation matrix for class P").

Keep it short: a summary table plus the next action. Do not change anything.
