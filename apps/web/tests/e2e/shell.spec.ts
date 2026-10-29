/**
 * The application shell (task 0.10b, ADR-0028): the menu is the one the API computes for the unit the person acts for, and
 * switching the unit changes the menu and the data scope. `demo.multi` is a competency officer at the zone (which offers
 * the licensing services) and a records officer at Damot Gale (a woreda that offers none).
 */
import { expect, test, type Page } from '@playwright/test';

import { firstSignIn, resetAccount } from './keycloak';

const MULTI = { id: '0199f0a0-d000-7000-8000-000000000402', username: 'demo.multi' };

const menuItems = (page: Page) =>
    page
        .locator('[data-app-sidebar] [data-menu-item]')
        .evaluateAll((links) => links.map((l) => l.getAttribute('data-menu-item')));

test('switching the unit changes the menu and the data scope', async ({ page }) => {
    await resetAccount(MULTI.id);
    await firstSignIn(page, MULTI.username);

    // the zone, where licensing is offered and the person is a competency officer
    const topbar = page.locator('[data-app-topbar]');
    await expect(topbar.locator('[data-active-unit]')).toHaveAttribute('data-active-unit', 'WOL');
    await expect(page.locator('[data-app-sidebar] [data-menu-item="competency.applications"]')).toBeVisible();
    expect(await menuItems(page)).toContain('competency.applications');
    const zone = await page.evaluate(
        async () => (await (await fetch('/api/v1/me/workspace')).json()) as { activeUnit: { id: string } }
    );

    // the command palette offers the same pages and actions (Ctrl+K)
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await expect(palette.getByRole('option', { name: /የመንጃ ፈቃድ ማመልከቻዎች/ })).toBeVisible();
    await expect(palette.getByRole('option', { name: /አዲስ የመንጃ ፈቃድ ማመልከቻ/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // to Damot Gale: no licensing items, and the zone's records are out of scope
    await topbar.locator('[data-active-unit]').click();
    await page.locator('[data-unit="WOL-DAMOT-GALE"]').click();
    await expect(topbar.locator('[data-active-unit]')).toHaveAttribute('data-active-unit', 'WOL-DAMOT-GALE');
    await expect(page.locator('[data-app-sidebar] [data-menu-item="competency.applications"]')).toHaveCount(0);
    // no licensing items; the records officer's requests and tasks; the register of people and organisations is read
    // from every office
    expect(await menuItems(page)).toEqual([
        'kernel.home',
        'services.request',
        'workflow.inbox',
        'parties.persons',
        'parties.organisations'
    ]);
    const scoped = await page.evaluate(async (zoneId) => {
        const workspace = (await (await fetch('/api/v1/me/workspace')).json()) as { activeUnit: { code: string } };
        const zoneRecord = await fetch(`/api/v1/org-units/${zoneId}`);
        return { unit: workspace.activeUnit.code, zoneStatus: zoneRecord.status };
    }, zone.activeUnit.id);
    expect(scoped).toEqual({ unit: 'WOL-DAMOT-GALE', zoneStatus: 404 });

    // and back
    await topbar.locator('[data-active-unit]').click();
    await page.locator('[data-unit="WOL"]').click();
    await expect(page.locator('[data-app-sidebar] [data-menu-item="competency.applications"]')).toBeVisible();
});
