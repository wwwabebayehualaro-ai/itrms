# @itrms/ui

Design system: tokens, themes, primitives, components, page templates and Ethiopian controls.

Rules: [code-structure.md](../../docs/platform/code-structure.md) §3 and §7, [design-system.md](../../docs/platform/design-system.md).

## Commands

| Command (`pnpm --filter @itrms/ui …`) | What it does |
|---|---|
| `test` | unit tests (happy-dom): tokens, contrast, design-system rules, components |
| `storybook` | Storybook on http://localhost:6006, with language, theme and density switches in the toolbar |
| `test:stories` | every story in headless Chromium with axe and its checks: Amharic in every theme and density, English in the default look |
| `build-storybook` | the static Storybook in `storybook-static/` |
| `test:visual` | screenshots of every story (am, en; light, comfortable) against `visual/__screenshots__/`. Linux only: run it through `pnpm ci:local --jobs stories` |
| `tokens` | regenerate `src/styles/tokens.css` from `src/tokens/tokens.ts` |

`test:stories` needs Chromium once on a new machine: `pnpm --filter @itrms/ui exec playwright install chromium`.

## Writing a story

Next to the component, `<name>.stories.tsx`. Text from `src/stories/fixtures.ts` in Amharic and English (`<T text={…}/>`,
`useText`; hooks only in named components), open overlays in `play` and wait for them (`await screen.findByRole('dialog')`) so axe and the screenshot see their
content, fixed dates and data, and `duration: Infinity` for toasts. The
patterns: `src/primitives/button.stories.tsx`, `src/controls/StatusBadge.stories.tsx`.
