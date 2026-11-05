/**
 * The second demo region (task 0.25b): a city administration with sub-cities, with no code of its own. Its people see its
 * levels and units and its name, and Afaan Oromo as a language it turned on, partly translated and falling back to Amharic.
 * The isolation between the two regions, and the printed branding, are in the API's demo.int.spec.ts.
 */
import { expect, test } from '@playwright/test';

import { api } from './forms/support';
import { firstSignIn, resetAccount } from './keycloak';

const CITY_ADMIN = { id: '0199f0a0-d000-7000-8000-000000000501', username: 'demo.city.admin' };

test('a city administration has its own units, name and language', async ({ browser }) => {
    test.setTimeout(300_000);
    await resetAccount(CITY_ADMIN.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, CITY_ADMIN.username);
    const admin = api(page);

    // its own name and tree: sub-cities, and none of the first region's zone and woredas
    const switcher = page.locator('[data-app-topbar] [data-active-unit]');
    await expect(switcher).toHaveAttribute('data-active-unit', 'SCA');
    await expect(switcher).toContainText('ናሙና ከተማ አስተዳደር');
    const { activeUnit } = await admin.get<{ activeUnit: { id: string } }>('v1/me/workspace');
    const subtree = await admin.get<{ code: string }[]>(`v1/org-units/${activeUnit.id}/subtree`);
    const units = subtree.map((u) => u.code);
    expect(units).toEqual(expect.arrayContaining(['SCA', 'SCA-NORTH', 'SCA-SOUTH', 'SCA-NORTH-D1']));
    expect(units.filter((code) => !code.startsWith('SCA'))).toEqual([]);

    // the languages this region turned on, and no others
    const sidebar = page.locator('[data-app-sidebar]');
    await page.locator('[data-user-menu]').click();
    await page.getByRole('menuitem', { name: 'ቋንቋ' }).click();
    const languages = page.getByRole('menuitemradio');
    await expect(languages).toHaveText(['አማርኛ', 'English', 'Afaan Oromoo']);
    await page.getByRole('menuitemradio', { name: 'Afaan Oromoo' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'om');

    // the words translated so far, and Amharic for the rest
    await expect(sidebar.getByRole('link', { name: 'መነሻ' })).toBeVisible();
    await page.locator('[data-user-menu]').click();
    await expect(page.getByRole('menuitem', { name: 'Afaan', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: "Ba'i" })).toBeVisible();

    // it stays after a reload, from the person's saved preference
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'om');
});
