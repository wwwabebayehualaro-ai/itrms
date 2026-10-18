// Browser end-to-end tests: `npm run e2e`. Needs the backend running (E2E_API, default http://localhost:8000) with the demo data
// (scripts/e2e/demo/README.md). Starts its own Next dev server on :3100 with a separate dist dir so it never disturbs a developer's
// server on :3000; set E2E_WEB to test an already running app instead.
import { defineConfig, devices } from '@playwright/test';

const WEB = process.env.E2E_WEB || 'http://localhost:3100';
const API = process.env.E2E_API || 'http://localhost:8000';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 120_000,
    // a cold dev server compiles each page on first visit
    expect: { timeout: 60_000 },
    // one worker: specs share the backend's state (flags, demo data) and log in as the same users
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: process.env.E2E_WEB
        ? undefined
        : {
              command: 'npx next dev -p 3100',
              url: WEB,
              timeout: 240_000,
              reuseExistingServer: true,
              env: { NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_BACKEND_API: API }
          }
});
