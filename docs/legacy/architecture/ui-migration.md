# UI migration: PrimeReact → design system (shadcn/ui + Radix + Tailwind 4)

The frontend moves from PrimeReact 10 + PrimeFlex + Sass to an owned design system in `@platform/ui`: shadcn/ui components on
Radix primitives, styled with Tailwind CSS 4, forms with TanStack Form + Zod. The decision is recorded in
[ADR 0003](adr/0003-ui-stack.md). The migration is staged so the product keeps working at every step.

## Rules (the migration is complete)
* Features import UI **only** from `@platform/ui` (`Button`, `Input`, `Dialog`, `Table`, `useZodForm`, ...). Importing
  `primereact`/`primeflex`/`primeicons` or `radix-ui`/`@radix-ui/*` is an ESLint **error** everywhere except Radix inside
  `platform/ui/primitives` (`eslint.config.mjs`).
* Tailwind CSS 4 with Preflight and no prefix (`flex gap-2`); theme tokens (`--primary`, `--background`, ...) and the Inter
  font in `app/globals.css`; light/dark through the `dark` class on `<html>` (next-themes, toggle in the top bar).
* Icons are lucide (`lucide-react`); module menu icons are lucide names (`layout/navIcons.ts`).
* Add a primitive with the shadcn CLI: `npx shadcn@4.21.0 add <name>` (writes to `platform/ui/primitives`), then export it from
  `platform/ui/index.ts`.
* The code editor's playground (`dynamic-template/code-UI`) loads PrimeReact from a CDN inside its sandboxed iframe for the
  snippets people write there; the app itself does not depend on it.

## Stages
| Stage | Scope | Status |
|---|---|---|
| **A** | Design-system foundation: Tailwind 4 (prefixed, no Preflight), shadcn primitives in `platform/ui/primitives`, `cn`, forms kit (`useZodForm`, `ZodForm`, field components), lint zones. All **new** screens (approvals, feature flags, sequences) use it. | ✅ done |
| **B** | App shell and shared widgets: sidebar/topbar → shadcn Sidebar (`layout/AppShell.tsx`, `AppNav.tsx`); `NotifyProvider` → sonner + AlertDialog; `DataGrid` → DS `Table`; every screen: template gallery / Templates Pool, data viewer, record page, request editor, code editor chrome, requests by status / mine / recent, dashboard, sign-in, 403/error/404. | ✅ done |
| **C** | Form engine on the design system: field kit + `EngineForm` (TanStack Form, Zod), data viewer, builder (undo/redo, generated settings), data sources editor; the original PrimeReact/Formik/Yup renderer and builder, the 16k-line `FIELD_TYPES` generated from PrimeReact's `.d.ts` and `check:canvas` are removed; stored forms are read as they are (no data migration); the backend validates `form_config` against `contracts/form-config.schema.json` (generated from the engine). Form Engine v2 phases 1–5 in `PROGRESS.md`. | ✅ done (PrimeReact is an ESLint error in `platform/form-engine/**`) |
| **D** | Removed `primereact`, `primeflex`, `primeicons` (and the unused `chart.js`, `quill`, `framer-motion`, `sass`), the Sass layout styles, the theme files in `public/themes` and the Sakai demo assets/types; Preflight imported; the `tw:` prefix and the `.ds-root` scoping dropped with a codemod; the PrimeReact z-index overrides removed (shadcn's own stacking). | ✅ done |

## Why it was staged and not a big switch
Saved templates (the `form_config` JSON in the database) store PrimeReact component props, and the builder's field catalogue
is generated from PrimeReact's type definitions. Replacing the renderers needs a data migration and a renderer-by-renderer
regression check, which is stage C; doing it together with everything else would leave the product broken for weeks.
