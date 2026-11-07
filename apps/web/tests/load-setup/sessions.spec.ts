/**
 * The smoke load test's sessions (task 0.26c2): demo officers signed in as a person would be, through the BFF and Keycloak,
 * their session and CSRF cookies written to tests/load/.sessions.json (never committed) for k6. The load then runs the real
 * path: the browser's request to the BFF, the session, the token, the API, RLS. Each session says what its person may do
 * here (the inbox; the query API on FORM_ID), so that k6 asks each only for what their roles allow.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { BODITI, person } from '../e2e/competency/support';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'load', '.sessions.json');
const FORM_ID = process.env.FORM_ID ?? '';

test('signs the load test’s officers in and keeps their sessions', async ({ browser }) => {
    expect(FORM_ID, 'FORM_ID: the form the query API is asked about').toMatch(/^[0-9a-f-]{36}$/);
    const sessions = [];
    for (const who of [BODITI.officer, BODITI.records, BODITI.lead]) {
        const page = await person(browser, who);
        const cookies = await page.context().cookies();
        const sid = cookies.find((c) => c.name === '__Host-itrms_sid')?.value;
        const csrf = cookies.find((c) => c.name === '__Host-itrms_csrf')?.value;
        expect(sid, `${who.username}'s session`).toBeTruthy();
        expect(csrf, `${who.username}'s CSRF token`).toBeTruthy();
        const inbox = (await page.request.get('/api/v1/me/tasks?limit=1')).ok();
        const query = (
            await page.request.post('/api/v1/submissions/query', {
                data: { formId: FORM_ID, page: 1, pageSize: 1 },
                // as the browser sends them: the BFF checks the Origin and the CSRF token of a state-changing call
                headers: {
                    origin: new URL(page.url()).origin,
                    'x-csrf-token': csrf ?? '',
                    'idempotency-key': randomUUID()
                }
            })
        ).ok();
        sessions.push({ username: who.username, sid, csrf, inbox, query });
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
    writeFileSync(
        OUT,
        JSON.stringify({ base: new URL(test.info().project.use.baseURL ?? 'http://localhost:3000').origin, sessions })
    );
});
