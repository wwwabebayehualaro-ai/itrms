# Frontend platform

Everything cross-cutting lives here, owned by the platform team. Feature code (`app/`, `layout/`) consumes it through
public entry points only; ESLint enforces this (see `.eslintrc.json`).

| Package | Import | What it is |
|---|---|---|
| `platform/lib` | `@platform/lib/...` | Non-visual toolkit: authenticated HTTP client (`api/client`), API error mapping, `useApiRequest`, session/auth store, formatters, download helpers, logger |
| `platform/ui` | `@platform/ui` | Design system: primitives (shadcn/ui on Radix + Tailwind: `Button`, `Input`, `Select`, `Dialog`, `Sheet`, `Table`, `Tabs`, `Card`, `Badge`, `Field`, ...), forms kit (`useZodForm`, `ZodForm`), `NotifyProvider`/`useNotify`, `QueryProvider`, `confirmAction`, composite controls (`Combobox`, `DatePicker`, `TagsInput`, `Pager`, `IconButton`, `StatusBadge`), charts (`ChartContainer`), `DataGrid`, `InlineStatus`, `RichTextEditor`, `AuthGate`, file viewer/uploader |
| `platform/form-engine` | `@platform/form-engine`, `@platform/form-engine/builder` | Form builder, renderer, runtime (data sources, bindings, dependencies), field registry and extension points |

Layering: `form-engine` → `ui` → `lib`. Lower layers never import upward, and nothing in `platform/` imports `app/`.

## Server state = TanStack Query
* All server data is read with `useQuery` and written with `useMutation`; **no `useEffect` + `useState` fetching**. Keys come from `createKeys('resource')` (`@platform/lib/query/keys`) so invalidation is uniform.
* `QueryProvider` (root layout) owns the single `QueryClient`: sensible defaults (30 s fresh, no retry on 4xx, backoff on network/5xx), **one** place that reports failures (mutations toast automatically; use `meta: { errorMessage }` to word it or `meta: { silent: true }` to opt out; background refetch failures toast only when stale data is on screen), and it **clears the cache whenever the signed-in user changes**, so one tenant's data is never shown to the next user.
* Read hooks: `useTemplateList`, `useTemplateQuery` (seeded from the list cache), `useSubmissionList` (server paging/sorting, `keepPreviousData`), `useFilePreview` (immutable, cached per file id). Write hooks: `useTemplateMutations` (optimistic delete with rollback), `useSubmissionMutations`, `useFileUpload`. Mutations invalidate the affected keys themselves.
* Tables: `DataGrid` (TanStack Table) is server-driven - keep `pagination`/`sorting` in state, put them in the query key, pass the rows in.
* When you show your own error for a failed mutation, check `isReported(error)` (`@platform/lib/api/errors`) so the user is not told twice.

## Design system
* UI is built from the `@platform/ui` primitives (shadcn/ui on Radix, Tailwind CSS 4: `flex gap-2`, tokens in
  `app/globals.css`, lucide icons). PrimeReact was removed; importing it or Radix directly is an ESLint **error**. Rules:
  `Docs/architecture/ui-migration.md`.
* Hand-written forms: `useZodForm({ schema, defaultValues, onSubmit })` + `<ZodForm>` + `form.AppField` with the registered field
  components (`TextField`, `TextareaField`, `SelectField`, `SwitchField`); server field errors land on the fields.
* API types: `ApiSchema<'Name'>` from `@platform/lib/api/types` (generated from `contracts/openapi.json`, `npm run api:types`).

## Rules for feature code
* HTTP only through `@platform/lib/api/client` (never `fetch`/`axios`); it owns authentication.
* Notifications/confirmations only through `@platform/ui` (no own `<Toast>`/`<ConfirmDialog>`).
* Builder-made forms: render with `FormRenderer` / `PublishedFormRenderer`; add field types with `defineFieldType` + `describeFieldType`, actions with `registerAction`.
* No `eval` / `new Function`; templates are data.
