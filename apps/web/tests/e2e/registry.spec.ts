/**
 * The register of persons (task 0.14): a records officer of Damot Gale registers a person in Amharic (one name typed in
 * Latin letters with the Ethiopic keyboard), the sensitive fields are kept hidden on the record, and the person is found
 * again by an Amharic search. The name and numbers are generated per run, so the journey repeats without duplicate warnings.
 */
import { expect, test } from '@playwright/test';

import { firstSignIn, resetAccount } from './keycloak';

const RECORDS = { id: '0199f0a0-d000-7000-8000-000000000202', username: 'demo.damot.records' };
const LETTERS = ['ለ', 'መ', 'ሰ', 'በ', 'ተ', 'ነ', 'ከ', 'ወ', 'ዘ', 'የ', 'ደ', 'ገ'];

/** A generated Ethiopic name of three letters (never a real person's). */
const generatedName = () =>
    Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

test('registers a person in Amharic and finds them again by an Amharic search', async ({ page }) => {
    const given = generatedName();
    const phone = `0911${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    await resetAccount(RECORDS.id);
    await firstSignIn(page, RECORDS.username);

    // from the menu: the register, then a new person
    await page.locator('[data-app-sidebar] [data-menu-item="parties.persons"]').click();
    await expect(page.getByRole('heading', { name: 'የሰዎች መዝገብ' })).toBeVisible();
    await page.getByRole('link', { name: 'ሰው መመዝገብ' }).first().click();
    await expect(page.locator('[data-screen="person-new"]')).toBeVisible();

    await page.locator('#givenAm').fill(given);
    // the father's name typed with Latin letters: the Ethiopic name fields start with Ethiopic typing on (F9 toggles it)
    await page.locator('#fatherAm').click();
    await expect(page.locator('#fatherAm')).toHaveAttribute('data-ethiopic', 'on');
    await page.keyboard.type('kebede');
    await expect(page.locator('#fatherAm')).toHaveValue('ከበደ');
    await page.locator('#sex').click();
    await page.getByRole('option', { name: 'ሴት' }).click();
    await page.locator('#phone').fill(phone);
    await page.getByRole('button', { name: 'መዝግብ' }).click();

    // the record: the names, and the phone on record but hidden
    await expect(page.locator('[data-screen="person-record"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`${given} ከበደ`) })).toBeVisible();
    const sensitive = page.locator('[data-sensitive]');
    await expect(sensitive).not.toContainText(phone.slice(4));
    await expect(sensitive.getByLabel('ተደብቋል')).toBeVisible();

    // found again by an Amharic search
    await page.locator('[data-app-sidebar] [data-menu-item="parties.persons"]').click();
    const search = page.locator('[data-screen="persons-search"] form[role="search"]');
    await search.locator('#person-search').fill(`${given} ከበደ`);
    await search.getByRole('button', { name: 'ፈልግ' }).click();
    await expect(page).toHaveURL(/\/registry\/persons\?q=/);
    const results = page.locator('[data-results]');
    await expect(results.getByRole('link', { name: new RegExp(given) })).toBeVisible();
});
