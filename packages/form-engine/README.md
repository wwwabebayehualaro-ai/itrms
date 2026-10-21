# @itrms/form-engine

Builds, stores and runs dynamic forms. A form is JSON in `form_config`: `{ schemaVersion?: 2, fields: FormField[], runtime?: TemplateRuntimeConfig }`,
a flat list of fields linked by `parentId`. That shape is a contract: its types, Zod schemas and the backend contract live in
`@itrms/schemas` (`forms/`), and the backend checks every saved form against `contracts/form-config.schema.json` (generated
from them and the field kit: `pnpm --filter @itrms/form-engine form:schema`).

Rules: [code-structure.md](../../docs/platform/code-structure.md) §3 and §7.

## Entry points

| Entry | What | Runs in |
|---|---|---|
| `@itrms/form-engine/core` | document model, conditions, values, validation, bindings and formulas | browser **and** API (no React, no DOM) |
| `@itrms/form-engine/renderer` | `FormsHostProvider`, `FormRenderer`, `PublishedFormRenderer`, API hooks, extension points | browser |
| `@itrms/form-engine/designer` | the form builder (`TemplateBuilder`) and its store | browser |
| `@itrms/form-engine/viewer` | the data viewer of submitted data (see `src/viewer/README.md`) | browser |

`core` stays UI-free: dependency-cruiser (`form-engine-core-is-ui-free`) and the shared ESLint config (no DOM globals, no
JSX, no React/Next.js/design-system imports in `src/core`) enforce it, and `src/core/node.spec.ts` runs it in plain Node.

## The host: what the app provides

The engine imports nothing of an app. The app wraps its screens once in a `FormsHostProvider` with a `FormsHost`:

```tsx
import { FormsHostProvider, type FormsHost } from '@itrms/form-engine/renderer';

const host: FormsHost = {
    client,                          // a FormsClient: the app's HTTP client (token, refresh, Idempotency-Key, sign-in)
    useUser: useAuthUser,            // hook: the signed-in person ({{user.*}}, permission hints)
    useLocation,                     // hook: pathname, search, params, push, replace (Next.js in the web app)
    templatesHref: '/dynamic-template/saved-templates',
    isReported,                      // optional: errors the app has already shown
    logError: (message, error) => logger.error({ err: error }, message)
};
<FormsHostProvider host={host}>{children}</FormsHostProvider>
```

The web app's host is `apps/web/src/providers/forms/FormsHost.tsx`. Tests use `src/test-utils.tsx` (`hostRenderer`, a fake
client per test).

## Use it

```tsx
import { FormRenderer, PublishedFormRenderer } from '@itrms/form-engine/renderer';
import { DataViewer } from '@itrms/form-engine/viewer';

<PublishedFormRenderer template={template} onFormSubmit={save} />          // fill in the published version
<FormRenderer fields={fields} template={template} readOnly initialValues={v} /> // show a saved request
```
The builder: `import { TemplateBuilder } from '@itrms/form-engine/designer'` (routed at `/dynamic-template/builder`; a separate
entry so runtime pages do not ship it). The gallery opens a form in it through the builder store (`useBuilderActions`).

## Extend it

```tsx
import { defineFieldType, describeFieldType, registerAction } from '@itrms/form-engine/renderer';
import { z } from 'zod';

// a field type: how it renders (on @itrms/ui; the renderer owns label, help, errors, visibility and width)...
defineFieldType({ kind: 'value', type: 'Iban', Render: ({ id, value, onChange, onBlur, disabled, invalid }) => <Input id={id} … /> });
// ...and how the builder offers it: palette entry, starting settings, and the Settings tab, generated from a Zod schema
describeFieldType('Iban', {
    label: 'IBAN', icon: Landmark, group: 'Text & numbers', rules: ['pattern'], defaults: { country: 'DE' },
    settings: z.object({ country: z.enum(['DE', 'FR']).optional().meta({ title: 'Country', labels: { DE: 'Germany', FR: 'France' } }) })
});

// templates call it by name: { "type": "custom", "target": "exportPdf", "payload": { ... } } (a template never carries code)
registerAction('exportPdf', async ({ payload, formValues, context, setFieldValue, runApi, refetch }) => { ... });
```
Register once at app start (module scope of a client component or provider). A new type also needs `form:schema` (the backend
accepts only types the contract lists). `check:engine` exercises all three.

## How it is built
* `src/core/` — UI-free. `readDocument` reads every stored version into resolved fields (`props` over the older palette's
  `defaultProps`); conditions (`and`/`or`/`xor`/`not`; a hidden container hides its children); initial values; pruning of
  hidden values; validation compiled to Zod (`validateForm` → `{ 'items[2].qty': 'message' }`). `core/runtime/`: `{{...}}`
  bindings, formulas, response mapping (no code evaluation).
* `src/renderer/` — `EngineForm` on TanStack Form (each field subscribes to what it reads) and the field kit (`kit.ts`: one
  definition per stored type name; built-ins in `fields/`, their builder descriptions in `fields/design.ts`); field actions
  (`actions.ts`); `runtime/` (data sources through the host's client, see `runtime/README.md`). `FormRenderer` is the public
  wrapper: a field whose type the kit does not have is left out and named.
* `src/designer/` — the builder. `document.ts` (UI-free): fields by id + ordered children per container; `fromStored` /
  `toStored` keep the stored contract and add `schemaVersion: 2`; edits are immer recipes (insert, move — never into itself —,
  remove with the inside, duplicate with new keys, rename a key everywhere). `store.ts`: one Zustand store per builder with
  100-step undo/redo (a run of edits with the same key < 1.5 s is one step, e.g. typing a label); unsaved = `doc !== saved`.
  `Canvas.tsx` draws the field kit itself in design mode (controls `inert`), dnd-kit drops into the innermost container under
  the pointer; `Palette.tsx`; `Inspector.tsx` (Field, Settings, Options/Rows, Rules, Logic, JSON); `SettingsForm.tsx` (the
  Settings tab from the type's Zod schema); `DataSources.tsx` (the runtime block). New fields get a key from their label that
  follows it until the form is saved. Keyboard: Ctrl+Z / Ctrl+Shift+Z, Del, Ctrl+D, Alt+↑/↓, Esc, Ctrl+S.
* `src/viewer/` — the data viewer for the submitted data of any form.
* `src/api/` — TanStack Query hooks for templates, submissions, server actions, attachment previews.
* `src/host/` — the `FormsHost` contract, the `FormsClient` and its error helpers, file and directory hooks.

The renderer, designer and viewer came from the web app (task 0.5), which had no typed linting: their `any` is allowed by a
scoped override in `eslint.config.js` until tasks 0.17–0.18 type them. `core/` and `host/` follow the full rules.

## Checks

`pnpm --filter @itrms/form-engine test` runs all of these:
* the unit and component tests (`src/**/*.spec.ts(x)`; core's run in Node);
* `check:engine` — extension points (a custom type end to end, every built-in type creates a valid, drawable field, actions);
* `check:runtime` — bindings, mapping, requests, formulas;
* `form:schema --check` — the backend contract is up to date with the kit.

`check:roundtrip <fixtures.json>` checks that the builder opens and saves real forms unchanged (fixtures:
`{ versions: [{ id, name, form_config }] }`, exported from a database). The e2e journeys are in the web app
(`apps/web/tests/e2e/fill-form.spec.ts`, `builder.spec.ts`).
