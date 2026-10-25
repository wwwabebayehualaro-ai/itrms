# @itrms/forms

Form definitions, versions, submissions, query compiler and saved views

Task 0.16a: definitions (`forms.form_definitions`, a working copy owned by a unit), immutable content-hashed versions
(`forms.form_versions`), maker-checker publications (`forms.form_publications`, SEC-AC-6), and submissions
(`forms.submissions`, pinned to the version they were filled on). A submission is checked on the server with
`@itrms/form-engine/core`, the engine the browser runs: unknown keys and hidden fields' values are dropped, then the rules run
(422 `validation_failed`, `errors[{ path, code, message }]` with row paths such as `items[2].qty`). The browser and the server
share one case file, `packages/form-engine/test/cases.json`. Queries, saved views and exports come in 0.16b.

| Route                                                              | Permission                                      |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| `GET/POST /api/v1/forms`, `GET/PATCH /api/v1/forms/{id}`           | `form:read`, `form:create`, `form:update`       |
| `GET /api/v1/forms/{id}/versions[/{versionId}\|/published]`        | `form:read`                                     |
| `POST /api/v1/forms/{id}/publications`                             | `form:publish`                                  |
| `GET /api/v1/form-publications`, `POST …/{id}/approval\|rejection` | `form:read`, `form:approve` (not the requester) |
| `GET/POST /api/v1/submissions`, `GET /api/v1/submissions/{id}`     | `submission:read`, `submission:create`          |
| `GET /api/v1/forms/{id}/view`, `POST /api/v1/submissions/query` | `submission:read` |
| `GET/POST /api/v1/forms/{id}/views`, `PATCH/DELETE /api/v1/saved-views/{id}`, `GET /api/v1/submissions/{id}/history` | `submission:read` (sharing a view: `submission-view:share`) |
| `POST /api/v1/submissions/export` | `submission:export` |
| `POST /api/v1/submission-exports`, `GET …/{id}`, `POST …/{id}/download` | `submission:export` (the requester alone) |

Task 0.16b: the data viewer's queries. `view-fields.ts` is the allow-list (the published version's top-level value fields
the caller may see, and the built-ins `createdAt`, `submittedBy`, `handlingUnit`); `query-compiler.ts` turns a data-only
query into SQL with every key and value bound. Fields the author marks `filterable` are indexed in
`forms.submission_values` (ADR-0035): written with each submission, filled by the worker (`jobs/fill-values.ts`) when a
version marks a field, and used once the form lists the key in `indexed_keys`. Other fields are compared on the answers.
Every query runs under a 10 s `statement_timeout`. The 10⁶ timing is `apps/api/test/perf/submissions-query.perf.spec.ts`.

Task 0.16d: saved views (`views.service.ts`: private to their owner, or shared with the office by someone with
`submission-view:share`; one default per form and office), a submission's history from the audit log (never the
answers' values: the log holds them masked), and direct CSV and Excel exports (`export.ts`): the viewer's rows as people
read them, every cell neutralised (SEC-IN-8), at most 5000 rows, each export an audited event with its size. Exports
over the limit run in the worker from 0.16e.

Task 0.16e: background exports.

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry                          | Holds                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `./manifest`                   | the module manifest (`module.ts`)                                             |
| `./contracts`                  | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api`                        | the NestJS module (server only)                                               |
| `./web/server`, `./web/client` | screens and route map; embeddable client components                           |
| `./messages/*`                 | `am`, `en`, `wal-Latn` catalogues, keys `forms.<area>.<key>`                  |
| `./seed`                       | service definitions, unit-type defaults, demo generators                      |
