/**
 * Changing a published form (task 0.18a): the zone's admin opens a published form in the builder, finds its keys locked,
 * takes a field out (it stays, flagged removed: its answers and the views naming it keep working), saves, and asks for the
 * publication. The request shows the difference to the published version and the zone's shared view that filters on the
 * removed field. The zone's head sees the same review in the approvals inbox and approves it.
 */
import { engineTranslator } from '@itrms/form-engine/core';
import { expect, test } from '@playwright/test';

import { PEOPLE, api, field, publishedForm, runName, signedIn, switchOff } from './support';

const am = engineTranslator('am');

interface FormOut {
    version: number;
    status: string;
}
interface VersionOut {
    number: number;
    document: { fields: { id: string; removed?: boolean }[] };
}

test('a change to a published form shows its diff and the views it affects, and is published once approved', async ({
    browser
}) => {
    test.setTimeout(300_000);
    const name = runName('Governed form');
    const viewName = `Town offices ${name}`;
    const page = await signedIn(browser, PEOPLE.author);
    const checker = await signedIn(browser, PEOPLE.approver);
    const author = api(page);
    const approver = api(checker);
    let formId: string | undefined;
    try {
        await page.goto('/dynamic-template/saved-templates');
        await checker.goto('/approvals');
        formId = await publishedForm(author, approver, name, [
            field('InputText', 'fullName', 'Full name', { props: { required: true } }),
            field('Dropdown', 'office', 'Office', {
                data: {
                    defaultProps: {},
                    dataSource: {
                        staticData: [
                            { label: 'Town', value: 'town' },
                            { label: 'Woreda', value: 'woreda' }
                        ]
                    }
                }
            })
        ]);
        // the zone's head shares a view of the form's data that filters on the office
        await approver.post(`v1/forms/${formId}/views`, {
            name: viewName,
            visibility: 'unit',
            config: { mode: 'table', filter: { op: 'and', items: [{ field: 'office', op: 'eq', value: 'town' }] } }
        });

        // the author opens it in the builder: a published key cannot be renamed
        await page.reload();
        await page.getByRole('button', { name: `Edit ${name} in the builder` }).click();
        const designer = page.locator('[data-designer]');
        await expect(designer.getByRole('heading', { name })).toBeVisible();
        const canvas = designer.locator('[data-canvas]');
        const inspector = designer.getByRole('complementary', {
            name: am('form-engine.designer.toolbar.fieldSettings')
        });
        await canvas.locator('[data-design-field="fullName"]').click();
        await expect(inspector.getByLabel(am('form-engine.settings.inspector.field.key'))).toBeDisabled();
        await expect(inspector.getByText(am('form-engine.settings.inspector.field.keyLocked'))).toBeVisible();

        // deleting the office keeps it, flagged removed, with a way back
        await canvas.locator('[data-design-field="office"]').click();
        await canvas.getByRole('button', { name: am('form-engine.designer.canvas.delete') }).click();
        const office = canvas.locator('[data-design-field="office"]');
        await expect(office).toHaveAttribute('data-removed', 'true');
        await expect(office.locator('[data-removed-badge]')).toBeVisible();

        // saved, then the request: what changed, and the shared view that uses the removed field
        await designer.getByRole('button', { name: am('form-engine.designer.toolbar.save'), exact: true }).click();
        await expect(designer.locator('[data-unsaved]')).toHaveCount(0);
        await designer.locator('[data-request-publication-button]').click();
        const review = page.locator('[data-publish-dialog]');
        await expect(review.locator('[data-publish-review]')).toHaveAttribute('data-can-publish', 'true');
        await expect(review.locator('[data-diff="removed"]')).toContainText('office');
        await expect(review.locator('[data-review-section="views"]')).toContainText(viewName);
        await review.locator('[data-request-publication]').click();
        await expect(page.getByText(am('form-engine.designer.publish.sentForApproval')).first()).toBeVisible();
        // waiting for the second person; people go on filling version 1 meanwhile
        expect((await author.get<FormOut>(`v1/forms/${formId}`)).status).toBe('pending');

        // the zone's head reviews the same difference and view in the inbox, and approves
        await checker.reload();
        const row = checker.locator('[data-approval]').filter({ hasText: name });
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: 'Review' }).click();
        const sheet = checker.getByRole('dialog');
        await expect(sheet.locator('[data-diff="removed"]')).toContainText('office');
        await expect(sheet.locator('[data-review-section="views"]')).toContainText(viewName);
        await sheet.getByRole('button', { name: /approve/i }).click();
        await expect(sheet).toBeHidden();
        expect((await author.get<FormOut>(`v1/forms/${formId}`)).status).toBe('published');

        // the live version keeps the office, flagged removed
        const live = await author.get<VersionOut>(`v1/forms/${formId}/versions/published`);
        expect(live.number).toBe(2);
        expect(live.document.fields.find((f) => f.id === 'office')).toMatchObject({ removed: true });
    } finally {
        if (formId) await switchOff(author, formId);
    }
});
