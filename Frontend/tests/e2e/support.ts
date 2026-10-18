import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';
export const ADMIN = process.env.E2E_ADMIN || 'admin@acme-corp.org';
export const SUBMITTER = process.env.E2E_SUBMITTER || 'priya.nair@acme-corp.org';

/** Log in through the real form (typed like a user: a value set before hydration is not seen by React). */
export async function login(page: Page, email = ADMIN, password = PASSWORD) {
    await page.goto('/auth/login', { waitUntil: 'networkidle' });
    await page.locator('#email1').pressSequentially(email, { delay: 5 });
    await page.locator('#password1').pressSequentially(password, { delay: 5 });
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'));
}

export const API = process.env.E2E_API || 'http://localhost:8000';

/** Authenticated calls to the backend for test setup (ids, flags), outside the browser. */
export async function apiAs(request: import('@playwright/test').APIRequestContext, email = ADMIN, password = PASSWORD) {
    const res = await request.post(`${API}/auth/login`, { data: { email, password } });
    expect(res.ok()).toBeTruthy();
    const { access_token } = await res.json();
    const headers = { Authorization: `Bearer ${access_token}` };
    return {
        get: async (path: string) => (await request.get(`${API}${path}`, { headers })).json(),
        post: (path: string, data?: unknown) => request.post(`${API}${path}`, { headers, data }),
        put: (path: string, data?: unknown) => request.put(`${API}${path}`, { headers, data }),
        delete: (path: string) => request.delete(`${API}${path}`, { headers })
    };
}

export async function templateId(api: Awaited<ReturnType<typeof apiAs>>, name: string): Promise<string> {
    const list: { id: string; name: string }[] = await api.get('/template/forms/templates?limit=500');
    const t = list.find((x) => x.name === name);
    expect(t, `template "${name}" (seed the demo data first)`).toBeTruthy();
    return t!.id;
}
