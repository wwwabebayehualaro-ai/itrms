# Design system

`packages/ui`: one design system for every module, every customer and every language. Decision:
[ADR-0029](../decisions/0029-design-tokens-and-theming.md).

## 1. Starting point (legacy, kept)
* **Base:**
  * shadcn/ui components (copied source) on Radix, Tailwind CSS 4, lucide icons, sonner toasts, Recharts through the shadcn
    chart;
  * 30 primitives plus composite controls (`Combobox`, `DatePicker`, `TagsInput`, `Pager`, `IconButton`, `StatusBadge`,
    `DataGrid`, `FileViewer`) and the forms kit (`useZodForm`);
  * one `NotifyProvider` (toasts + confirmation dialog).
* **Tokens:** CSS custom properties in OKLCH (`--background`, `--primary`, `--success`, `--warning`, `--chart-1`, …), a
  light and a dark theme, the `next-themes` toggle.
* **Rules (lint-enforced):** features import UI only from the design system, never Radix or vendor libraries directly.
* **Gaps for ITRMS** (task 0.4b closed the font, density, high-contrast and status-tone gaps):
  * Inter only (no Ethiopic font);
  * English-only strings inside components;
  * no Ethiopian date picker, money input or registry lookup;
  * no page templates;
  * no density or high-contrast mode;
  * no tenant branding;
  * no documentation site or visual regression tests;
  * no print styles.

## 2. Principles
1. **Readable in Amharic first.** Every component is designed and tested with Ethiopic text, which is longer and taller
   than English, and with Wolaytta in Latin script.
2. **Built for data-entry staff:** keyboard-first, dense where it helps, forgiving with errors, fast on old PCs and slow
   links.
3. **Consistent across 10 work processes:** the same page templates, status colours and wording, so a cashier who learns
   one screen knows them all.
4. **Accessible by default:** WCAG 2.2 AA, checked automatically.
5. **Themeable, not forkable:** customers brand it through tokens and settings and never edit components.

## 3. Tokens (three tiers)

| Tier | Example | Who changes it |
|---|---|---|
| **Primitive** (the palette) | `--blue-600: oklch(0.55 0.17 255)`, `--neutral-100`, radius and spacing scales | Design-system owners only |
| **Semantic** (meaning) | `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--destructive`, `--success`, `--warning`, `--info`; status tokens (§6); `--chart-1…8` | Themes (light, dark, high contrast) and, within limits, tenant branding |
| **Component** | `--sidebar-*`, `--table-row-height`, `--field-height`, `--page-gutter` | Density modes |

* Tokens are written once, in TypeScript (`packages/ui/src/tokens/tokens.ts`). `pnpm --filter @itrms/ui tokens` generates
  `packages/ui/src/styles/tokens.css` from them (CSS variables, exposed to Tailwind 4 via `@theme inline`), and a test fails
  while that file is stale. Charts and documentation read the same values from `@itrms/ui/tokens`.
* The palette is generated: each hue (slate, grey, brand, blue, indigo, green, amber, red) gets steps 50–950 at fixed
  OKLCH lightness, with chroma clamped to the sRGB gamut, so every screen shows the colour the contrast test measured.
* Tailwind's default palette is switched off (`--color-*: initial`): `bg-red-500` produces no CSS, and a test rejects
  palette utilities and literal colours in components.
* Apps import the stylesheet once, after Tailwind: `@import '@itrms/ui/styles.css';` (fonts, tokens, variants, base rules).
* The **same tokens drive the PDF templates** (`documents` module), so printed certificates match the screens.
* Colours are defined in OKLCH. A contrast test in CI checks every foreground/background pair in every theme (≥ 4.5:1 for
  text, ≥ 3:1 for UI parts: form-field outlines, focus rings, status icons and chart marks). The high-contrast theme reaches
  7:1 (AAA) on every text pair. The checked pairs are `CONTRAST_PAIRS` in `tokens.ts`.

## 4. Themes and branding
* **Themes:** light (default), dark, **high contrast** (for bright offices and low-vision users). The setting
  `ui.theme` = system | light | dark | high-contrast is a user preference. `AppearanceProvider` puts the theme class
  (`.dark`, `.high-contrast`) and `data-density` on `<html>`, and `AppearanceMenu` switches both at runtime. Until user
  settings exist (task 0.21) both are remembered per browser.
