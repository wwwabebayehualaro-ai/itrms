/**
 * The plate stock (task 1.2a): the zone's plate keeper hands plates of its stock to Boditi, Boditi's plate keeper accepts
 * them, and each sees its counts reconcile with its ledger. It runs on the demo's stock (`pnpm demo:reset`,
 * modules/vehicles/seed/plate-stock.ts: the zone holds ETH QSA 0151-0300). A plate is picked at random so the journey can
 * run again on the same data.
 */
import { randomInt } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { firstSignIn, resetAccount } from './keycloak';

const ZONE_KEEPER = { id: '0199f0a0-d000-7000-8000-000000000110', username: 'demo.zone.plates' };
const BODITI_KEEPER = { id: '0199f0a0-d000-7000-8000-000000000306', username: 'demo.boditi.plates' };

async function openStock(page: Page) {
    await page.locator('[data-app-sidebar] [data-menu-item="vehicles.plateStock"]').click();
    await expect(page.locator('[data-screen="plate-stock"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'የሰሌዳ ክምችት' })).toBeVisible();
}

test('the zone hands plates to Boditi, Boditi accepts them, and both reconcile', async ({ browser }) => {
    const serial = 151 + randomInt(140);

    // the zone's keeper allocates two plates to Boditi
    const zone = await browser.newPage();
    await resetAccount(ZONE_KEEPER.id);
    await firstSignIn(zone, ZONE_KEEPER.username);
    await openStock(zone);
    await expect(zone.locator('[data-counts] [data-unit="WOL"] [data-reconciled]')).toHaveAttribute(
        'data-reconciled',
        'true'
    );
    await zone.getByRole('link', { name: 'ሰሌዳ ድልድል' }).click();
    await expect(zone.locator('[data-screen="plate-allocate"]')).toBeVisible();
    await zone.getByLabel('የሚከፋፈልለት ጽ/ቤት').click();
    await zone.getByRole('option', { name: /ቦዲቲ/ }).click();
    await zone.getByLabel('ተከታታይ').fill('QSA');
    await zone.getByLabel('የመጀመሪያ ቁጥር').fill(String(serial));
    await zone.getByLabel('የመጨረሻ ቁጥር').fill(String(serial + 1));
    await zone.getByRole('button', { name: 'ድልድል አድርግ' }).click();
    await openStock(zone);
    await expect(zone.locator('[data-counts] [data-unit="WOL"] [data-reconciled]')).toHaveAttribute(
        'data-reconciled',
        'true'
    );
    await expect(zone.locator('[data-counts] [data-unit="WOL-BODITI"] [data-reconciled]')).toHaveAttribute(
        'data-reconciled',
        'true'
    );
    await zone.close();

    // Boditi's keeper sees the plates waiting and accepts them
    const boditi = await browser.newPage();
    await resetAccount(BODITI_KEEPER.id);
    await firstSignIn(boditi, BODITI_KEEPER.username);
    await openStock(boditi);
    const waiting = boditi.locator('[data-waiting] [data-accept]').first();
    await expect(waiting).toBeVisible();
    await waiting.click();
    await expect(boditi.locator('[data-waiting] [data-accept]')).toHaveCount(0);
    await expect(boditi.locator('[data-counts] [data-unit="WOL-BODITI"] [data-reconciled]')).toHaveAttribute(
        'data-reconciled',
        'true'
    );
    await boditi.close();
});
