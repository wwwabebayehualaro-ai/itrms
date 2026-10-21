# Template runtime

Declarative data layer for the builder and renderer. Persisted in `form_config.runtime`
next to `form_config.fields`; templates without it behave exactly as before.

```jsonc
"runtime": {
  "dataSources": [{
    "id": "branches",
    "request": { "method": "GET", "url": "/branches" },
    "responseMapping": { "path": "data", "options": { "labelPath": "name", "valuePath": "id" } }
  }, {
    "id": "customers",
    "request": { "method": "GET", "url": "/customers", "query": { "branchId": "{{form.branchId}}" } },
    "cache": { "staleTimeMs": 30000 }
  }],
  "variables": [{ "name": "me", "value": "{{user.id}}" }],
  "submit": { "dataSourceId": "createCustomer", "refetch": ["customers"] }
}
```

A field opts in with `data.optionsBinding: { dataSourceId, mapping?, clearOnInvalid?, emptyMessage? }`,
`behavior.enabledConditions`, `behavior.visibilityConditions` (dotted refs allowed) and `data.computed`.

## Binding scope
`{{form.*}}`, `{{data.<dataSourceId>}}`, `{{status.<dataSourceId>}}` (`{ state: idle|loading|success|error, error }`),
`{{user.*}}`, `{{route.*}}` (route params + query), `{{variables.*}}`; in the submit message also `{{response.*}}` (what the save
returned).
A string that is exactly one binding keeps its type; `| default:"x"` supplies a fallback. There is no code evaluation.
Bindings resolve in a single pass, so text a user types is never re-evaluated.

## Requests
* Executed only through the host's client (`FormsHost.client`: the app's client, which owns authentication); templates never
  carry credentials.
  `auth: "none"` sets `skipAuth` on the request config for interceptors to honour.
* URLs must be relative; `Authorization`/`Cookie`-style headers are dropped.
* A GET source waits until every referenced value is non-empty (cascading selects) and is cached/deduplicated by React Query,
  keyed by the fully resolved request. Only GETs are retried.
* Mutations run from `submit.dataSourceId` or `apiCall` actions (`target` = data source id).

## Lookups that validate a field (e.g. an account number)
* The field: `behavior.validation.remote: { dataSourceId, message? }`. It is valid only once that lookup succeeded: "Checking…"
  while it runs, "Verified" after, the source's error (its `errorMapping`, e.g. 404 → "Account not found") on the field, and
  the form cannot be submitted meanwhile. Builder: Rules → "Checked by a data source".
* The lookup: a GET source reading the field (`/core-banking/accounts/{acct}`, `pathParams.acct = {{form.accountNumber}}`)
  with `enabledWhen` (e.g. a regex for a complete number) so it does not run on every keystroke.
* The details: computed read-only fields (`data.computed = { expression: "{{data.accountLookup.holder_name | default:\"\"}}",
  readOnly: true }`; the default clears them after a failed lookup). Other fields can be enabled on the result
  (`enabledConditions: [{ field: "data.accountLookup.status", operator: "eq", value: "ACTIVE" }]`).
* On submit the server decides: `submit.serverAction` runs coded work with the request (see `features/README.md`), and a
  422 `errors[{field, message}]` is shown on those fields. Reference: `src/renderer/remoteCheck.spec.tsx`.

## Formulas and multi-record forms
* `{{= expr }}` is a safe formula (own parser, no `eval`): arithmetic, comparison, `&&`/`||`, and
  `sum avg count min max round floor ceil abs if coalesce concat upper lower isEmpty`. Errors yield `undefined`.
  Extra roots: `row` (current record inside a FormArray) and `root` (whole form), e.g.
  `{{= round(row.amount * (1 + row.taxRate / 100), 2) }}`, `{{= round(sum(root.lines, 'lineTotal'), 2) }}`.
* A **FormArray** field holds an array of records; its child fields are the row template (ids are row-relative).
  Props: `minItems` (rows shown initially), `maxItems`, `itemLabel`, `addButtonLabel`, `removeButtonLabel`, `emptyMessage`.
  Validation, visibility/enable conditions and computed values are evaluated per row; hidden fields are pruned per row.
* Field ids are editable *keys* (`^[a-zA-Z_][\w]*$`) in the builder; renaming updates children, conditions and computed refs.
* A field is required only when `required` is set explicitly (validation rule toggles no longer imply it).
