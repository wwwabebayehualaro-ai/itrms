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
