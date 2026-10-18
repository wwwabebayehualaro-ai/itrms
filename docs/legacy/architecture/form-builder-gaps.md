# Form builder: gaps to enterprise grade

What the form builder (builder, renderer, data viewer and the request backend) still lacks before it can be called
enterprise grade. Written on 2026-10-17 from an audit of the code. Every gap says what is wrong, why it matters, what exists
today (with file references), the proposed solution and its size.

**How this list is used.** Gaps are closed one at a time, in the order below, and only when asked. When a gap is done its
status becomes ✅ with the commit. Its solution may be refined when the work starts.

Sizes: **S** = a day or less, **M** = a few days, **L** = a week or more. Status: ⏳ open, 🔨 in progress, ✅ done.

## Summary

| # | Gap | Today | Size | Status |
|---|---|---|---|---|
| 1 | [Server-side validation of requests](#1-server-side-validation-of-requests) | Rules run only in the browser | L | ⏳ |
| 2 | [Request status controlled by the server](#2-request-status-controlled-by-the-server) | A submitter can set any status | M | ⏳ |
| 3 | [Per-form access](#3-per-form-access) | Anyone who may submit can fill any form and see every request | M | ⏳ |
| 4 | [Drafts in the UI](#4-drafts-in-the-ui) | Backend only | M | ⏳ |
| 5 | [Conditional required and cross-field rules](#5-conditional-required-and-cross-field-rules) | Static rules only | M | ⏳ |
| 6 | [Multi-step (wizard) forms](#6-multi-step-wizard-forms) | Missing | M | ⏳ |
| 7 | [Request workflow per form](#7-request-workflow-per-form) | Approvals exist only in code | L | ⏳ |
| 8 | [Notifications](#8-notifications) | None | L | ⏳ |
| 9 | [Template lifecycle](#9-template-lifecycle) | Versions stored, not shown; no duplicate or import | M | ⏳ |
| 10 | [Print, PDF and Excel](#10-print-pdf-and-excel) | CSV only | M | ⏳ |
| 11 | [Multi-language forms](#11-multi-language-forms) | English only | M | ⏳ |
| 12 | [Field types](#12-field-types) | No signature, rich text, address, record lookup, matrix | M | ⏳ |
| 13 | [Files: storage and scanning](#13-files-storage-and-scanning) | Local disk, no virus scan | M | ⏳ |
| 14 | [Data protection](#14-data-protection) | No encryption, PII flags or retention | L | ⏳ |
| 15 | [Public forms and prefill](#15-public-forms-and-prefill) | Sign-in always required | M | ⏳ |
| 16 | [Quality and builder UX](#16-quality-and-builder-ux) | No accessibility tests, single selection, no starter forms | M | ⏳ |
| 17 | [Cross-form reports](#17-cross-form-reports) | Reports cover one form | L | ⏳ |

The order follows risk:
- Gaps 1–4 are about trust and correctness: today a request can be wrong or reach the wrong people, so they come before any
  production use.
- Gaps 5–8 add workflow and communication.
- Gaps 9–17 add breadth.

## Already enterprise grade

These are in place, so the gaps above are in proportion:
- **Builder:** undo/redo, keyboard shortcuts, duplicate field, live preview on the real renderer, an inspector generated
  from each field type's settings.
- **Engine:** one field kit for builder and renderer; 25 field types incl. repeating rows (FormArray) with per-row rules and
  formulas; safe formulas (no `eval`); data sources with bindings; lookups that validate a field
  (`behavior.validation.remote`); computed fields; visibility and enablement conditions.
- **Publishing:** the backend checks every saved form against the contract (`contracts/form-config.schema.json`); versions
  are immutable; publish approval (maker-checker, flag `forms.require_approval`); requests are recorded on the version they
  were filled in.
- **Data viewer:** table, cards, board, calendar, pivot and dashboard modes; server-side filters, search and grouping; saved
  views; audited CSV export.
- **Requests:** field-level visibility by role (`visibleToRoles`, enforced on the server, in exports and in history); audit
  history per request; optimistic locking; idempotent submits.
- **Coded work behind a form:** server actions run in the request's transaction and lock it (the cash deposit/withdrawal
  reference).
- **Platform:** multi-tenancy with PostgreSQL RLS, default-deny authorization, problem+json errors, observability.

---

## 1. Server-side validation of requests
- **Problem:** the server stores whatever a request contains. Required fields, patterns, ranges, option lists and hidden
  fields are enforced only by the browser. Anyone calling the API directly (or a modified browser) can store a request that
  breaks the form's rules.
- **Why it matters:** data quality and auditability. Reports, exports and later processing trust that a request obeys its
  form, and a control that exists only in the browser is not a control.
- **Today:**
  - `FormSubmissionService.create_submission` / `update_submission`
    (`Backend/app/modules/form_submission/services/form_submission_service.py`) strip role-hidden fields, set the version
    and the submitter, and run a server action. Nothing else is checked.
  - Hidden-field pruning happens only in the browser (`Frontend/platform/form-engine/renderer/EngineForm.tsx`, `pruneHidden`).
  - Only the template config is checked with `jsonschema` (`form_builder/services/form_config.py`).
  - A server action validates only its own fields (`server_actions.py`, `input_model`).
- **Solution:**
  - Port the engine's rules (`core/validate.ts`) and conditions (`core/conditions.ts`) to Python
    (`form_submission/services/submission_rules.py`). It covers: required, type, email, lengths, pattern, number ranges,
    dates, files, lists, booleans, static option membership, repeating rows and their counts.
  - Prune the values of hidden fields on the server. A condition that needs browser-only state (`data.*`, `status.*`) leaves
    its field unchecked instead of refusing it wrongly.
  - Answer 422 `invalid_submission` with `errors[{field, message}]` (row paths such as `lines[2].qty`); the renderer already
    shows these on the fields.
  - Validate on submit, on edit and on draft → submitted; drafts are stored as they are.
  - Parity: one shared case file (`contracts/form-validation.cases.json`) runs in Vitest against `validateForm` and in pytest
    against the port, so a rule changed on one side only fails a test.
- **Size:** L. **Depends on:** nothing. **Status:** ⏳

## 2. Request status controlled by the server
- **Problem:** a person who submitted a request can mark it "completed" or "failed" themselves.
- **Why it matters:** a status is a decision. If anyone may set it, it means nothing to auditors or to the people relying on
  it.
- **Today:**
  - `PATCH /form/submissions/{id}/status` (`form_submission_router.py`) needs only `submission:update`, which the
    `submitter` role has. Any of draft / submitted / processing / completed / failed is accepted, also on create.
  - The UI offers it as the status select on the record page (`submitted-forms/template/[templateId]/RecordScreen.tsx`) and
    as drag-and-drop between board columns (`viewer/modes/BoardView.tsx`).
  - Only requests locked by a server action are protected.
- **Solution:**
  - A transitions table: submitters create `draft` / `submitted` and may withdraw their own.
  - `processing` / `completed` / `failed` need a new permission `submission:review` (editors, admins) or come from a
    workflow (gap 7) or a server action.
  - Every change is checked against the table (409 `invalid_transition`).
  - The board and the status select appear only for reviewers.
- **Size:** M. **Depends on:** nothing (gap 7 builds on it). **Status:** ⏳

## 3. Per-form access
- **Problem:** everyone with the submitter role can fill in every form and read every request of every form, including other
  people's.
- **Why it matters:** an HR form, a finance form and a teller form have different audiences, so need-to-know has to apply
  per form.
- **Today:**
  - `FormTemplate` has no access settings.
  - `submission:create` allows any form; `submission:read` lists everything (the "mine" filter is optional, and nothing
    scopes rows by `submitted_by`).
  - Only field-level `visibleToRoles` exists (`form_submission/services/submission_fields.py`).
- **Solution:**
  - Access settings on the template:
    - **Who may fill it in:** roles; default everyone with `submission:create`.
    - **Who sees all of its requests:** roles; default editors and admins.
    - Everyone else sees only their own requests.
  - Enforced in list, query, export, record page, history and the menu.
  - Set in the template settings; migration with defaults that keep today's behaviour for existing forms.
- **Size:** M. **Depends on:** nothing. **Status:** ⏳

## 4. Drafts in the UI
- **Problem:** a long form must be finished in one sitting: closing the tab loses the work, and nothing can be saved for
  later.
- **Why it matters:** long or multi-person forms (expense reports, onboarding) are routinely started and finished later.
- **Today:** the backend supports drafts (`POST /form/submissions/drafts`, status `draft`, and a server action runs when a
  draft is submitted). The fill screen (`maker/form-intiator/page.tsx`) always submits.
- **Solution:**
  - A "Save draft" button.
  - Autosave every few seconds while the form is dirty (debounced, idempotent).
  - "My drafts" (on the dashboard and in the requests menu) to resume or delete.
  - A draft opens on the version it was started on, or is moved to the published one with a notice.
- **Size:** M. **Depends on:** 1 (submitting a draft is validated). **Status:** ⏳

## 5. Conditional required and cross-field rules
- **Problem:** rules cannot depend on other answers. Examples: "required when the type is Other"; "end date after the start
  date"; "amount at most the available balance" (today done indirectly with a computed field and a static minimum).
- **Why it matters:** real forms are full of such rules. Without them, authors fall back to code or accept bad data.
- **Today:**
  - Field rules are static (`core/model.ts`, `FieldRules`).
  - Hidden or disabled fields are skipped (`core/validate.ts`).
  - Remote checks exist (`behavior.validation.remote`).
- **Solution:**
  - `requiredWhen`: conditions, using the existing condition editor.
  - `validWhen`: a formula plus a message, e.g. `{{= form.endDate >= form.startDate }}`.
  - min / max / minDate / maxDate may be bindings (`{{data.account.available_balance}}`).
  - In the engine and in the server port of gap 1; this needs a Python port of the formula evaluator (the same grammar, no
    `eval`).
  - Builder: a Rules-tab editor.
- **Size:** M. **Depends on:** 1. **Status:** ⏳

## 6. Multi-step (wizard) forms
- **Problem:** long forms are one long page; there are no steps, progress or "next / back".
- **Why it matters:** completion rates and usability on long forms, onboarding and applications.
- **Today:** only containers (Panel, Fieldset, Card, FormSection) in `renderer/fields/containers.tsx`; no step concept.
- **Solution:**
  - A `FormStep` container: top-level steps, a step bar, Next validates the current step only, Back keeps values, and a
    review step before Submit.
  - Steps can be shown or hidden by conditions.
  - Builder: steps as tabs on the canvas.
  - Works with drafts (gap 4: resume at the step).
- **Size:** M. **Depends on:** nothing (better with 4). **Status:** ⏳

## 7. Request workflow per form
- **Problem:** a request cannot be routed for approval, e.g. "manager approves, then finance". Approvals exist only for
  publishing a form and for coded features.
- **Why it matters:** most enterprise forms are requests that need one or more decisions, with accountability and deadlines.
- **Today:** the foundation approval engine (`Backend/app/foundation/approval/`) is single-step and registered in code. Two
  policies exist: `template.publish` and `bank_txn.post`.
- **Solution:**
  - A workflow configured in the builder (stored with the form version): ordered steps.
  - Each step names its approver: a role, or a person chosen in the form (`{{form.manager}}`). It may have a due time and
    a condition (e.g. only above an amount).
  - Steps run on the foundation approval engine through one generic policy. Decisions move the request status (gap 2) and
    can trigger a server action at the end.
  - The approvals inbox and the request page show the trail.
- **Size:** L. **Depends on:** 2; 8 for the "you have something to approve" messages. **Status:** ⏳

## 8. Notifications
- **Problem:** nobody is told anything: not the approver that a request waits, nor the submitter that it was decided. No
  other system can subscribe to events either.
- **Why it matters:** without notifications, workflows stall, and integrations have to poll.
- **Today:** no email, in-app notifications, webhooks or job queue. "Notifications" in the catalog means screen toasts; the
  catalog lists "background jobs / transactional outbox" as ⏳.
- **Solution:**
  - **Foundation:** a transactional outbox (events written in the same transaction as the change) plus a worker.
  - **Channels:** email (SMTP, templates per event), an in-app bell with unread count, signed webhooks per tenant.
  - **Events:** request submitted, waiting for your decision, decided, status changed, comment added.
  - **Per-user preferences.**
- **Size:** L. **Depends on:** nothing (used by 7). **Status:** ⏳

## 9. Template lifecycle
- **Problem:** versions are stored but cannot be seen, compared or restored. A form cannot be duplicated, exported or
  imported from the UI. Deactivating a form does not stop new requests.
- **Why it matters:** change control. Auditors ask what changed and when, and teams reuse forms across units and
  environments.
- **Today:**
  - Immutable versions (`form_builder/services/versions.py`); the record page warns when the form changed after the request
    was filled in.
  - The builder shows the form as JSON (copy only).
  - `is_active` exists but is not enforced on submit.
- **Solution:**
  - A version history (who, when, publish approval) with a field-level diff and "restore as new draft".
  - Duplicate; export and import a form as a JSON file (checked against the contract).
  - Inactive forms refuse new requests (409) and leave the Templates Pool.
- **Size:** M. **Depends on:** nothing. **Status:** ⏳

## 10. Print, PDF and Excel
- **Problem:** a request cannot be printed cleanly or saved as PDF; lists export only as CSV.
- **Why it matters:** signed paper copies, attachments to emails and archives are still required in many processes; Excel is
  what business users open.
- **Today:**
  - Audited CSV export (`POST /form/submissions/export`).
  - A PDF viewer exists for uploaded files only (`platform/ui/files/PdfViewer.tsx`).
- **Solution:**
  - A print layout of the record page (the form as filled in, header with form, reference, dates and status, approval
    trail).
  - A server-rendered PDF download, audited like exports.
  - An Excel export next to CSV (same fields, typed cells).
- **Size:** M. **Depends on:** nothing. **Status:** ⏳

## 11. Multi-language forms
- **Problem:** a form has one language; dates and numbers are always formatted for `en-US`.
- **Why it matters:** multilingual workforces and customers; for example Amharic and English, and right-to-left languages
  for some regions.
- **Today:** labels are single strings; the locale is fixed in `Frontend/platform/lib/format.ts`. The old unused
  translation context was removed in the legacy clean-up.
- **Solution:**
  - Translations per form: label, help, placeholder, options and messages per language, with the default language as
    fallback.
  - A language picker on the fill screen.
  - Locale-aware number and date formatting; RTL layout.
  - Builder: a translation table per form with missing-translation hints.
  - The app's own texts get a message catalog at the same time.
- **Size:** M. **Depends on:** nothing. **Status:** ⏳

## 12. Field types
- **Problem:** common business inputs are missing: signature, rich text, address, a lookup to records of another form
  (e.g. pick an existing customer request), and a matrix / Likert grid. Money has one fixed currency per field.
- **Why it matters:** without these, authors work around them with free text, which defeats validation and reporting.
- **Today:** 25 types (`renderer/fields/*.tsx`: inputs, choices, dates, numbers, files, containers, repeating rows, data
  table). API-bound options can call GET endpoints.
- **Solution:**
  - Each type is one kit definition (`defineFieldType` + `describeFieldType`), then `npm run form:schema`; server rules for
    each (gap 1).
  - **Signature:** drawn, stored as a file.
  - **Rich text:** sanitized HTML.
  - **Address:** structured value.
  - **Record lookup:** a searchable picker over another form's requests through the query API, respecting gap 3.
  - **Matrix:** rows × columns.
  - **Money with its currency** as part of the value.
- **Size:** M. **Depends on:** 1 (server rules), 3 (for record lookup). **Status:** ⏳

## 13. Files: storage and scanning
- **Problem:** uploads live on the application server's disk and are never scanned.
- **Why it matters:** malware arriving through a form reaches whoever opens the file. Local disk does not scale, is not
  replicated, and breaks with more than one backend instance.
- **Today:**
  - Size and type limits are enforced on the server (`foundation/config.py`, `modules/files/services/file_service.py`, which
    also checks the content against the declared type).
  - Only `LocalStorage` exists (`Backend/app/foundation/storage.py`; S3/Azure are mentioned in comments only).
- **Solution:**
  - An S3-compatible storage implementation behind `Storage` (MinIO / S3 / Azure through its S3 API), with presigned
    downloads.
  - A virus-scan hook (ClamAV): files are quarantined until clean, and infected files are refused and audited.
  - Per-form limits on top of the system limits.
- **Size:** M. **Depends on:** nothing. **Status:** ⏳

## 14. Data protection
- **Problem:** personal or sensitive values (ID numbers, salaries, health data) are stored and exported like any other
  value; requests are never deleted.
- **Why it matters:** privacy law and bank / regulator rules require minimisation, protection at rest, masking, and
  retention limits.
- **Today:**
  - Field visibility by role (`visibleToRoles`) and full audit history exist.
  - Values are masked only in logs.
  - Deletion is soft only; there is no retention policy.
- **Solution:**
  - **A "sensitive" flag per field:** masked in lists, exports and history for roles without a reveal permission; revealing
    is audited.
  - **Encryption at rest** of flagged values (key per tenant, outside the database).
  - **A retention policy per form:** e.g. purge or anonymise N months after completion, by a scheduled job, with an audit
    record.
  - **Subject access / erasure** helpers.
- **Size:** L. **Depends on:** 8 (jobs). **Status:** ⏳

## 15. Public forms and prefill
- **Problem:** every form needs a signed-in user, so customers, suppliers or applicants cannot fill one in. Fields cannot be
  prefilled from a link.
- **Why it matters:** external intake (complaints, applications, registrations) is a core form use case, and prefilled links
  (from an email or another system) save errors.
- **Today:**
  - The only public routes are sign-in.
  - Query parameters can be read in bindings (`{{route.*}}`), but there is no prefill setting.
- **Solution:**
  - A share link per form: no sign-in, revocable, optional expiry, rate limits and a captcha.
  - Public requests are owned by a system actor and are validated on the server (gap 1).
  - Embedding by iframe with allowed origins.
  - "Prefill from link" per field (`?field=value`, only for fields marked prefillable).
- **Size:** M. **Depends on:** 1, 3. **Status:** ⏳

## 16. Quality and builder UX
- **Problem:**
  - No automated accessibility checks.
  - The builder edits one field at a time, cannot copy fields between forms, has no device preview and no starter forms.
- **Why it matters:** accessibility is a legal requirement in many places, and builder speed decides whether business teams
  actually use the builder.
- **Today:**
  - Undo/redo, shortcuts (Ctrl+Z/Y/S/D, Delete, Alt+Arrows), duplicate and live preview exist (`designer/FormDesigner.tsx`,
    `designer/store.ts`).
  - No axe tests in `Frontend/tests`.
  - No virtualization for very large forms (data viewer pages are bounded).
- **Solution:**
  - axe checks in the Playwright specs (fill screen, builder, viewer).
  - Multi-select with copy / paste (also between forms).
  - Phone / tablet preview.
  - A starter library (blank, request with approval, survey, the reference forms).
  - Field search in the outline.
  - Render-performance budget tests for forms with 500+ fields.
- **Size:** M. **Depends on:** nothing. **Status:** ⏳

## 17. Cross-form reports
- **Problem:** reports and dashboards cover one form at a time; there is no "all requests by department this month" across
  forms.
- **Why it matters:** managers need the whole picture, not one form at a time.
- **Today:**
  - Per-form dashboard and pivot modes in the data viewer (`viewer/modes/DashboardView.tsx`) on
    `POST /form/submissions/query`, which takes exactly one `template_id`.
  - The home dashboard (`app/(main)/DashboardScreen.tsx`) shows counts, not analytics.
- **Solution:**
  - Reports over several forms through shared field keys (declared mappings: "department" in form A = "dept" in form B).
  - Widgets (count, sum, trend, by status) on the home dashboard and on report pages.
  - Same server-side query engine, with per-form access (gap 3) applied to every form included.
- **Size:** L. **Depends on:** 3. **Status:** ⏳
