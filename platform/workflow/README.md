# @itrms/workflow

Workflow definitions, cases, transitions, tasks, SLA, inbox and the case page

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module (server only) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `workflow.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |

## Definitions (task 0.19a)

- The definition's schema is `workflowDefinitionSchema` in `@itrms/schemas` (states `start`, `task`, `wait`, `end`;
  transitions by action, event or timeout; guards, effects, step forms, separation of duties, `rejectRoles`).
- `api/engine/check.ts`: the checks a definition passes before a version is stored (structure, then the roles of the
  installed manifests, the effects of the kernel's registry and the step forms that exist). Codes are
  `workflow.check.<code>` in `messages/`.
- `api/engine/rules.ts`: the engine's rules as pure functions (who may take a transition, separation of duties, guards,
  the assignee unit and the parent routing of a one-person office). The transition runner (0.19b) uses them.
- `workflow_definitions` and `workflow_definition_versions` (class C, beside forms): versions are immutable and
  content-hashed; the same content names the same version.

| Route | Permission |
|---|---|
| `GET /api/v1/workflow-definitions`, `GET …/{id}`, `GET …/{id}/versions`, `GET …/{id}/versions/{versionId}` | `workflow-definition:read` |
| `POST /api/v1/workflow-definitions/check` (dry run), `POST /api/v1/workflow-definitions` | `workflow-definition:create` |
| `POST /api/v1/workflow-definitions/{id}/versions` | `workflow-definition:update` (a unit's own workflows) |

## Cases and transitions (task 0.19b)

- `cases` (class T at the handling unit), `case_tasks` (class T at the **assignee** unit: only that unit and the offices
  above it see a step), `case_events` (the append-only timeline). `submissions.case_id` now points at `cases`.
- `CasesService.start` starts a case on a stored workflow version with the configuration a service froze for it
  (`approval_unit` …); `services` calls it from 0.21. `transition` is a person's action; `deliver` an event or the timeout
  taken by a system actor (`system:<adapter>`, `system:timer`) in the worker's system context (0.20 wires the timers).
- A transition runs in one transaction: the engine's decision, the step form's answers (filed as a submission of the
  version the step names), the effects (a failing one undoes everything), the task closed and the next one opened, the
  timeline, the audit rows and `case.transitioned.v1` in the outbox.
- A step in a unit above the actor's scope ("the zone approves for a town") is opened through the reviewed
  `workflow.open_task`; separation of duties finds who else may act through `workflow.role_holders`, and routes a
  one-person office's step up the tree (recorded as a `routed` event), or refuses it when nobody anywhere may take it.

| Route | Permission |
|---|---|
| `GET /api/v1/cases/{id}` (the case, its visible steps, its timeline, the caller's actions) | `case:read` |
| `POST /api/v1/cases/{id}/transitions` (If-Match: the case's version) | `case:act`, then the step's role in its unit |

## SLA timers (task 0.20a)

- A step's or a wait's due time is its state's SLA on the working calendar of its unit (`api/sla.ts`: the nearest
  `working_calendars` row up the tree, else the civil service's week; the national holidays plus the units' `holidays`
  rows), computed by `businessDeadline` (`@itrms/ethiopian-calendar`).
- The timer is an outbox event available at the due time (`case-task.due.v1`, `case.wait-due.v1`); `api/jobs/sla.ts`
  handles it in the worker: an overdue step is marked and its office's heads told (`workflow.notify.overdue`), the office
  above too (`workflow.notify.escalated`), by in-app notification and the fake SMS gateway; a wait leaves by its timeout.
  A 15-minute sweep (`slaSweep`) catches lost timers. Each runs once whatever the order.

## Inbox, case page and comments (task 0.20b)

- Intake starts a case on a workflow's newest version (`POST /api/v1/cases`, `case:create`, the records officer); a
  service request (0.21) starts one with the configuration it resolved.
- The inbox (`GET /api/v1/me/tasks`) lists the open steps of the caller's active unit for the roles they hold there, by
  due time (overdue first, no SLA last), then the oldest; filters `claim` (all, mine, unclaimed), `sla` (overdue,
  due-soon: within `DUE_SOON_HOURS`), `state`, `number`; a cursor (`after`: the last task of the page before). A step
  separation of duties keeps the caller off is listed with `mayAct: false`.
- A step is taken on (`…/tasks/{taskId}/claim`) by one of the role's holders in its unit; the others see whose it is,
  may not act on it, and it is given back (`…/release`) by its holder or a head of the office (`unit_head`).
- The case page (`GET /api/v1/cases/{id}`) carries names, the states' labels, the actions with their labels and whether
  they need a comment or the step's form, the open step's SLA and claim, and each step form's answers (`steps`: the
  version's document and the answers the caller may see; the transition that filed them names the submission).
- A comment (`POST /api/v1/cases/{id}/comments`, `case:comment`) is a `comment` event on the timeline, internal. The
  people it mentions must work on the case: an active role in its handling office or one above it, found through the
  reviewed `workflow.case_people` (`GET …/people?q=` for the picker). The worker tells them (`case.commented.v1`,
  `api/jobs/comments.ts`: `workflow.notify.mentioned`, in the application only, once each).

| Route | Permission |
|---|---|
| `POST /api/v1/cases` (a workflow's newest version, the caller's unit) | `case:create` |
| `GET /api/v1/me/tasks` | `case:act` |
| `POST /api/v1/cases/{id}/tasks/{taskId}/claim`, `…/release` | `case:act`, then the step's role in its unit |
| `POST /api/v1/cases/{id}/comments`, `GET /api/v1/cases/{id}/people` | `case:comment` |
