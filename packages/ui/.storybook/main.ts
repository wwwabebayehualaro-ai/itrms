// Storybook for the design system (task 0.4a, design-system.md §12): every component, with toolbar switches for language,
// theme and density. The same stories run as browser tests with axe (vitest.stories.config.ts) and as Playwright visual
// baselines (visual/).
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

import { STORY_DEPS } from './deps';

const config: StorybookConfig = {
    framework: '@storybook/react-vite',
    stories: ['../src/**/*.stories.@(ts|tsx)'],
    addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
    core: { disableTelemetry: true },
    // Tailwind 4 compiles the stylesheet in preview.css, exactly as the app's globals.css does.
    viteFinal: (vite) => ({
        ...vite,
        plugins: [...(vite.plugins ?? []), tailwindcss()],
        optimizeDeps: { ...vite.optimizeDeps, include: [...(vite.optimizeDeps?.include ?? []), ...STORY_DEPS] }
    })
};

export default config;
