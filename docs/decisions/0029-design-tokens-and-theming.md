# ADR 0029: Design tokens in three tiers, themes, branding within limits, Ethiopic-first typography

* Status: accepted (2026-10-18)

## Context
The legacy design system (shadcn/ui on Radix, Tailwind 4, OKLCH tokens, light and dark themes) is a strong base. But it uses
Inter only, has English strings in components, no density or high-contrast mode, no tenant branding, no templates, and no
documentation or visual tests. ITRMS is read mainly in Amharic, by data-entry staff, and by several customers.

## Decision
* **Tokens:** primitive → semantic → component tiers as CSS variables (Tailwind 4 `@theme inline`), also exported for
  charts and PDFs. A contrast test runs over every theme in CI.
* **Themes:** light, dark and high contrast (a user preference). **Density:** comfortable and compact.
* **Branding:** logo, header line, a primary hue from 8 pre-validated hues, and document headers, set in the settings
  hierarchy. No arbitrary colours, and no component forks.
* **Typography:** Noto Sans Ethiopic + Noto Sans (replacing Inter) + Noto Sans Mono. Base 16 px, Ethiopic line height 1.6;
  no uppercase, letter-spacing or synthetic italics on Ethiopic.
* **One status vocabulary** (7 tones) for all modules. **Page templates** (list, record, case, form, dashboard, settings,
  print) for every screen.
* **Quality:** WCAG 2.2 AA with axe in CI; Storybook with stories in am/en/wal-Latn × themes × densities; Playwright
  visual regression.

Details: `docs/platform/design-system.md`.

## Consequences
* Task 0.4 moves the design system and adds tokens, fonts, themes and density. A new task, 0.4a, adds Storybook, visual
  tests and the page templates. The case template comes with task 0.20.
