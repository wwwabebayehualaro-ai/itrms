// The verifier's flight-mode journeys: `pnpm --filter @itrms/verify build`, then `pnpm --filter @itrms/verify e2e`. The tests serve the
// built app themselves and need no development stack.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    expect: { timeout: 20_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        timezoneId: 'Africa/Addis_Ababa',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }]
});
