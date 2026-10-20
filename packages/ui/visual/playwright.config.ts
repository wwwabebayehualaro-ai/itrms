// Visual regression over every story (task 0.4a): Amharic and English, light theme, comfortable density. Baselines are
// made and compared only in the pinned Linux Playwright image (`pnpm ui:visual`, and the `stories` CI job), with the
// bundled Noto fonts, so a screenshot means the same thing on every machine. Other themes and densities are covered by
// axe and the contrast tests, not screenshots.
import { defineConfig } from '@playwright/test';

const PORT = 6007;

export default defineConfig({
    testDir: '.',
    testMatch: '*.visual.ts',
    snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
    fullyParallel: true,
    workers: 4,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        timezoneId: 'Africa/Addis_Ababa'
    },
    expect: {
        // An absolute budget, not a ratio: on a mostly blank 1024×768 page a ratio of 0.2 % lets a recoloured border or
        // badge (700–1,300 px) through. The image, fonts and scale are pinned, so a few antialiased pixels is all the
        // noise there is.
        toHaveScreenshot: { maxDiffPixels: 25, animations: 'disabled', caret: 'hide' }
    },
    projects: [{ name: 'am' }, { name: 'en' }],
    webServer: {
        command: `node serve.mjs`,
        cwd: import.meta.dirname,
        url: `http://127.0.0.1:${PORT}/index.json`,
        env: { PORT: String(PORT) },
        reuseExistingServer: false
    }
});
