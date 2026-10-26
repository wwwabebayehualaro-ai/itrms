# @itrms/form-engine

Builds, stores and runs dynamic forms. A form is JSON in `form_config`: `{ schemaVersion?: 2, fields: FormField[], runtime?: TemplateRuntimeConfig }`,
a flat list of fields linked by `parentId`. That shape is a contract: its types, Zod schemas and the backend contract live in
`@itrms/schemas` (`forms/`), and the backend checks every saved form against `contracts/form-config.schema.json` (generated
from them and the field kit: `pnpm --filter @itrms/form-engine form:schema`).

Rules: [code-structure.md](../../docs/platform/code-structure.md) §3 and §7.

## Entry points

| Entry                         | What                                                                                      | Runs in                                |
| ----------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| `@itrms/form-engine/core`     | document model, conditions, values, validation, bindings and formulas                     | browser **and** API (no React, no DOM) |
| `@itrms/form-engine/renderer` | `FormsHostProvider`, `FormRenderer`, `PublishedFormRenderer`, API hooks, extension points | browser                                |
| `@itrms/form-engine/designer` | the form builder (`TemplateBuilder`) and its store                                        | browser                                |
| `@itrms/form-engine/viewer`   | the data viewer of submitted data (see `src/viewer/README.md`)                            | browser                                |

`core` stays UI-free: dependency-cruiser (`form-engine-core-is-ui-free`) and the shared ESLint config (no DOM globals, no
JSX, no React/Next.js/design-system imports in `src/core`) enforce it, and `src/core/node.spec.ts` runs it in plain Node.

## The host: what the app provides

The engine imports nothing of an app. The app wraps its screens once in a `FormsHostProvider` with a `FormsHost`:

