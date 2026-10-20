// Every story as a browser test (Storybook's Vitest addon, headless Chromium), with axe violations as failures
// (preview.tsx: a11y.test = 'error') and each story's play function. One project per mode (.storybook/modes.mjs);
// `pnpm --filter @itrms/ui test:stories` runs them one after another (.storybook/run-stories.mjs).
import { join } from 'node:path';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { STORY_DEPS } from './.storybook/deps';
import { MODES, projectName } from './.storybook/modes.mjs';

export default defineConfig({
    test: {
        projects: MODES.map((mode) => ({
            plugins: [storybookTest({ configDir: join(import.meta.dirname, '.storybook') }), tailwindcss()],
            define: { __STORY_MODE__: JSON.stringify(mode) },
            // Pre-bundled up front: found mid-run, Vite re-optimises them and reloads the browser, failing the stories.
            optimizeDeps: { include: STORY_DEPS },
            test: {
                name: projectName(mode),
                browser: {
                    enabled: true,
                    headless: true,
                    provider: playwright(),
                    instances: [{ browser: 'chromium' }],
                    connectTimeout: 120_000
                },
                setupFiles: [join(import.meta.dirname, '.storybook', 'vitest.setup.ts')],
                // A story with a play function waits for real rendering; on a loaded CI machine 15 s is not always
                // enough for the first story of a file.
                testTimeout: 60_000
            }
        }))
    }
});
