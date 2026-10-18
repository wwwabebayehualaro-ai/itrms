# Equipment Request — a rich reference form

A second reference form next to [`expense-report`](../expense-report/README.md): **many field kinds in one form**, plus a
hand-built report of its requests (`equipment-request-table`). Both are stored here as JSON (`*.template.json`) and seeded with
the demo data (`../demo/seed-demo.cjs`).

## What the form demonstrates
| Feature | Field(s) |
|---|---|
| Containers | `requester` (Panel), `details` (Fieldset) |
| Multi-record section | `items` = `FormArray` (min 1 / max 20, "Item 1", "Add item") with 6 row fields |
| Data fetched from the database | `manager` (Dropdown) and `approvers` (MultiSelect) are bound to the `directory` data source (`GET /auth/directory`) |
| Computed read-only from the user | `employee` = `{{user.name}}` |
| Per-row formula | `lineTotal` = `{{= round(row.qty * row.unitPrice, 2) }}` |
| Form-level formula over the rows | `grandTotal` = `{{= round(sum(root.items, 'lineTotal'), 2) }}` |
| Per-row conditional + required | `justification` shown (and required) only when `lineTotal > 500` |
| Form-level conditional + required | `urgentReason` when `priority = urgent`; `deliveryDate` when `needsDelivery` is on |
| Field kinds | InputText, InputMask, Calendar, Dropdown (static + API options), MultiSelect, RadioButton, InputSwitch, InputNumber, Slider, Rating, Chips, CheckboxGroup, InputTextarea, FileUpload, Checkbox |

## The report of its requests
`equipment-request-table` is a form with one **Table of data** field whose rows come from a data source (`GET /form/submissions`,
`template_id={{route.templateId}}`, payload path `items`) and whose columns are set in the builder (the field's *Rows* tab). The
requests page of a form shows a `<form slug>-table` template as its **Report** view; every form also gets the data viewer (table,
cards, board, calendar, pivot, dashboard) without building anything.
