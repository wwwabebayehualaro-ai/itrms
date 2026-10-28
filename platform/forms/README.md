# @itrms/forms

Form definitions, versions, submissions, query compiler and saved views

Task 0.16a: definitions (`forms.form_definitions`, a working copy owned by a unit), immutable content-hashed versions
(`forms.form_versions`), maker-checker publications (`forms.form_publications`, SEC-AC-6), and submissions
(`forms.submissions`, pinned to the version they were filled on). A submission is checked on the server with
`@itrms/form-engine/core`, the engine the browser runs: unknown keys and hidden fields' values are dropped, then the rules run
(422 `validation_failed`, `errors[{ path, code, message }]` with row paths such as `items[2].qty`). The browser and the server
share one case file, `packages/form-engine/test/cases.json`. Task 0.17b: every value field's basic type is checked by
its kit type, read-only computed fields are recomputed (as a fixpoint, so totals over row totals are right) before the
rules run, `requiredWhen`/`validWhen` rules are enforced, and a section takes at most 1,000 rows; an Ethiopian date
(`EthDate`) exports as two columns, the E.C. date and the stored G.C. day. Queries, saved views and exports come in 0.16b.

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
| `GET/POST /api/v1/form-drafts`, `GET/PATCH/DELETE /api/v1/form-drafts/{id}` | `submission:create` (the creator alone) |

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

Task 0.20c: drafts (`drafts.service.ts`, `forms.submission_drafts`): a person's request in the making, on the published
version they started; theirs alone (the service reads and writes by `created_by`, RLS keeps it to the unit), never
validated, holding only the form's own fields they may see; saved again on a newer published version, it goes on with
that one; filing the request with its `draftId` removes it in the filing's transaction. Each field of a form carries a
data class (`classification`, SEC-DC-1; unset counts as personal elsewhere, a publish-check warning): the browser keeps
a draft in IndexedDB (apps/web `lib/drafts`, Dexie), sealed with the person's non-extractable key and with only the
answers of classified, non-Sensitive fields (SEC-WB-3), so it survives a dropped network; an explicit sign-out deletes
the key and the drafts in every tab. Lists and saves answer without the answers (`DraftSummary`); `GET …/{id}` has them.
A resumed draft takes this browser's unsaved change only when it was made on the server's current version.

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry                          | Holds                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `./manifest`                   | the module manifest (`module.ts`)                                             |
| `./contracts`                  | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api`                        | the NestJS module (server only)                                               |
| `./web/server`, `./web/client` | screens and route map; embeddable client components                           |
| `./messages/*`                 | `am`, `en`, `wal-Latn` catalogues, keys `forms.<area>.<key>`                  |
| `./seed`                       | service definitions, unit-type defaults, demo generators                      |
