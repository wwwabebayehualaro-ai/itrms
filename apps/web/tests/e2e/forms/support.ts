/**
 * Helpers of the form engine's journeys (task 0.16f): the demo accounts they act as, a signed-in page per account (the
 * BFF sign-in, a reset second factor), and the forms API through that page's session (the BFF's proxy, with its CSRF
 * header, an Idempotency-Key on every POST and If-Match on a change), for the setup a journey does not show.
 */
import { randomUUID } from 'node:crypto';

import { expect, type Browser, type Page } from '@playwright/test';

import { firstSignIn, resetAccount } from '../keycloak';

/** Demo accounts of apps/api/seed/users/wolaita.demo.yaml (generated people, never real ones). */
export const PEOPLE = {
    /** Wolaita Zone: writes forms and asks for them to be published (unit_admin) */
    author: { id: '0199f0a0-d000-7000-8000-000000000102', username: 'demo.zone.admin', name: 'Zone Admin' },
    /** Wolaita Zone: approves publications, reads the zone's requests (unit_head) */
    approver: { id: '0199f0a0-d000-7000-8000-000000000101', username: 'demo.zone.head', name: 'Zone Head' },
    /** Damot Gale woreda, below the zone: fills forms in and reads its office's requests (records_officer) */
    filler: { id: '0199f0a0-d000-7000-8000-000000000202', username: 'demo.damot.records', name: 'Damot Gale Records' }
} as const;

export type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

const CSRF_COOKIE = '__Host-itrms_csrf';

/** A browser of its own for one person, signed in through Keycloak (its second factor set up anew). */
export async function signedIn(browser: Browser, who: Person): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

export interface Api {
    get<T = any>(path: string): Promise<T>;
    post<T = any>(path: string, body?: unknown, version?: number): Promise<T>;
    patch<T = any>(path: string, body: unknown, version: number): Promise<T>;
    delete(path: string, version: number): Promise<unknown>;
}

/** The forms API as the page's person (`path` without `/api/`, e.g. `v1/forms`). */
export function api(page: Page): Api {
    const call = async (method: string, path: string, body?: unknown, version?: number) => {
        const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE)?.value ?? '';
        const res = await page.request.fetch(`/api/${path}`, {
            method,
            data: body,
            headers: {
                // the BFF takes a change only from its own origin, with the session's CSRF token (SEC-SE-6)
                ...(method === 'GET' ? {} : { 'x-csrf-token': csrf, origin: new URL(page.url()).origin }),
                ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
                ...(version === undefined ? {} : { 'if-match': `"${version}"` })
            }
        });
        expect(res.ok(), `${method} /api/${path}: ${res.status()} ${await res.text()}`).toBe(true);
        return res.status() === 204 ? undefined : res.json();
    };
    return {
        get: (path) => call('GET', path),
        post: (path, body = {}, version) => call('POST', path, body, version),
        patch: (path, body, version) => call('PATCH', path, body, version),
        delete: (path, version) => call('DELETE', path, undefined, version)
    };
}

/** A unique, readable name per run: the journeys repeat on the same database. */
export const runName = (what: string) => `${what} ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

const keyOf = (name: string) =>
    `e2e-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')}-${randomUUID().slice(0, 6)}`;

/**
 * A form written by the author and published with the approver's approval (the maker-checker rule): what a journey
 * that is not about publishing starts from. Returns its id.
 */
export async function publishedForm(author: Api, approver: Api, name: string, fields: unknown[]): Promise<string> {
    const form = await author.post<{ id: string }>('v1/forms', {
        key: keyOf(name),
        name: { am: name, en: name },
        document: { schemaVersion: 2, fields }
    });
    const asked = await author.post<{ id: string; version: number }>(`v1/forms/${form.id}/publications`);
    await approver.post(`v1/form-publications/${asked.id}/approval`, {}, asked.version);
    return form.id;
}

/** Switches a journey's form off (a form is never deleted: its submissions keep naming it). */
export async function switchOff(author: Api, formId: string): Promise<void> {
    const form = await author.get<{ version: number; active: boolean }>(`v1/forms/${formId}`);
    if (form.active) await author.patch(`v1/forms/${formId}`, { active: false }, form.version);
}

/** A field of the engine's document (the shape the builder stores). */
export const field = (type: string, id: string, label: string, extra: Record<string, unknown> = {}) => {
    const container = type === 'FormArray' || type === 'Panel';
    return {
        id,
        type,
        label,
        category: container ? 'Layout' : 'Input',
        props: {},
        data: { defaultProps: {} },
        behavior: { validation: { supported: true } },
        layout: { options: { isContainer: container } },
        ...extra
    };
};
