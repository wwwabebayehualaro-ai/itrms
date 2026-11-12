/**
 * Controlled stationery (task 1.12a): Boditi's store keeper receives a pad of receipt leaves from the regional bureau, sees
 * the office's counts reconcile with its ledger, and records the day's count with one leaf not on the table: the count is
 * flagged, and the missing serial is named. The series is generated; an office records one count a day per kind, so the
 * journey runs once a day on the same data (`pnpm demo:reset` starts afresh).
 */
import { randomInt } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { firstSignIn, resetAccount } from './keycloak';

const BODITI_KEEPER = { id: '0199f0a0-d000-7000-8000-000000000306', username: 'demo.boditi.plates' };

test("Boditi's keeper receives receipt leaves and the day's count flags the one missing", async ({ page }) => {
    test.setTimeout(240_000);
    // four letters: a series of its own each run
    const series = Array.from({ length: 4 }, () => String.fromCharCode(65 + randomInt(26))).join('');

    await resetAccount(BODITI_KEEPER.id);
    await firstSignIn(page, BODITI_KEEPER.username);
    await page.locator('[data-app-sidebar] [data-menu-item="fees.stationery"]').click();
    await expect(page.locator('[data-screen="stationery"]')).toBeVisible();
    await page.locator('[data-kinds] [data-kind="receipt_leaf"]').click();
    await expect(page.locator('[data-screen="stationery"]')).toHaveAttribute('data-kind', 'receipt_leaf');

    // the delivery: ten leaves of a new series, received today
    await page.getByRole('link', { name: 'ገቢ መዝግብ' }).click();
    const receive = page.locator('[data-screen="stationery-receive"]');
    await expect(receive).toBeVisible();
    await receive.getByLabel('የርክክብ ማስረጃ ቁጥር', { exact: true }).fill(`BUREAU-${series}`);
    await receive.getByRole('button', { name: /የደረሰበት ቀን/ }).click();
    await page.locator('[role="grid"] [aria-current="date"]').click();
    await receive.getByLabel('ተከታታይ ፊደል', { exact: true }).fill(series);
    await receive.getByLabel('ከቁጥር', { exact: true }).fill('1');
    await receive.getByLabel('እስከ ቁጥር', { exact: true }).fill('10');
    await receive.getByRole('button', { name: 'ገቢ አድርግ' }).click();
    await expect(page.locator('[data-screen="stationery"]')).toBeVisible();
    await expect(page.locator('[data-counts] [data-unit="WOL-BODITI"] [data-reconciled]')).toHaveAttribute(
        'data-reconciled',
        'true'
    );

    // the day's count: leaves 1-9 on the table, the tenth not
    await page.getByRole('link', { name: 'የዕለት ቆጠራ' }).click();
    const closing = page.locator('[data-screen="stationery-closing"]');
    await expect(closing).toBeVisible();
    const run = closing.locator('[data-run="0"]');
    await run.getByLabel('ተከታታይ ፊደል', { exact: true }).fill(series);
    await run.getByLabel('ከቁጥር', { exact: true }).fill('1');
    await run.getByLabel('እስከ ቁጥር', { exact: true }).fill('9');
    await closing.locator('[data-action="close-submit"]').click();
    const result = closing.locator('[data-result]');
    await expect(result.locator('[data-balanced]')).toHaveAttribute('data-balanced', 'false');
    await expect(result.locator('[data-missing]')).toContainText(`${series}10`);
});
