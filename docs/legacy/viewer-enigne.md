Table-only is the weakest option, so I'd make the viewer a set of view modes that all read one query API. Nothing is built yet.

## The idea
The enterprise-grade pattern is the one used by Airtable, Notion databases, Salesforce list views and ServiceNow. A form's data is a dataset, and each view mode is a lens on it. Every mode is derived from the template, with no per-form code. The pieces are:
1. one **query API** that handles filter, sort, group and aggregate, validated against the template;
2. a **semantic layer** that works out what each field means;
3. a **registry of view modes**, like the field-renderer registry we already have;
4. **saved views** that store the choices.

## 1. Semantic layer: the template decides which views make sense
The engine reads each form and assigns roles to fields. A template can override them with an optional `viewer` block in `form_config`.

| Role | Inferred from | Unlocks |
|---|---|---|
| Title / subtitle | the first required text field, or `employee` / `title` | cards, list, calendar labels |
| Status / stage | Dropdown or Radio with few options, plus the built-in `status` | kanban, group-by, funnel |
| Date / date range | Calendar fields | calendar, timeline, Gantt, trends |
| Measure | number or currency fields | totals, charts, pivot, KPI tiles |
| Person | fields bound to the directory, plus `submitted_by` | "my requests", workload view |
| Attachments | FileUpload | gallery |
| Line items | FormArray | expandable rows, line-item sub-table, per-row totals |

A view mode is offered only when its roles exist. For example, kanban needs a status role, and the calendar needs a date.

## 2. View modes
| Mode | Best for | Notes |
|---|---|---|
| **Table** | scanning and bulk work | Server-driven. Column chooser, pin, resize, group rows, and inline row expansion for line items. |
| **Cards / gallery** | people-centred or file-centred data | Title, subtitle, status chip and a few key fields. Attachment thumbnails. |
| **Board (kanban)** | workflow | Columns come from the status field. Drag to change status, with permission and audit. |
| **Calendar / timeline** | leave, bookings, deadlines | Month, week and agenda. A date range becomes a bar. |
| **Pivot and charts** | analysis | Group by any choice, date or person field, and aggregate (count, sum, avg, min, max). Charts via the `dataviz` skill. |
| **Dashboard** | managers | KPI tiles (total spend, pending count, average approval time) plus charts, saved per form. |
| **Record page** | one request in depth | A configurable layout with tabs: Overview (the form, read-only), Line items, Files (preview), History (audit timeline), Comments. The page has a deep link, a print view and a PDF. |
| **Master–detail split** | review queues | List on the left and record on the right, with keyboard next/previous. This is the fastest way to work through approvals. |
| **Activity feed** | "what changed" | Built from the audit log. |

## 3. Query API (platform, backend)
One endpoint, `POST /form/submissions/query`, takes a view-neutral request:
- **filter:** a nested and/or tree of `field`, `op`, `value`, with operators typed by field kind (text contains, number and date ranges, choice in, boolean, "is empty").
- **sort, search, cursor and offset pagination.**
- **group by plus aggregates, and facet counts** for the filter sidebar.
- **Security:**
  - Field keys are allowlisted from the template, with no raw paths.
  - Tenant isolation and RLS stay as they are.
  - Hidden or sensitive fields are masked per role (field-level security), including in export.
  - Reads of sensitive records are audited.
- **Performance:**
  - PostgreSQL JSONB with a GIN index.
  - Hot fields can be promoted to generated indexed columns, chosen per template.
  - Counts are estimated on very large sets.
  - The query layer sits behind one interface, so OpenSearch or ClickHouse can replace it later without UI changes.
- **SQLite fallback** keeps the test suite running.

## 4. Saved views
A `saved_views` table (tenant-scoped, audited, with optimistic locking) stores:
- the mode;
- filters, sort, grouping and columns;
- the field-to-role mapping;
- visibility (private, shared with roles, or default for the form).

Views have a URL, so a filtered board can be shared by link. Users also get a "My requests" shortcut and "needs my approval" views.

## 5. Platform pieces
- **View registry** in the form engine: `registerViewMode({ id, requires: ['status'], component })`. Feature teams can add a mode without touching the viewer.
- **Realtime:** server-sent events invalidate the TanStack Query cache, so boards and tables update live.
- **Scale:** virtualized rows and cards, a keyboard-first interface, and accessible drag-and-drop with keyboard alternatives.
- **Reports:** scheduled exports and email digests of a saved view, and CSV, Excel and PDF from the server, honouring masking and written to the audit log.
- **Operations:** metrics for query latency and slow-query logging.
- **Versions:** each record keeps a snapshot of the form it was filled in on, so old data always renders correctly and removed fields show as "legacy".

## 6. Order of work (each step passes checks, then commit and push)
1. **Semantic layer and query API.** Filter, sort, group, aggregate and facets, with backend tests on SQLite and PostgreSQL.
2. **View-mode registry plus a server-driven table** that replaces the 100-row client table.
3. **Record page** with line items, files, history and the version snapshot.
4. **Saved views, filters and share links.**
5. **Cards, then board, then calendar, then pivot and dashboard.**
6. **Server exports, realtime and field-level security.**

Each mode is verified with real data, using the Expense Report, the Leave Request form and the demo data seeder, in the same way as the multi-record form.

## What I'd start with
Steps 1 and 2, then the record page. That gives a working, scalable, secure foundation, and every later mode is mostly UI on top of it.

Three decisions would change what I build:
1. **Modes in the first release:** table, cards, board and calendar, with pivot and dashboard second. Or do you want analytics earlier?
2. **Board drag changes status:** is that allowed directly, or should it go through an approval action with a comment?
3. **Field-level security:** should I include per-role masking of fields in the first release, or after the views work?

If you don't have a preference, I'll go with the order above (table, cards, board, calendar first), allow status changes only through the existing `submission:update` permission, and do masking in step 6.