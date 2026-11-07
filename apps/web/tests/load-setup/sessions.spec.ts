/**
 * The smoke load test's sessions (task 0.26c2): demo officers signed in as a person would be, through the BFF and Keycloak,
 * their session and CSRF cookies written to tests/load/.sessions.json (never committed) for k6, with the form the query API
 * is asked about. The load then runs the real path: the browser's request to the BFF, the session, the token, the API, RLS.
 * Each session says what its person may do here (the inbox; the query API on that form), so that k6 asks each only for
 * what their roles allow.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { CSRF_COOKIE, SESSION_COOKIE } from '../../src/lib/auth/cookies';
import { BODITI, person } from '../e2e/competency/support';
import { api } from '../e2e/forms/support';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'load', '.sessions.json');
const FORM_ID = process.env.FORM_ID ?? '';

test('signs the load test’s officers in and keeps their sessions', async ({ browser, baseURL }) => {
    // three first sign-ins (a new second factor each) on a dev server that compiles each page on its first visit
    test.setTimeout(10 * 60_000);
    expect(FORM_ID, 'FORM_ID: the form the query API is asked about').toMatch(/^[0-9a-f-]{36}$/);
    const sessions = [];
    for (const who of [BODITI.officer, BODITI.records, BODITI.lead]) {
        const page = await person(browser, who);
        const cookies = await page.context().cookies();
        const sid = cookies.find((c) => c.name === SESSION_COOKIE)?.value;
        const csrf = cookies.find((c) => c.name === CSRF_COOKIE)?.value;
        expect(sid, `${who.username}'s session`).toBeTruthy();
        expect(csrf, `${who.username}'s CSRF token`).toBeTruthy();
        const inbox = (await api(page).status('GET', 'v1/me/tasks?limit=1')) === 200;
        const query =
            (await api(page).status('POST', 'v1/submissions/query', { formId: FORM_ID, page: 1, pageSize: 1 })) === 200;
        sessions.push({ username: who.username, sid, csrf, inbox, query });
        // the browser goes; the session stays in the BFF for k6 (closing a context signs nobody out)
        await page.context().close();
    }
    // somebody must be able to do each, or the load would measure refusals
    expect(
        sessions.some((s) => s.inbox),
        'an officer with the inbox'
    ).toBe(true);
    expect(
        sessions.some((s) => s.query),
        'an officer with the query API'
    ).toBe(true);
    // who loads what, in the run's report
    test.info().annotations.push({
        type: 'sessions',
        description: sessions.map((s) => `${s.username}: inbox ${s.inbox}, query ${s.query}`).join('; ')
    });
    // the app's origin (APP_ORIGIN): the BFF takes a change only with it as the Origin
    writeFileSync(
        OUT,
        JSON.stringify({ base: new URL(baseURL ?? 'http://localhost:3000').origin, formId: FORM_ID, sessions })
    );
});
