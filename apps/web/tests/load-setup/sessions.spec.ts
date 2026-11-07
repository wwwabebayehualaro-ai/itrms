/**
 * The smoke load test's sessions (task 0.26c2): demo officers signed in as a person would be, through the BFF and Keycloak,
 * their session and CSRF cookies written to tests/load/.sessions.json (never committed) for k6. The load then runs the real
 * path: the browser's request to the BFF, the session, the token, the API, RLS.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { BODITI, person } from '../e2e/competency/support';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'load', '.sessions.json');

test('signs the load test’s officers in and keeps their sessions', async ({ browser }) => {
    const sessions = [];
    for (const who of [BODITI.officer, BODITI.records, BODITI.lead]) {
        const page = await person(browser, who);
        const cookies = await page.context().cookies();
        const sid = cookies.find((c) => c.name === '__Host-itrms_sid')?.value;
        const csrf = cookies.find((c) => c.name === '__Host-itrms_csrf')?.value;
        expect(sid, `${who.username}'s session`).toBeTruthy();
        expect(csrf, `${who.username}'s CSRF token`).toBeTruthy();
        // what the session may do, as the page asks for it: the load runs as these people
        const workspace = await page.request.get('/api/v1/me/workspace');
        expect(workspace.ok()).toBe(true);
        sessions.push({ username: who.username, sid, csrf });
    }
    writeFileSync(
        OUT,
        JSON.stringify({ base: new URL(test.info().project.use.baseURL ?? 'http://localhost:3000').origin, sessions })
    );
});
