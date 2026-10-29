/**
 * The task inbox (tasks 0.20b, 0.20d): the home page counts and lists what waits; Damot Gale's records officer finds a
 * case's review in "My tasks" from the menu, with its
 * time limit, takes it on (the claim filters follow), and opens the case. The office's head (another role) does not see
 * it in their inbox. Each run makes its own workflow and case, and finds the case by its number.
 */
import { expect, test } from '@playwright/test';

import { PEOPLE, api, journeyService, journeyWorkflow, signedIn, submittedCase } from './support';

test("lists the office's steps for the person's role; a step is taken on and opened", async ({ browser }) => {
    test.setTimeout(300_000);
    const bureau = api(await signedIn(browser, PEOPLE.bureau));
    const workflowId = await journeyWorkflow(bureau, 'inbox');
    const service = await journeyService(bureau, 'RS-02', workflowId);
    const page = await signedIn(browser, PEOPLE.records);
    const started = await submittedCase(api(page), service);

    // the home page: the menu's badge counts what waits, the "my tasks" widget lists it (task 0.20d)
    await page.goto('/');
    await expect(page.locator('[data-menu-badge="workflow.inbox"]')).toBeVisible();
    const widget = page.locator('[data-widget="my-tasks"]');
    await expect(widget).toBeVisible();
    await expect(widget.locator('[data-widget-task]').first()).toBeVisible();

    // from the menu
    await page.locator('[data-app-sidebar] [data-menu-item="workflow.inbox"]').click();
    await expect(page.getByRole('heading', { name: 'የእኔ ሥራዎች' })).toBeVisible();
    await page.getByLabel('የጉዳይ ቁጥር').fill(String(started.number));
    await page.locator('[data-screen="inbox"] form[role="search"]').getByRole('button', { name: 'ፈልግ' }).click();
    const row = page.locator(`[data-case-number="${started.number}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('ማጣራት');
    await expect(row).toContainText('በጊዜው');

    // taken on: it is the person's, and the claim filters follow
    await row.getByRole('button', { name: 'ያዝ' }).click();
    await expect(row.locator('[data-claimed-by]')).toContainText('እርስዎ');
    await page.locator('[data-claim="unclaimed"]').click();
    await expect(page.locator('[data-slot="empty-state"]')).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.locator('[data-claim="mine"]').click();
    await expect(row).toBeVisible();

    // opened: the case page
    await row.getByRole('link', { name: 'ክፈት' }).click();
    await expect(page.locator(`[data-screen="case"][data-case="${started.id}"]`)).toBeVisible();
    await expect(page.getByRole('heading', { name: `ጉዳይ ${started.number}` })).toBeVisible();
    await expect(page.locator('[data-open-step]')).toContainText('ይህን ደረጃ እርስዎ ይዘውታል።');

    // the head of the office holds another role: not in their inbox
    const head = await signedIn(browser, PEOPLE.head);
    await head.goto('/inbox');
    await head.getByLabel('የጉዳይ ቁጥር').fill(String(started.number));
    await head.locator('[data-screen="inbox"] form[role="search"]').getByRole('button', { name: 'ፈልግ' }).click();
    await expect(head.locator('[data-slot="empty-state"]')).toBeVisible();
    await expect(head.locator(`[data-case-number="${started.number}"]`)).toHaveCount(0);
});
