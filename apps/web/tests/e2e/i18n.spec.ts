/**
 * Languages (task 0.13): the shell starts in Amharic; a person switches to English from the user menu; the choice is kept
 * on the server, so a PC without it (no cookie) shows English again after sign-in; the API's error titles follow; dates
 * show Ethiopian by default.
 */
import { expect, test } from '@playwright/test';

import { firstSignIn, resetAccount } from './keycloak';

const HEAD = { id: '0199f0a0-d000-7000-8000-000000000201', username: 'demo.damot.head' };
const APP = process.env.E2E_WEB || 'http://localhost:3000';

test('switches the language, keeps it on the server, and the API answers in it', async ({ page, context }) => {
    await resetAccount(HEAD.id);
    await firstSignIn(page, HEAD.username);
    const sidebar = page.locator('[data-app-sidebar]');

    // Amharic by default
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(sidebar.getByRole('link', { name: 'መነሻ' })).toBeVisible();

    // to English from the user menu
    await page.locator('[data-user-menu]').click();
    await page.getByRole('menuitem', { name: 'ቋንቋ' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(sidebar.getByRole('link', { name: 'Home' })).toBeVisible();

    // another PC: no language cookie; the server's preference brings English back
    await context.clearCookies({ name: 'itrms_lang' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(sidebar.getByRole('link', { name: 'Home' })).toBeVisible();

    // the API's error titles in the person's language
    const problem = await page.evaluate(async () => {
        const res = await fetch('/api/v1/org-units/0199f0a0-0000-7000-8000-00000000dead', {
            headers: { 'accept-language': document.documentElement.lang }
        });
        return (await res.json()) as { title: string; status: number };
    });
    expect(problem).toMatchObject({ status: 404, title: 'Not found.' });

    // back to Amharic, as this demo account started
    await page.locator('[data-user-menu]').click();
    await page.getByRole('menuitem', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: 'አማርኛ' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    expect((await context.cookies(APP)).find((c) => c.name === 'itrms_lang')?.value).toBe('am');
});
