/**
 * A shared, default saved view (task 0.20d; the API's forms-views integration tests cover the rules): Damot Gale's head
 * switches a form's requests to cards and saves that as a view shared with the office and made its default; the
 * office's records officer opens the form's requests with no view in the link and gets it, and sees it among the
 * office's shared views.
 */
import { engineTranslator } from '@itrms/form-engine/core';
import { expect, test } from '@playwright/test';

import { PEOPLE, api, field, publishedForm, runName, signedIn as signedInForms, switchOff } from './support';
import { PEOPLE as WORK, signedIn } from '../workflow/support';

const am = engineTranslator('am');

const FIELDS = [field('InputText', 'title', 'Title', { props: { required: true }, classification: 'internal' })];

test("a view the office's head shares as the default is what the office's people open", async ({ browser }) => {
    test.setTimeout(300_000);
    const author = api(await signedInForms(browser, PEOPLE.author));
    const formId = await publishedForm(
        author,
        api(await signedInForms(browser, PEOPLE.approver)),
        runName('Viewed requests'),
        FIELDS
    );
    const viewName = runName('Office cards');
    try {
        const records = await signedIn(browser, WORK.records);
        for (const title of ['First', 'Second']) {
            const published = await api(records).get<{ publishedVersion: { id: string } }>(`v1/forms/${formId}`);
            await api(records).post('v1/submissions', {
                formId,
                formVersionId: published.publishedVersion.id,
                answers: { title }
            });
        }

        // the head: cards, saved as the office's shared default view
        const head = await signedIn(browser, WORK.head);
        await head.goto(`/submitted-forms/template/${formId}?view=cards`);
        await expect(head.locator('[data-cards] [data-record]')).toHaveCount(2);
        await head.getByRole('button', { name: am('form-engine.viewer.views.button') }).click();
        await head.getByRole('button', { name: am('form-engine.viewer.views.saveCurrent') }).click();
        const dialog = head.locator('[data-save-view]');
        await dialog.locator('#view-name').fill(viewName);
        await dialog.locator('#view-shared').click();
        await dialog.locator('#view-default').click();
        await dialog.getByRole('button', { name: am('form-engine.viewer.views.save') }).click();
        await expect(head.getByRole('button', { name: viewName })).toBeVisible();
        const saved = (
            await api(head).get<{ items: { name: string; visibility: string; isDefault: boolean }[] }>(
                `v1/forms/${formId}/views`
            )
        ).items.find((v) => v.name === viewName);
        expect(saved).toMatchObject({ visibility: 'unit', isDefault: true });

        // the records officer: the form's requests open in the office's default view
        await records.goto(`/submitted-forms/template/${formId}`);
        await expect(records.locator('[data-cards] [data-record]')).toHaveCount(2);
        await expect(records.getByRole('button', { name: viewName })).toBeVisible();
        await records.getByRole('button', { name: viewName }).click();
        await expect(records.locator(`[data-saved-view="${viewName}"]`)).toBeVisible();
    } finally {
        await switchOff(author, formId);
    }
});