* **Default product palette:** a calm government look. Primary is deep teal-blue; neutrals are slate; status colours are
  fixed (§6). The Ethiopian flag colours are not used as UI colours, because they clash with the status colours. The national
  emblem appears only in document headers where the bureau supplies it.
* **Tenant branding** (settings at region, zone or unit level, [org-and-unit-types.md](org-and-unit-types.md) §4):
  * logo (SVG or PNG), product name line ("ደቡብ ኢትዮጵያ ክልል ትራንስፖርትና መንገድ ልማት አስተዳደር ቢሮ");
  * the primary hue, from a curated list of 8 hues, each pre-validated for contrast in all three themes. Arbitrary hex
    values are not allowed;
  * document header and footer, stamp image and signature lines (used in PDFs).
* **Density:** `comfortable` (default) and `compact` (data-entry staff: 32 px rows, tighter forms). It is a user
  preference that can be defaulted per region. Controls read the component tokens (`--field-height`,
  `--table-row-height`, …). On touch screens (`pointer: coarse`) they stay at least 44 px tall in either density.

## 5. Typography (Ethiopic-aware)
* **Fonts (self-hosted, OFL):**
  * **Noto Sans Ethiopic** for Ethiopic script;
  * **Noto Sans** for Latin script (English, Wolaytta), replacing Inter, so both scripts share metrics and look like one
    family;
  * **Noto Sans Mono** for codes and numbers in tables (licence and plate numbers).

  Variable fonts from the `@fontsource-variable` packages, bundled by the app and served from its own origin (never a CDN),
  split per script with `unicode-range`, `font-display: swap`. There are no italic files: emphasis is weight.
* **Font stack:** `'Noto Sans Variable', 'Noto Sans Ethiopic Variable', system-ui, sans-serif`. Noto Sans has no Ethiopic
  glyphs, so in mixed text (e.g. "ቦሎ No. WLT/000123") Latin uses Noto Sans and Ethiopic falls through to Noto Sans
  Ethiopic. A page downloads a script's file only when it shows that script.
* **Ethiopic rules** (keyed on the language: `:lang(am)`, `:lang(ti)`, `:lang(gez)`):
  * base size **16 px** (never below 14 px for Ethiopic text);
  * line height **1.6** for body text and 1.3 for headings (Ethiopic glyphs are taller);
  * **no uppercase transforms, no letter-spacing, no synthetic italics** (Ethiopic has no case, and italics damage it).
    Emphasis is weight only;
  * truncation always shows a tooltip with the full text;
  * labels may wrap to two lines; components never assume the width of an English label.
* **Numbers:** Latin digits by default (Ethiopic numerals optional in print only). Money is right-aligned in tables with
  tabular figures, in the format `ብር 1,234.50`.

## 6. Status vocabulary (shared by every module)
One set of states and colours for cases, tasks, documents and payments. A module maps its own states onto these tones.
Labels are translated.

| Tone | Used for | Colour token |
|---|---|---|
| `neutral` | draft, not started | `--status-neutral` (slate) |
| `info` | submitted, in review, waiting | `--status-info` (blue) |
| `progress` | in progress, exam scheduled | `--status-progress` (indigo) |
| `success` | approved, issued, paid, valid | `--status-success` (green) |
| `warning` | returned, due soon, expiring | `--status-warning` (amber) |
| `danger` | rejected, overdue, revoked, infected file | `--status-danger` (red) |
| `muted` | cancelled, superseded, archived | `--status-muted` (grey) |

Colour is never the only signal: every status shows its label and an icon (`StatusBadge`: dashed circle, clock, dot,
check, triangle, octagon, minus). Each tone has three tokens: a solid colour for the icon, border and calendar edge
(3:1), a soft fill, and a text colour on that fill (4.5:1). They are `--status-<tone>`, `--status-<tone>-bg` and
`--status-<tone>-fg`.

## 7. Page templates (every screen uses one)

