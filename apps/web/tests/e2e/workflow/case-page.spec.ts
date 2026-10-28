/**
 * A case page (task 0.20b): the records officer takes the review on, writes a comment mentioning the office's head
 * (picked with `@`), and forwards the case with a comment; the timeline shows each. The head is told of the mention (the
 * worker relays it): the bell counts it, and the notice opens the case, where the head approves it.
 */
import { expect, test } from '@playwright/test';

import { PEOPLE, api, journeyWorkflow, signedIn, submittedCase } from './support';

test('a comment mentions a colleague, who is told and opens the case from the bell', async ({ browser }) => {
    test.setTimeout(300_000);
    const author = await signedIn(browser, PEOPLE.author);
    const workflowId = await journeyWorkflow(api(author), 'case-page');
    const page = await signedIn(browser, PEOPLE.records);
    const started = await submittedCase(api(page), workflowId);

    await page.goto(`/cases/${started.id}`);
    const step = page.locator('[data-open-step]');
    await expect(step).toContainText('አሁን፦ ማጣራት');
    await step.getByRole('button', { name: 'ያዝ' }).click();
    await expect(step).toContainText('ይህን ደረጃ እርስዎ ይዘውታል።');

    // a comment, the head picked with @
    const box = page.locator('#case-comment');
    await box.click();
    await page.keyboard.type('ሊብሬው ነገ ይመጣል ');
    await page.keyboard.type('@');
    await page.getByPlaceholder('ባልደረባ ፈልግ').fill('Damot Gale Head');
    await page.locator(`[data-person]`, { hasText: PEOPLE.head.name }).click();
    await expect(page.locator('[data-comment-box] [data-mentions]')).toContainText(PEOPLE.head.name);
    await page.getByRole('button', { name: 'ላክ' }).click();
    const comment = page.locator('[data-timeline] [data-event="comment"]').last();
    await expect(comment).toContainText('ሊብሬው ነገ ይመጣል');
    await expect(comment.locator('[data-mentions]')).toContainText(PEOPLE.head.name);

    // forwarded, with a comment
    await page.locator('[data-action="forward"]').click();
    const dialog = page.locator('[data-action-dialog="forward"]');
    await dialog.getByLabel('አስተያየት (ካለ)').fill('ተጣርቷል');
    await dialog.getByRole('button', { name: 'አስተላልፍ' }).click();
    await expect(page.locator('[data-screen="case"][data-state="approval"]')).toBeVisible();
    await expect(page.locator('[data-timeline] [data-event="transition"]').last()).toContainText('ተጣርቷል');

    // the head: told of the mention, opens the case from the bell and approves
    const head = await signedIn(browser, PEOPLE.head);
    const bell = head.locator('[data-notifications-bell]');
    await expect(async () => {
        await head.reload();
        await expect(bell).not.toHaveAttribute('data-unread', '0', { timeout: 5_000 });
    }).toPass({ timeout: 120_000 });
    await bell.click();
    const notice = head
        .locator('[data-notifications] [data-notice="workflow.notify.mentioned"]', {
            hasText: `ጉዳይ ${started.number}፦`
        })
        .first();
    await expect(notice).toHaveAttribute('data-read', 'false');
    await notice.click();
    await expect(head.locator(`[data-screen="case"][data-case="${started.id}"]`)).toBeVisible();
    await head.locator('[data-action="approve"]').click();
    await head.locator('[data-action-dialog="approve"]').getByRole('button', { name: 'አጽድቅ' }).click();
    await expect(head.locator('[data-screen="case"][data-state="done"]')).toBeVisible();
});
