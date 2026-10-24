# @itrms/forms

Form definitions, versions, submissions, query compiler and saved views

Task 0.16a: definitions (`forms.form_definitions`, a working copy owned by a unit), immutable content-hashed versions
(`forms.form_versions`), maker-checker publications (`forms.form_publications`, SEC-AC-6), and submissions
(`forms.submissions`, pinned to the version they were filled on). A submission is checked on the server with
`@itrms/form-engine/core`, the engine the browser runs: unknown keys and hidden fields' values are dropped, then the rules run
(422 `validation_failed`, `errors[{ path, code, message }]` with row paths such as `items[2].qty`). The browser and the server
share one case file, `packages/form-engine/test/cases.json`. Queries, saved views and exports come in 0.16b.

| Route | Permission |
|---|---|
| `GET/POST /api/v1/forms`, `GET/PATCH /api/v1/forms/{id}` | `form:read`, `form:create`, `form:update` |
| `GET /api/v1/forms/{id}/versions[/{versionId}\|/published]` | `form:read` |
| `POST /api/v1/forms/{id}/publications` | `form:publish` |
| `GET /api/v1/form-publications`, `POST …/{id}/approval\|rejection` | `form:read`, `form:approve` (not the requester) |
| `GET/POST /api/v1/submissions`, `GET /api/v1/submissions/{id}` | `submission:read`, `submission:create` |

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module (server only) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `forms.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
