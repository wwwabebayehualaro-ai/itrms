/**
 * The vehicle register (task 1.1b): a records officer of Damot Gale finds a vehicle Boditi handles, by its national plate
 * typed in Ethiopic letters and by the old regional plate it was exchanged for, and reads its owners and plates. It runs on
 * the demo's generated vehicles (`pnpm demo:reset`, modules/vehicles/seed/demo.ts).
 */
import { expect, test } from '@playwright/test';

import { firstSignIn, resetAccount } from './keycloak';

const RECORDS = { id: '0199f0a0-d000-7000-8000-000000000202', username: 'demo.damot.records' };
// the demo's story vehicle (STORY_PLATE in the seed): a Boditi minibus, sold to an association, its old plate exchanged
const PLATE = 'ETH BOD 1001';

test('a Damot Gale officer finds a Boditi vehicle by its plate and reads its owners', async ({ page }) => {
    await resetAccount(RECORDS.id);
    await firstSignIn(page, RECORDS.username);

    await page.locator('[data-app-sidebar] [data-menu-item="vehicles.vehicles"]').click();
    await expect(page.getByRole('heading', { name: 'የተሽከርካሪ መዝገብ' })).toBeVisible();

    // the national plate, typed with its Ethiopic prefix and without spaces
    const search = page.locator('[data-screen="vehicles-search"] form[role="search"]');
    await search.locator('#vehicle-search').fill('ኢትBOD1001');
    await search.getByRole('button', { name: 'ፈልግ' }).click();
    await expect(page).toHaveURL(/\/registry\/vehicles\?q=/);
    const results = page.locator('[data-results]');
    await expect(results.getByRole('link', { name: PLATE })).toBeVisible();
    await expect(results).toContainText('ቦዲቲ');

    // the old regional plate finds it too
    await search.locator('#vehicle-search').fill('ደቡ 3-04512');
    await search.getByRole('button', { name: 'ፈልግ' }).click();
    await expect(results.getByRole('link', { name: PLATE })).toBeVisible();
    await expect(results.locator('[data-matched="old_plate"]')).toBeVisible();

    // the record: two ownership periods, the open one the association's; the old plate exchanged
    await results.getByRole('link', { name: PLATE }).click();
    await expect(page.locator('[data-screen="vehicle-record"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: PLATE })).toBeVisible();
    const owners = page.locator('[data-ownerships] [data-ownership]');
    await expect(owners).toHaveCount(2);
    await expect(page.locator('[data-ownership][data-open="true"]')).toContainText('ናሙና የሕዝብ ትራንስፖርት ማህበር');
    await page.getByRole('tab', { name: 'ሰሌዳዎች' }).click();
    await expect(page.locator('[data-plates] [data-plate]')).toHaveCount(2);
    await expect(page.locator('[data-plates]')).toContainText('የተለወጠ');
});
