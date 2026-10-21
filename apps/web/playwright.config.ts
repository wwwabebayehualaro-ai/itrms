// Browser end-to-end tests: `pnpm e2e`. Needs the development stack (`pnpm dev:infra`: Keycloak, Valkey, PostgreSQL) and
// the API built, migrated and seeded (tests/e2e/README.md). Starts the API (:4000) and the web app (:3000, the origin the
// realm's itrms-web client redirects to) unless they already run; set E2E_WEB to test an app running elsewhere.
import { defineConfig, devices } from '@playwright/test';

const WEB = process.env.E2E_WEB || 'http://localhost:3000';

export default defineConfig({
    testDir: 'tests/e2e',
    // the legacy engine journeys ran against the old backend's password sign-in (tests/e2e/legacy/README.md)
    testIgnore: ['legacy/**'],
    timeout: 120_000,
    // a cold dev server compiles each page on first visit
    expect: { timeout: 60_000 },
    // one worker: the journeys sign the same demo accounts in and out
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: process.env.E2E_WEB
        ? undefined
        : [
              {
                  command: 'pnpm --filter @itrms/api dev:start',
                  url: 'http://127.0.0.1:4000/healthz',
                  timeout: 120_000,
                  reuseExistingServer: true
              },
              {
                  command: 'npx next dev -p 3000',
                  url: `${WEB}/auth/error`,
                  timeout: 240_000,
                  reuseExistingServer: true
              }
          ]
});
