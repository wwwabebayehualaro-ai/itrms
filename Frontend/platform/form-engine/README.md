# @platform/form-engine

Builds, stores and runs dynamic forms. A form is JSON in `form_config`: `{ schemaVersion?: 2, fields: FormField[], runtime?: TemplateRuntimeConfig }`
— a flat list of fields linked by `parentId`. That shape is a contract: the backend reads it (`submission_fields.py`) and checks
every saved form against `contracts/form-config.schema.json` (generated from `core/contract.ts`, `npm run form:schema`).

## Use it (feature teams)

```tsx
import { FormRenderer, PublishedFormRenderer, DataViewer } from '@platform/form-engine';

<PublishedFormRenderer template={template} onFormSubmit={save} />          // fill in the published version
<FormRenderer fields={fields} template={template} readOnly initialValues={v} /> // show a saved request
```
The builder: `import { TemplateBuilder } from '@platform/form-engine/builder'` (routed at `/dynamic-template/builder`; kept separate
so runtime pages do not ship it). The gallery opens a form in it through the builder store (`useBuilderActions`).

## Extend it

```tsx
import { defineFieldType, describeFieldType, registerAction } from '@platform/form-engine';
import { z } from 'zod';

// a field type: how it renders (on @platform/ui; the renderer owns label, help, errors, visibility and width)...
defineFieldType({ kind: 'value', type: 'Iban', Render: ({ id, value, onChange, onBlur, disabled, invalid }) => <Input id={id} … /> });
// ...and how the builder offers it: palette entry, starting settings, and the Settings tab, generated from a Zod schema
describeFieldType('Iban', {
    label: 'IBAN', icon: Landmark, group: 'Text & numbers', rules: ['pattern'], defaults: { country: 'DE' },
    settings: z.object({ country: z.enum(['DE', 'FR']).optional().meta({ title: 'Country', labels: { DE: 'Germany', FR: 'France' } }) })
});

// templates call it by name: { "type": "custom", "target": "exportPdf", "payload": { ... } } (a template never carries code)
registerAction('exportPdf', async ({ payload, formValues, context, setFieldValue, runApi, refetch }) => { ... });
```
Register once at app start (module scope of a client component or provider). A new type also needs `npm run form:schema` (the
backend accepts only types the contract lists). `npm run check:engine` exercises all three.

## How it is built
* `core/` — UI-free. `readDocument` reads every stored version into resolved fields (`props` over the older palette's
  `defaultProps`); conditions (`and`/`or`/`xor`/`not`; a hidden container hides its children); initial values; pruning of hidden
  values; validation compiled to Zod (`validateForm` → `{ 'items[2].qty': 'message' }`); the stored types (`storedTypes.ts`) and
  the contract (`contract.ts`).
* `renderer/` — `EngineForm` on TanStack Form (each field subscribes to what it reads) and the field kit (`kit.ts`: one
  definition per stored type name; built-ins in `fields/`, their builder descriptions in `fields/design.ts`); field actions
  (`actions.ts`). `FormRenderer` is the public wrapper: a field whose type the kit does not have is left out and named.
* `designer/` — the builder. `document.ts` (UI-free): fields by id + ordered children per container; `fromStored` / `toStored`
  keep the stored contract and add `schemaVersion: 2`; edits are immer recipes (insert, move — never into itself —, remove with
  the inside, duplicate with new keys, rename a key everywhere). `store.ts`: one Zustand store per builder with 100-step
  undo/redo (a run of edits with the same key < 1.5 s is one step, e.g. typing a label); unsaved = `doc !== saved`.
  `Canvas.tsx` draws the field kit itself in design mode (controls `inert`), dnd-kit drops into the innermost container under the
  pointer; `Palette.tsx`; `Inspector.tsx` (Field, Settings, Options/Rows, Rules, Logic, JSON); `SettingsForm.tsx` (the Settings tab
  from the type's Zod schema); `DataSources.tsx` (the runtime block). New fields get a key from their label that follows it until
  the form is saved. Keyboard: Ctrl+Z / Ctrl+Shift+Z, Del, Ctrl+D, Alt+↑/↓, Esc, Ctrl+S.
* `viewer/` — the data viewer for the submitted data of any form (see `viewer/README.md`).
* `Runtime/` — the data layer: data sources, `{{...}}` bindings, formulas, mapping (see `Runtime/README.md`).
* `api/` — TanStack Query hooks for templates, submissions, attachment previews. `store/formStore.ts` — the form handed to the builder.

## Regression checks
* `npm run check:engine` — extension points (a custom type end to end, every built-in type creates a valid, drawable field, actions).
* `npm run check:runtime` — bindings, mapping, requests, formulas.
* `npm run form:schema -- --check` — the backend contract is up to date with the kit.
* `npx tsx scripts/checkDesignerRoundTrip.mts <fixtures.json>` — the builder opens and saves real forms unchanged
  (fixtures: `{ versions: [{ id, name, form_config }] }`, e.g. exported from a database).
* Unit: `tests/unit/formEngineCore.test.ts`, `engineForm.test.tsx`, `designerStore.test.ts`, `formDesigner.test.tsx`,
  `dataViewer.test.tsx`; e2e: `tests/e2e/fill-form.spec.ts`, `builder.spec.ts`; data viewer scripts in `scripts/e2e/data-viewer`.