| Template | Used for | Parts |
|---|---|---|
| **List** | applications, registries, receipts | page header (title, primary action), filter bar (saved views, search, filters in the URL), DataGrid (server paging, column chooser, row actions, bulk actions, export), empty state |
| **Record** | a person, vehicle, licence, organisation | header with key facts and status, tabs (overview, history, documents, related; modules add tabs), audit timeline |
| **Case** | a service request | header (case number, service, unit, state, SLA clock), step indicator from the workflow, current task panel (the step form and its actions), answers by step, payments, documents, timeline and comments |
| **Form** | intake and step forms | engine-rendered form, sticky action bar (save draft, submit), autosave indicator, field errors in the user's language, fee preview |
| **Dashboard** | role homes, unit KPIs | widget grid (responsive), each widget with a link to its list |
| **Settings** | admin | sections with inherited/overridden indicators ("from region", "set here", reset) |
| **Print** | application copy, receipts, reports | A4, Ethiopic fonts, header from branding, QR, no interactive parts |

The layouts and their parts are in `packages/ui/src/templates` (task 0.4c; the case layout comes with the workflow in 0.20).
They place what a page passes in and hold no data fetching. Their own words (search, clear filters, select all) are a
`labels` prop with English defaults until the message catalogues exist (0.13). Panels size themselves by their container
(`@container`), not the window, so the same record panel works in a page and in a side sheet.

## 8. Component inventory

| Component | Status | Notes |
|---|---|---|
| Primitives (button, input, select, dialog, sheet, tabs, table, tooltip, …) | have | Re-tested with Ethiopic text |
| `DataGrid` | **extended** (0.4c) | Done: column pinning and resizing (drag or arrow keys), bulk selection by row id across pages with a bulk-action bar (`getRowId` is required with selection; the count is announced in a live region), keyboard row navigation (one tab stop; arrows, Home, End; Enter opens, Space selects). Density follows the global density. Saved views and audited export come with the data viewer (0.16), the column chooser too |
| `DatePicker` | **extend** | Ethiopian calendar mode (default), Gregorian toggle, typed entry `dd/mm/yyyy` in either calendar, min/max rules |
| `MoneyInput` / `MoneyText` | **have** (0.4c) | Santim as `bigint`; typed Birr is read digit by digit (`parseBirr`), a third decimal is refused, never rounded; a separator counts only between groups of three digits, so a decimal comma ("12,50") is never read as 1,250; a paste drops a currency word; shown as "1,250.50" (`formatBirr`). Property-tested: no float ever comes out. The helpers move to `packages/schemas` with the `Money` type (0.5) |
| `RegistryLookup` (person, vehicle, licence, association, organisation) | **new** | Async search in both scripts, shows key facts, creates a new record inline when allowed |
| `PersonName` | **have** (0.4c) | Ethiopic + Latin spellings, each tagged with its language; given, father and grandfather names (no surname); full or short form |
| `UnitBadge`, `UnitSwitcher` | `UnitBadge` **have** (0.4c), `UnitSwitcher` **new** | Shows the org unit with its kind and grade, as words the caller passes (ADR-0026: no unit-type keys in UI code) |
| `StatusBadge` | **extend** | The tones of §6, with icons |
| `StepIndicator`, `Timeline`, `SlaClock` | **new** | Case template |
| `FileDropzone` + scan status | **new** | Resumable uploads (Uppy), pending-scan/clean/infected states, camera capture on phones |
| `PageHeader`, `FilterBar`, `EmptyState`, `DescriptionList`, `KpiTile`, `WidgetCard` | **have** (0.4c) | Template parts; with `ListLayout`, `RecordLayout`, `FormLayout`, `DashboardLayout`, `SettingsLayout` (+ `SettingsSection`, `SettingRow`). `Templates/Pages` shows a list and a record page built only from them |
| `CommandPalette` | **new** | cmdk (already a dependency) |
| `EthiopicInput` (transliteration) | **new** | Phonetic Latin → Ethiopic typing in every text input and textarea (toggle with a key; a common SERA-style scheme). Many office PCs have no Amharic keyboard layout, so this is part of the base `Input`, not an add-on |
| `QrCode`, `VerifyBadge` | **new** | Documents and verification |
| `PrintLayout` | **have** (0.4c) | A4 page with letterhead, QR slot and footer; shared by the browser print view and PDF templates (0.23) |
| `ConnectionStatus`, `SubmitQueue` | **new** | PWA states (ADR-0024) |
| Charts (`ChartContainer`) | have | The existing data-visualisation rules (validated palette, a table view for every chart) |

