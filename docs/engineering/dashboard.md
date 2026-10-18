# Progress tooling and dashboard

Task status lives in one file, [`progress.json`](progress.json). Everything else is generated from it: the Markdown log
[`progress.md`](progress.md), the session summary, the status line and the online dashboard. Never edit `progress.md` by
hand.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Progress CLI | `tools/progress/cli.mjs` | Reads and changes `progress.json` and regenerates `progress.md`. It enforces the workflow: allowed status moves only, one task in progress, and `done` only with `--approved`. |
| Skills | `.claude/skills/` | `/task-start <id>`, `/task-status`, `/task-review [<id> \| approve <id>]`, `/phase-report` |
| Verifier agent | `.claude/agents/task-verifier.md` | Read-only check of a task's "Done when" items and the definition of done before review |
| SessionStart hook | `.claude/settings.json` | Prints the CLI `summary` into each new session |
| Git guard hook | `tools/hooks/guard-git.mjs` | Asks before every `git push`. Denies `--no-verify`, force pushes, `reset --hard`, `clean -f`, `filter-repo` and `filter-branch`. |
| Stop hook | `tools/hooks/progress-reminder.mjs` | When a task is in progress and files changed but the progress files did not, asks the session to record progress before it stops |
| Status line | `tools/progress/statusline.mjs` | `ITRMS · P0 0/28 ▱▱▱▱▱▱▱▱ · 0.1 in review · ⎇ <branch>` |
| Dashboard | <https://claude.ai/artifact/F2Rdg8HRdsrsDwP88gpH8h> | Phase cards, tasks that need attention, all tasks (search and filters), follow-ups |

Review or turn off the hooks with `/hooks` in Claude Code. A change to `.claude/settings.json` applies from the next
session, or after `/hooks` is opened once.

## CLI

```
node tools/progress/cli.mjs summary | line | report
node tools/progress/cli.mjs show <id>
node tools/progress/cli.mjs set <id> "<status>" [--branch b] [--commit sha] [--evidence "cmd → result"] [--blocker "why"] [--clear-blockers] [--approved]
node tools/progress/cli.mjs note <id> "text"
node tools/progress/cli.mjs followup <id> "item" "moved to"
node tools/progress/cli.mjs export <dir>        # tasks.json, phases.json, followups.json for the dashboard
```

## The dashboard

The dashboard is a private claude.ai artifact owned by the product owner's account. Only people it is shared with
(Share menu on the page) can open it. Anyone who can open it can read its three data files, so it shows only task
titles, statuses, branches, commits, notes and follow-ups. It never shows personal data or anything from `Documents/`.

It reads three attached files, one per dataset (`tasks`, `phases`, `followups`), made by `cli.mjs export`. It does not
read the repository, so **a session refreshes it** whenever `/task-review` or `/phase-report` runs, or when asked:

1. `node tools/progress/cli.mjs export <scratchpad>/dash`.
2. Upload each file to the dashboard: Artifact tool, `url` = the dashboard, `asset: true`, `file_path` = the file. Use one
   call per file.
3. Update each dataset with ArtifactData `update` on `datasets/<id>` (pin `if_version` from a `get`): the new `url`,
   `name`, and `updated: {at, by}`.
4. After the new files are in use, delete the old assets (Artifact `delete` with the old asset id as `path`).

The page itself is the store document `files/index.html`. Change it only when the layout needs to change. Its source
is not kept in the repository.