```tsx
import { FormsHostProvider, type FormsHost } from '@itrms/form-engine/renderer';

const host: FormsHost = {
    client, // a FormsClient: the app's HTTP client (token, refresh, Idempotency-Key, sign-in)
    useUser: useAuthUser, // hook: the signed-in person ({{user.*}}, permission hints)
    useLocation, // hook: pathname, search, params, push, replace (Next.js in the web app)
    templatesHref: '/dynamic-template/saved-templates',
    isReported, // optional: errors the app has already shown
    logError: (message, error) => logger.error({ err: error }, message),
    roleKeys: ROLE_KEYS, // optional: the installation's role keys ("Only for roles" in the builder)
    useLanguages // optional hook: { language, languages } (forms are drawn in `language`)
};
<FormsHostProvider host={host}>{children}</FormsHostProvider>;
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

## Rules written as formulas, and the Ethiopian date

Task 0.17b. A field's `behavior.validation` may hold `requiredWhen: { expression }` (required while it holds) and
`validWhen: [{ expression, message }]` (each must hold; a message is a text in every language). Expressions are bare
formulas (no `{{= }}`) that read `form.*` (the field's scope: its row, inside a section), `row.*`, `root.*` (the whole
form) and `user.id` / `user.roles`: what the server has too. `checkDocument` refuses any other reference or an unknown
function at save, so a rule never behaves differently in the API; at run time a formula that fails holds (never blocks).
`days(a, b)` gives whole days between two dates (an instant counts on its Addis Ababa day).

- **Order of checks** (`validateForm`, over the values with hidden fields pruned until stable): hidden or disabled
  fields are skipped; every value field's basic type is checked by its kit type (`core/kinds.ts`, read-only computed
  fields excepted); then, on validated fields, required (static or `requiredWhen`), the type rules, the choice, the
  `validWhen` checks (not on a blank value) and the remote check. A section's own checks read its rows; Required means at
  least one row; a section takes at most 1,000 rows.
- **Computed fields:** `settledValues` recomputes read-only computed fields as a fixpoint, so a total over row totals is
  right whatever the browser sent.
- **`EthDate`:** a day picked on the Ethiopian calendar (`EthiopianDatePicker`), stored as the ISO Gregorian day
  (`YYYY-MM-DD`, checked strictly), with `props.minDate` / `props.maxDate` as Gregorian days; `ethiopianDateText` writes
  it for people (viewer, filters, exports).

## Texts in every language

A field's label, help text, placeholder, option labels and custom messages are each a plain string (one text for every
language, what older builders stored) or a text per language, `{ am, en, 'wal-Latn' }` (task 0.17a;
`packages/schemas/src/forms/text.ts`). One list, `fieldTexts(field)`, names every translatable text of a field with its
path; resolving, the save-time contract check, the builder's translation table and the untranslated count all walk it.

- **Reading:** `readDocument(raw, { language })` / `toEngineField(stored, language)` give every text in one language
  (the language, then Amharic, then English, then any; an empty text counts as missing), so the renderer, validation,
  the viewer and the API work with plain strings. The renderer reads the host's language (`useFormsLanguages()`); the
  API reads the request's.
- **Writing (the builder):** `setTextIn(text, language, value, plainAs)`. A plain string written in the authoring language
  (`plainAs`, the page's language) stays plain; written in another, it becomes a map that keeps it. A map never turns
  back into a plain string, and a translation never changes a field's key or an option's value.
- **Untranslated:** `untranslatedTexts(fields, plainAs)` lists the texts with nothing of their own in Amharic or
  English (other languages are reported, not counted). The builder's Translations sheet shows them; publishing warns,
  it does not block.
- **The form's text language (0.17c):** `form_config.textLanguage` says which language the plain strings of the form are
  written in (default `am`; a new form takes the builder's language). `untranslatedInDocument(formConfig)` uses it, so
  publishing warns about the right texts.
- **More texts (0.17c):** panel, group, card and section titles, subtitle and footer, the row buttons and the empty
  message of a repeatable section, the upload button, column headers of data tables and the empty message of a data
  binding are texts per language too, read in the reader's language.

## The engine's own words

Every word the engine itself shows (the builder's palette, settings and screens, the renderer's buttons and messages,
the data viewer, print, and core's default validation messages) comes from its catalogues,
`messages/<area>/{am,en,wal-Latn}.json` (areas `core`, `palette`, `settings`, `designer`, `renderer`, `viewer`; keys
`form-engine.<area>.…`; task 0.17d, ADR-0036). `pnpm i18n:check` checks them like a slice's.

- **Core:** `engineText(language, key, values?)`, `engineTranslator(language)` and `wordIn(language, word)` (ICU messages
  through intl-messageformat; fallback `wal-Latn → am → en`). Keys are typed from the English catalogues: a mistyped key
  fails typecheck. The same words reach the browser, the API's 422 (`validateForm(…, { language })`, default Amharic;
  the API passes the caller's) and the print worker (`printWords(language)`).
- **On screen:** `useEngineText()` → `{ language, t, word }`. A form's words follow the language it is drawn in
  (`EngineForm` sets `<EngineTextLanguage>`); the builder's and viewer's follow the host's (`FormsHost.useLanguages`).
- **Palette and settings:** a field type's `label` and `hint` and its settings' `title`, `description` and `labels` are
  words (`EngineWord`: a catalogue key, or `{ am, en }` for an extension's own type). `createField` stores the palette
  label in the builder's text language and takes the key from its English word.
- **The design system's words** the engine uses (the grid and pager) come in as labels (`useGridLabels`); the app gives
  the Ethiopic typing announcement's (`EthiopicTypingProvider`, `shell.ethiopic.*`).
- **Still English:** form-author diagnostics (formula parse errors, unsupported patterns, document checks) until they get
  error codes, and developer errors.
- **Tests:** the test host's language is Amharic; specs say engine words with `amText(key)` / `enText(key)` from
  `src/test-utils.tsx`.

## Print

`printModel(form, values, { language, roles?, omitBlank?, gregorian?, ... })` (core, UI-free) turns a form and its
answers into a tree of nodes (value, group, divider, rows) with every text and value already worded in one language and
dates Ethiopian. Hidden fields, fields the reader's roles do not see, display fields and unknown values are left out.
`<PrintForm form values language title? options? />` (`@itrms/form-engine/print`, React and core only; also re-exported by
`renderer`) lays the tree out as plain semantic HTML.

- **What prints how:** values in a 12-column grid (`span`); Panel, Group, Card and Section as titled sections (heading
  level by depth); a divider as a rule or a line with text; a repeatable section as a table (up to 6 columns, no nested
  section: one with a nested section always prints by row) or one block per row (`printLayout`: `auto`, `table`, `rows`); no rows print the empty message.
- **Page breaks:** `printBreakBefore` on a container starts a new page (`data-break-before`); rows and items do not
  split, table headings repeat on every page.
- **Safe to render anywhere:** no hooks, host, design system or inline styles, so it works with `renderToStaticMarkup` in
  Node and under a strict CSP. Values are escaped by React. Load the layout with `@itrms/form-engine/print.css` (the web
  app does in `globals.css`); the page size and margins belong to the document template.
- **Used by** the PDF worker of task 0.23 for application copies.

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

- `src/core/` — UI-free. `readDocument` reads every stored version into resolved fields (`props` over the older palette's
  `defaultProps`); conditions (`and`/`or`/`xor`/`not`; a hidden container hides its children); initial values; pruning of
  hidden values; validation compiled to Zod (`validateForm` → `{ 'items[2].qty': 'message' }`). `core/runtime/`: `{{...}}`
  bindings, formulas, response mapping (no code evaluation).
- `src/renderer/` — `EngineForm` on TanStack Form (each field subscribes to what it reads) and the field kit (`kit.ts`: one
  definition per stored type name; built-ins in `fields/`, their builder descriptions in `fields/design.ts`); field actions
  (`actions.ts`); `runtime/` (data sources through the host's client, see `runtime/README.md`). `FormRenderer` is the public
  wrapper: a field whose type the kit does not have is left out and named.
- `src/designer/` — the builder. `document.ts` (UI-free): fields by id + ordered children per container; `fromStored` /
  `toStored` keep the stored contract and add `schemaVersion: 2`; edits are immer recipes (insert, move — never into itself —,
  remove with the inside, duplicate with new keys, rename a key everywhere). `store.ts`: one Zustand store per builder with
  100-step undo/redo (a run of edits with the same key < 1.5 s is one step, e.g. typing a label); unsaved = `doc !== saved`.
  `Canvas.tsx` draws the field kit itself in design mode (controls `inert`), dnd-kit drops into the innermost container under
  the pointer; `Palette.tsx`; `Inspector.tsx` (Field, Settings, Options/Rows, Rules, Logic, JSON); `SettingsForm.tsx` (the
  Settings tab from the type's Zod schema); `DataSources.tsx` (the runtime block). New fields get a key from their label that
  follows it until the form is saved. Keyboard: Ctrl+Z / Ctrl+Shift+Z, Del, Ctrl+D, Alt+↑/↓, Esc, Ctrl+S.
- `src/viewer/` — the data viewer for the submitted data of any form.
- `src/api/` — TanStack Query hooks for templates, submissions, server actions, attachment previews.
- `src/host/` — the `FormsHost` contract, the `FormsClient` and its error helpers, file and directory hooks.

The renderer, designer and viewer came from the web app (task 0.5), which had no typed linting: their `any` is allowed by a
scoped override in `eslint.config.js` until tasks 0.17–0.18 type them. `core/` and `host/` follow the full rules.

## Checks

`pnpm --filter @itrms/form-engine test` runs all of these:

- the unit and component tests (`src/**/*.spec.ts(x)`; core's run in Node);
- `check:engine` — extension points (a custom type end to end, every built-in type creates a valid, drawable field, actions);
- `check:runtime` — bindings, mapping, requests, formulas;
- `form:schema --check` — the backend contract is up to date with the kit.

`check:roundtrip <fixtures.json>` checks that the builder opens and saves real forms unchanged (fixtures:
`{ versions: [{ id, name, form_config }] }`, exported from a database). The e2e journeys are in the web app
(`apps/web/tests/e2e/fill-form.spec.ts`, `builder.spec.ts`).