## 9. Interaction rules
* **Keyboard:** every action has a keyboard path. Enter submits, Esc closes, Ctrl+S saves a draft, Ctrl+K opens the
  palette, `?` lists shortcuts. Forms move field to field in reading order.
* **Errors:**
  * shown at the field, in the user's language, saying what to do ("ዕድሜ ቢያንስ 18 መሆን አለበት"), never as raw codes;
  * the form keeps the user's input;
  * server errors map to fields (as the legacy forms kit does).
* **Confirmation** only for destructive or irreversible actions (reject, revoke, reverse receipt), with the consequence
  written out.
* **Feedback:**
  * toasts for completed background actions;
  * an inline banner for page-level problems;
  * skeletons for loading;
  * the optimistic UI only where an action can't fail on business rules.
* **Empty states** say why the list is empty and what to do next.

## 10. Accessibility
* Target: **WCAG 2.2 AA**.
* **axe-core** runs in every Playwright journey and in the component tests; violations fail CI.
* Focus is always visible (`--ring`). Touch targets are ≥ 44 px in compact mode on phones. `prefers-reduced-motion` is
  respected.
* Forms: labels are always visible (never placeholder-only), errors are announced (`aria-live`), and required fields are
  marked with text as well as a symbol.

## 11. Responsive and print
* Breakpoints: phone < 640, tablet < 1024, desktop ≥ 1024. Container queries are used in widgets and record panels, so
  they adapt to their slot, not the window.
* The office desktop (1366×768) is the main target. Field screens (inspection, verification) are designed for phones first.
* `@media print` styles for every template. Paper is white: printed from the dark theme, a page uses the light tokens
  (generated in `tokens.css`). PDFs reuse `PrintLayout` with the same tokens.

## 12. Documentation, testing and governance
* **Storybook** 10 in `packages/ui` (`pnpm --filter @itrms/ui storybook`). Every component has a story next to it
  (`<name>.stories.tsx`). Toolbar switches set the language (**am, en, wal-Latn**), the theme and the density on `<html>`,
  exactly as the app does. Story text comes from `src/stories/fixtures.ts` (generated sample data, both languages; Wolaytta
  falls back to English until its catalogue exists).
* **Every story is a test** (`test:stories`): Storybook's Vitest addon renders it in headless Chromium, runs its `play`
  checks, and fails it on any **axe** violation. It runs in Amharic in all three themes and both densities, and in
  English in the default look. The Ethiopic layout rules of §5 are such checks (`Foundations/Ethiopic typography`).
  The modes run one after another. A mode that gives no result within 10 minutes (normally under one) is killed and run
  once more, and the retry is printed: a browser that loses its Vitest connection never reaches the test timeout.
  A mode that ends with failing tests is never retried. A hung mode is run again whole, so a failure printed before the
  hang shows only in the log of the first run; check the log of a retried mode.
* **Visual regression** (`test:visual`): one Playwright screenshot per story in **Amharic and English, light,
  comfortable**, taken from the built Storybook in the pinned Linux Playwright image, with the bundled Noto fonts. The
  picture is taken once Storybook reports the story finished without an error (rendered, `play` passed, no uncaught
  error) and the fonts are loaded; animations are off, and at most 25 pixels may differ (anti-aliasing), so a changed glyph or a moved control fails. The
  baselines live in `packages/ui/visual/__screenshots__/`. To change them on purpose: commit the change, run
  `pnpm ci:local --jobs stories --update-visual` (HEAD only; it replaces the whole folder, so a removed story leaves no
  stale picture), review the new images, commit them. A story tagged `no-visual` (for content a screenshot can't pin) is
  still checked by axe. `PdfViewer` has no story yet (it needs a sample PDF and the pdf.js worker; follow-up for 0.13).
* **Ownership:** a platform UI owner (CODEOWNERS). A new component starts as a proposal (problem, API, states,
  a11y). Module teams never fork components; they extend through props and slots.
* The **legacy rules carry over:** features import only from `@itrms/ui`, and importing Radix or vendor UI directly is a
  lint error.
