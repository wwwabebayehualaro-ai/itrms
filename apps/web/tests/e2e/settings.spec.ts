/**
 * Settings down the tree (task 0.21a, ADR-0026): the zone's administrator opens the settings from the menu, sees where
 * the density comes from, sets the zone's own; an office below it (Damot Gale) shows it; a person there chooses their
 * own, which follows them to another PC; the administrator resets the zone's value. Each run cleans up what it set, so
 * the journey repeats on the same database.
 */
import { expect, test, type Page } from '@playwright/test';

import { PEOPLE, signedIn } from './workflow/support';

/** The BFF's CSRF cookie (apps/web/src/lib/auth/cookies.ts). */
const CSRF_COOKIE = '__Host-itrms_csrf';

/** A change through the BFF as the page's person, as the app sends it. */
async function send(page: Page, method: 'PUT' | 'DELETE', path: string, body?: unknown, version?: number) {
    const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE)?.value ?? '';
    const res = await page.request.fetch(`/api/${path}`, {
        method,
        data: body,
        headers: {
            'x-csrf-token': csrf,
            origin: new URL(page.url()).origin,
            ...(version === undefined ? {} : { 'if-match': `"${version}"` })
        }
    });
    expect(res.ok(), `${method} /api/${path}: ${res.status()}`).toBe(true);
}

interface Setting {
    key: string;
    own: { version: number } | null;
}

/** The zone's own density left from an earlier run, reset. */
async function resetZoneDensity(page: Page, zoneId: string) {
    const res = await page.request.get(`/api/v1/org-units/${zoneId}/settings`);
    const own = ((await res.json()) as { settings: Setting[] }).settings.find((s) => s.key === 'ui.density')?.own;
    if (own) await send(page, 'DELETE', `v1/org-units/${zoneId}/settings/ui.density`, undefined, own.version);
}

const workspaceOf = async (page: Page) =>
    (await (await page.request.get('/api/v1/me/workspace')).json()) as {
        activeUnit: { id: string };
        settings: Record<string, unknown>;
    };

test("sets a zone's value, which its offices follow; a person's own choice follows them; reset", async ({
    browser
}) => {
    test.setTimeout(300_000);
    const admin = await signedIn(browser, PEOPLE.author);
    const zoneId = (await workspaceOf(admin)).activeUnit.id;
    await resetZoneDensity(admin, zoneId);
    const head = await signedIn(browser, PEOPLE.head);
    await send(head, 'DELETE', 'v1/me/settings/ui.density');

    // from the menu: every setting of the zone, with where it comes from
    await admin.locator('[data-app-sidebar] [data-menu-item="kernel.settings"]').click();
    await expect(admin.getByRole('heading', { name: 'ቅንብሮች' })).toBeVisible();
    const density = admin.locator('[data-setting="ui.density"]');
    await expect(density.locator('[data-source]')).not.toHaveText('ይህ ጽ/ቤት');
    // the region's languages are shown to the zone, not changed by it
    await expect(admin.locator('[data-setting="i18n.languages"]').getByRole('button', { name: 'ቀይር' })).toHaveCount(0);

    // the zone's own value
    await density.getByRole('button', { name: 'ቀይር' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'ዋጋ' }).click();
    await admin.getByRole('option', { name: 'የታመቀ' }).click();
    await dialog.getByRole('button', { name: 'አስቀምጥ' }).click();
    await expect(density.locator('[data-source]')).toHaveText('ይህ ጽ/ቤት');
    await expect(density.locator('[data-value]')).toHaveText('የታመቀ');

    // Damot Gale, below the zone, follows it
    await head.reload();
    await expect(head.locator('html')).toHaveAttribute('data-density', 'compact');

    // the head chooses their own; another PC (a new browser) shows it after sign-in
    await head.getByRole('button', { name: 'ገጽታ' }).click();
    await head.getByRole('menuitemradio', { name: 'ሰፊ' }).click();
    await expect(head.locator('html')).toHaveAttribute('data-density', 'comfortable');
    await expect.poll(async () => (await workspaceOf(head)).settings['ui.density']).toBe('comfortable');
    const otherPc = await signedIn(browser, PEOPLE.head);
    await expect(otherPc.locator('html')).toHaveAttribute('data-density', 'comfortable');
    await send(otherPc, 'DELETE', 'v1/me/settings/ui.density');

    // the zone resets its value: it inherits again
    await density.getByRole('button', { name: 'ወደ ነበረበት መልስ' }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'ወደ ነበረበት መልስ' }).click();
    await expect(density.locator('[data-source]')).not.toHaveText('ይህ ጽ/ቤት');
});
