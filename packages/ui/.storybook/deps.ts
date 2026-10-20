// Dependencies Vite only discovers while stories render (dynamic imports, deep component trees). Found mid-run, Vite
// re-optimises them and reloads the browser, which fails the stories that were running; so they are pre-bundled up front,
// in Storybook (main.ts) and in the story tests (vitest.stories.config.ts).
export const STORY_DEPS = ['@tanstack/react-form', '@tanstack/react-table', 'zod'];
