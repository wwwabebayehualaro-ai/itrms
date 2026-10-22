/**
 * Test helpers for the BFF journeys: the local stack's settings (infra/compose/.env, written by `pnpm dev:infra`; never in
 * the repository), Keycloak's admin API to put a demo account in a known state, and TOTP codes (RFC 6238) the way an
 * authenticator app makes them.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

function stackEnv(): Record<string, string> {
    const text = readFileSync(join(ROOT, 'infra', 'compose', '.env'), 'utf8');
    return Object.fromEntries(
        text
            .split(/\r?\n/)
            .filter((l) => /^[A-Z0-9_]+=/.test(l))
            .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    );
}

const env = stackEnv();
export const KEYCLOAK = `http://localhost:${env.KEYCLOAK_HOST_PORT ?? '18080'}`;
export const DEMO_PASSWORD = env.DEV_USER_PASSWORD ?? '';

async function adminToken(): Promise<string> {
    const res = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'password',
            client_id: 'admin-cli',
            username: 'admin',
            password: env.KEYCLOAK_ADMIN_PASSWORD ?? ''
        })
    });
    if (!res.ok) throw new Error(`Keycloak admin sign-in: ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
}

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${KEYCLOAK}/admin/realms/itrms${path}`, {
        method,
        headers: {
            authorization: `Bearer ${await adminToken()}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Keycloak ${method} ${path}: ${res.status} ${await res.text()}`);
    return res;
}

/** The account as new: no second factor yet (TOTP set-up at the next sign-in), no session. Its password is the seed's. */
export async function resetAccount(id: string): Promise<void> {
    const credentials = (await (await admin('GET', `/users/${id}/credentials`)).json()) as {
        id: string;
        type: string;
    }[];
    for (const c of credentials.filter((c) => c.type !== 'password'))
        await admin('DELETE', `/users/${id}/credentials/${c.id}`);
    // the whole account: Keycloak checks the user profile on every update
    const account = (await (await admin('GET', `/users/${id}`)).json()) as Record<string, unknown>;
    const firstName = String(account.firstName ?? '').replace(/\s*\(demo\)\s*$/, '');
    await admin('PUT', `/users/${id}`, {
        ...account,
        firstName,
        lastName: 'Demo',
        requiredActions: ['CONFIGURE_TOTP']
    });
    await admin('POST', `/users/${id}/logout`);
}

/** Ends every Keycloak session of the account, as an administrator would (back-channel logout follows). */
export const endKeycloakSessions = (id: string) => admin('POST', `/users/${id}/logout`).then(() => undefined);

export const keycloakSessions = async (id: string) =>
    (await (await admin('GET', `/users/${id}/sessions`)).json()) as { id: string }[];

function base32(text: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of text.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
    return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

/** The 6-digit TOTP code of `secret` (base32) for the 30-second step `offset` steps from now. */
export function totp(secret: string, offset = 0): string {
    const counter = Math.floor(Date.now() / 1000 / 30) + offset;
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac('sha1', base32(secret)).update(message).digest();
    const at = (hmac[hmac.length - 1] ?? 0) & 0x0f;
    return String((hmac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Milliseconds until the next 30-second TOTP step begins (Keycloak refuses a code used twice). */
export const untilNextStep = () => 30_000 - (Date.now() % 30_000) + 500;

/** Signs a reset account in at Keycloak through the app, setting up its TOTP; returns the TOTP secret. */
export async function firstSignIn(page: Page, username: string): Promise<string> {
    await page.goto('/');
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.locator('#kc-login').click();
    await page.locator('#mode-manual').click();
    const secret = (await page.locator('#kc-totp-secret-key').innerText()).replace(/\s/g, '');
    await page.locator('#totp').fill(totp(secret));
    await page.locator('#saveTOTPBtn').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/realms/'));
    return secret;
}
