/**
 * The BFF sign-in (task 0.10a, ADR-0021, security.md §4–§5, §8): a person signs in with a password and a second factor,
 * acts in their unit only, and their tokens never reach the browser; sign-out ends the Keycloak session; back-channel
 * logout ends the BFF session.
 */
import { expect, test, type Page } from '@playwright/test';

import { DEMO_PASSWORD, endKeycloakSessions, keycloakSessions, resetAccount, totp, untilNextStep } from './keycloak';

const APP = process.env.E2E_WEB || 'http://localhost:3000';
// cashier at Boditi and records officer at the zone (apps/api/seed/users/wolaita.demo.yaml)
const DUAL = { id: '0199f0a0-d000-7000-8000-000000000401', username: 'demo.dual' };
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./;
const SIGN_IN_PAGE = /\/realms\/itrms\/(protocol\/openid-connect\/auth|login-actions\/)/;

test.describe.configure({ mode: 'serial' });

let secret = '';

/** Records every response from the app whose headers or body hold something shaped like a JWT. */
function watchForTokens(page: Page): string[] {
    const leaks: string[] = [];
    page.on('response', async (response) => {
        if (!response.url().startsWith(APP)) return;
        let body = '';
        try {
            body = (await response.body()).toString('utf8');
        } catch {
            // a redirect has no body
        }
        if (JWT.test(JSON.stringify(await response.allHeaders())) || JWT.test(body)) leaks.push(response.url());
    });
    return leaks;
}

function watchForCspViolations(page: Page): string[] {
    const violations: string[] = [];
    page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text()) && !/report-only/i.test(message.text()))
            violations.push(message.text());
    });
    return violations;
}

async function enterPassword(page: Page) {
    await expect(page).toHaveURL(SIGN_IN_PAGE);
    await page.locator('#username').fill(DUAL.username);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.locator('#kc-login').click();
}

const cookie = async (page: Page, name: string) => (await page.context().cookies(APP)).find((c) => c.name === name);

async function call(page: Page, method: string, path: string, body?: object, csrf?: string) {
    return page.evaluate(
        async ({ method, path, body, csrf }) => {
            const response = await fetch(path, {
                method,
                headers: {
                    ...(body ? { 'content-type': 'application/json' } : {}),
                    ...(csrf ? { 'x-csrf-token': csrf } : {})
                },
                body: body ? JSON.stringify(body) : undefined
            });
            const text = await response.text();
            return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
        },
        { method, path, body, csrf }
    );
}

test('signs in with a password and a new TOTP, acts in its unit only, and never sees a token', async ({ page }) => {
    await resetAccount(DUAL.id);
    const leaks = watchForTokens(page);
    const violations = watchForCspViolations(page);

    // no session: the page sends the browser to Keycloak through the BFF
    await page.goto('/');
    await enterPassword(page);
    // a new account sets up its authenticator app (TOTP is required, SEC-ID-1)
    await page.locator('#mode-manual').click();
    secret = (await page.locator('#kc-totp-secret-key').innerText()).replace(/\s/g, '');
    await page.locator('#totp').fill(totp(secret));
    await page.locator('#saveTOTPBtn').click();
    await page.waitForURL((url) => url.href.startsWith(APP));

    // the session is an opaque HttpOnly cookie; the page can read neither it nor any token (SEC-SE-1, SEC-WB-3)
    const sid = await cookie(page, '__Host-itrms_sid');
    expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(sid?.value).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await page.evaluate(() => document.cookie)).not.toContain('itrms_sid');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(JWT);

    // the security headers, and Next's scripts carry the nonce (SEC-WB-1)
    const home = await page.goto('/');
    const headers = home?.headers() ?? {};
    expect(headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"])
        expect(headers['content-security-policy']).toContain(directive);
    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(await page.locator('script[nonce]').count()).toBeGreaterThan(0);

    // the API through the BFF: who they are, where they may act
    const workspace = await call(page, 'GET', '/api/v1/me/workspace');
    expect(workspace.status).toBe(200);
    const units = workspace.body?.units as { id: string; code: string }[];
    expect(units.map((u) => u.code).sort()).toEqual(['WOL', 'WOL-BODITI']);
    const boditi = units.find((u) => u.code === 'WOL-BODITI');

    // switching the unit is a state change: CSRF token and Origin required (SEC-SE-6); a new session id after (SEC-SE-3)
    const csrf = (await cookie(page, '__Host-itrms_csrf'))?.value ?? '';
    expect((await call(page, 'POST', '/auth/unit', { unitId: boditi?.id })).status).toBe(403);
    const switched = await call(page, 'POST', '/auth/unit', { unitId: boditi?.id }, csrf);
    expect(switched.status).toBe(200);
    expect(switched.body?.roles).toEqual(['cashier']);
    expect((await cookie(page, '__Host-itrms_sid'))?.value).not.toBe(sid?.value);
    const inBoditi = await call(page, 'GET', '/api/v1/me/workspace');
    expect(inBoditi.body?.activeUnit).toMatchObject({ code: 'WOL-BODITI' });
    expect(inBoditi.body?.permissions).not.toContain('role-assignment:read');

    // a unit they hold no role in: refused, and the session keeps its unit
    const csrfNow = (await cookie(page, '__Host-itrms_csrf'))?.value ?? '';
    const elsewhere = await call(
        page,
        'POST',
        '/auth/unit',
        { unitId: '0199f0a0-0000-7000-8000-00000000dead' },
        csrfNow
    );
    expect(elsewhere.status).toBe(403);
    expect((await call(page, 'GET', '/api/v1/me/workspace')).body?.activeUnit).toMatchObject({ code: 'WOL-BODITI' });

    // sign-out ends the BFF session and the Keycloak session (SEC-SE-4)
    await page.locator('[data-user-menu]').click();
    await page.locator('[data-sign-out]').click();
    await expect(page).toHaveURL(SIGN_IN_PAGE);
    expect(await keycloakSessions(DUAL.id)).toEqual([]);
    expect(await cookie(page, '__Host-itrms_sid')).toBeUndefined();
    expect((await page.request.get(`${APP}/api/v1/me/workspace`)).status()).toBe(401);

    expect(leaks).toEqual([]);
    expect(violations).toEqual([]);
});

test('asks for the second factor at every sign-in; back-channel logout ends the session', async ({ page }) => {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- the TOTP secret Keycloak generated in this run, not a constant
    test.skip(!secret, 'needs the TOTP set up by the previous journey');
    // Keycloak refuses a code used twice: wait for the next 30-second step
    await page.waitForTimeout(untilNextStep());
    await page.goto('/');
    await enterPassword(page);
    await page.locator('#otp').fill(totp(secret));
    await page.locator('#kc-login').click();
    await page.waitForURL((url) => url.href.startsWith(APP));
    expect((await page.request.get(`${APP}/api/v1/me/workspace`)).status()).toBe(200);

    // an administrator ends the person's Keycloak sessions: Keycloak tells the BFF, which ends its session too
    await endKeycloakSessions(DUAL.id);
    await expect
        .poll(async () => (await page.request.get(`${APP}/api/v1/me/workspace`)).status(), { timeout: 15_000 })
        .toBe(401);
});
