# Data viewer

Shows the submitted data of **any** form, with no per-form code. Mounted by `submitted-forms/template/[templateId]`:

```tsx
import { DataViewer } from '@platform/form-engine';
<DataViewer templateId={id} onOpen={(row) => router.push(...)} rowActions={(row) => <IconButton label="Edit" ...><Pencil /></IconButton>} toolbarExtra={<NewRequestButton />} />
```

## How it stays dynamic
1. **The server describes the form's data** (`GET /form/submissions/query/schema`): every queryable field with its kind (text, choice, multi, number, date, boolean, files, rows, person),
   the operators it supports, whether it sorts/groups/aggregates, its options, and **roles** (`title`, `subtitle`, `stage`, `date`, `dateEnd`, `measures`, `people`, `files`, `rows`).
   Roles are inferred from the template (`Backend/app/services/FormSubmission/submission_fields.py`). Built-in fields: `status`, `created_at`, `updated_at`, `submitted_by`.
2. **One query contract** (`POST /form/submissions/query`): filter tree, search, sort, page, aggregates, group by (+ a second dimension), facets. Fields are allow-listed from the template, values are bound parameters, sizes are bounded.
3. **View modes** (`registerViewMode`) are offered when the form has what they need: Table, Cards, Board (columns = the `stage` field, falls back to `status`; drag to change it), Calendar (needs a date),
   Pivot (rows x columns x count/sum/avg/min/max, click a cell to drill down), Dashboard (tiles + charts, click a bar to drill down). Each mode runs its own queries.
4. **The view lives in the URL** (`?view=&q=&f=&sort=&page=&cols=&o=&v=`): back/forward work and every link is a shareable view. `?v=<id>` opens a **saved view** (`ViewsMenu`: private, or shared / default for form editors).

## Add a view mode
```tsx
registerViewMode({ id: 'map', label: 'Map', icon: MapIcon /* lucide */, order: 70, available: (schema) => schema.fields.some((f) => f.key === 'location'), component: MapView });
// component: ({ templateId, schema, state, patch, labeler, onOpen, rowActions }) => ...  (use useSubmissionData for data)
```
Other screens: the record page (`submitted-forms/template/[templateId]/[submissionId]`) shows a request with the form version it was filled in on, a "form changed" notice and its history.

## Rules
* Show people and options with `labeler.text(...)` (names, labels), never stored ids. Numbers/dates come formatted from `@platform/lib/format`.
* Drill-down is a filter patch (`andFilter`, `groupCondition` in `drill.ts`): modes never filter in the browser.
* Charts follow the dataviz rules (validated series colour `--chart-1`, thin marks, text in text tokens, a table view) and use the
  shadcn `ChartContainer` (Recharts) from `@platform/ui`.
* Built only from `@platform/ui` (ESLint error zone): pickers are `Combobox`/`DatePicker`/`TagsInput`, paging is `Pager`, statuses
  are `StatusBadge`, icon buttons are `IconButton`.
