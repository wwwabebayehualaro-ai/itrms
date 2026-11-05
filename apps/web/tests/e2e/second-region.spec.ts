/**
 * The second demo region (task 0.25b): a city administration with sub-cities, with no code of its own. Its people see its
 * levels and units, its name, and Afaan Oromo as a language it turned on, partly translated and falling back to Amharic.
 * The isolation between the two regions, and its name on a printed document, are in the API's demo.int.spec.ts.
 */
import { expect, test } from '@playwright/test';

import { api } from './forms/support';
import { firstSignIn, resetAccount } from './keycloak';

const CITY_ADMIN = { id: '0199f0a0-d000-7000-8000-000000000501', username: 'demo.city.admin' };
const CITY_RECORDS = { id: '0199f0a0-d000-7000-8000-000000000502', username: 'demo.city.records' };

test('a city administration has its own levels, units, branding and language', async ({ browser }) => {
    test.setTimeout(300_000);
    await resetAccount(CITY_ADMIN.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, CITY_ADMIN.username);
    const admin = api(page);
    // a second attempt on this database starts where the first left it
    await admin.patch('v1/me/preferences', { language: 'am' }, 0);
    await page.context().addCookies([{ name: 'itrms_lang', value: 'am', url: new URL(page.url()).origin }]);
    await page.reload();

    // its own name and tree: sub-cities, and none of the first region's zone and woredas
    const switcher = page.locator('[data-app-topbar] [data-active-unit]');
    await expect(switcher).toHaveAttribute('data-active-unit', 'SCA');
    await expect(switcher).toContainText('ናሙና ከተማ አስተዳደር');
    const { activeUnit } = await admin.get<{ activeUnit: { id: string } }>('v1/me/workspace');
    const subtree = await admin.get<{ code: string; level: { name: { en: string } } }[]>(
        `v1/org-units/${activeUnit.id}/subtree`
    );
    const units = subtree.map((u) => u.code);
    expect(units).toEqual(expect.arrayContaining(['SCA', 'SCA-NORTH', 'SCA-SOUTH', 'SCA-NORTH-D1']));
    expect(units.filter((code) => !code.startsWith('SCA'))).toEqual([]);

    // its own levels, and its own name at the top of the menu
    expect(subtree.find((u) => u.code === 'SCA')?.level.name.en).toBe('City administration');
    expect(subtree.find((u) => u.code === 'SCA-NORTH')?.level.name.en).toBe('Sub-city');
    await expect(page.locator('[data-app-brand]')).toHaveText('ናሙና የከተማ ትራንስፖርት ባለሥልጣን');

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

    // another PC: no language cookie, and the server's preference brings it back
    await page.keyboard.press('Escape');
    await page.context().clearCookies({ name: 'itrms_lang' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'om');

    // this browser last showed a language the region doesn't offer, and the person has saved none: it is put right
    await resetAccount(CITY_RECORDS.id);
    const records = await (await browser.newContext()).newPage();
    await firstSignIn(records, CITY_RECORDS.username);
    await records.context().addCookies([{ name: 'itrms_lang', value: 'wal-Latn', url: new URL(records.url()).origin }]);
    await records.reload();
    await expect(records.locator('html')).toHaveAttribute('lang', 'am');
});
