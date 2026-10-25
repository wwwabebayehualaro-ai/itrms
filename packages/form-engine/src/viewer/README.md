# Data viewer

Shows the submitted data of **any** form, with no per-form code. Mounted by `submitted-forms/template/[templateId]`:

```tsx
import { DataViewer } from '@itrms/form-engine/viewer';
<DataViewer templateId={id} onOpen={(row) => router.push(...)} rowActions={(row) => <IconButton label="Edit" ...><Pencil /></IconButton>} toolbarExtra={<NewRequestButton />} />
```

## How it stays dynamic
The viewer talks to the forms API (`@itrms/forms`, through the app's `/api/` BFF). `../api/wire.ts` is the one place that
knows the wire: it maps the API's DTOs and keys (`createdAt`, `submittedBy`, `handlingUnit`, `pageSize`, `groupBy`) to the
screens' (`created_at`, `submitted_by`, `handling_unit`, `page_size`, `group_by`) and back.
1. **The server describes the form's data** (`GET /v1/forms/{id}/view`): every queryable field of the published version
   the caller may see, with its kind (text, choice, multi, number, date, datetime, boolean, files, rows, person, unit),
   the operators it supports, whether it sorts/groups/aggregates, whether its filters are indexed (ADR-0035), its
   options, and **roles** (`title`, `subtitle`, `stage`, `date`, `dateEnd`, `measures`, `people`, `files`, `rows`).
   Built-in fields: `created_at`, `submitted_by` and `handling_unit` (the office; a choice whose options are the offices
   in the caller's data, as the submitter's are the people in it).
2. **One query contract** (`POST /v1/submissions/query`): filter tree, search, sort, page, aggregates, group by (+ a
   second dimension), facets. Fields are allow-listed from the published version, values are bound parameters, sizes
   are bounded, and the rows are the caller's subtree (RLS).
3. **View modes** (`registerViewMode`) are offered when the form has what they need: Table, Cards, Board (columns = the
   `stage` field, the office by default; moving a card waits for the workflow, task 0.19), Calendar (needs a date),
   Pivot (rows x columns x count/sum/avg/min/max, click a cell to drill down), Dashboard (tiles + charts, click a bar to
   drill down). Each mode runs its own queries.
4. **The view lives in the URL** (`?view=&q=&f=&sort=&page=&cols=&o=&v=`): back/forward work and every link is a
   shareable view. `?v=<id>` opens a **saved view** (`ViewsMenu`: private, or the office's / its default with
   `submission-view:share`).
5. **Export** (`POST /v1/submissions/export`): up to 5,000 rows at once; more are made in the background
   (`/v1/submission-exports`) and downloaded from a short-lived link when ready.

## Add a view mode
```tsx
registerViewMode({ id: 'map', label: 'Map', icon: MapIcon /* lucide */, order: 70, available: (schema) => schema.fields.some((f) => f.key === 'location'), component: MapView });
// component: ({ templateId, schema, state, patch, labeler, onOpen, rowActions }) => ...  (use useSubmissionData for data)
```
Other screens: the record page (`submitted-forms/template/[templateId]/[submissionId]`) shows a request with the form version it was filled in on, a "form changed" notice and its history (who changed which fields, never the values).

## Rules
* Show people and options with `labeler.text(...)` (names, labels), never stored ids. Numbers/dates come formatted from `host/format.ts`.
* Drill-down is a filter patch (`andFilter`, `groupCondition` in `drill.ts`): modes never filter in the browser.
* Charts follow the dataviz rules (validated series colour `--chart-1`, thin marks, text in text tokens, a table view) and use the
  shadcn `ChartContainer` (Recharts) from `@platform/ui`.
* Built only from `@platform/ui` (ESLint error zone): pickers are `Combobox`/`DatePicker`/`TagsInput`, paging is `Pager`, statuses
  are `StatusBadge`, icon buttons are `IconButton`.
