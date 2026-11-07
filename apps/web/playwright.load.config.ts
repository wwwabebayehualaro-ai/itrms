// The smoke load test's sign-in (task 0.26c2): the e2e configuration, with only tests/load-setup. It signs the demo officers in
// through the BFF and Keycloak (a new second factor each) and leaves their sessions for k6 (tests/load/smoke.js).
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

export default defineConfig({ ...base, testDir: 'tests/load-setup', testIgnore: [], retries: 0 });
