/**
 * Filling a form in (the legacy fill-form journey on the forms API, task 0.16f): a records officer of Damot Gale fills
 * in the zone's leave request; an empty submit is stopped and says why; the request is filed with the stored value
 * shapes (an option's value, "YYYY-MM-DD", a number, a boolean); its page shows the form read-only with those values.
 */
import { engineTranslator } from '@itrms/form-engine/core';
import { expect, test } from '@playwright/test';

import { PEOPLE, api, field, publishedForm, runName, signedIn, switchOff } from './support';

// the page runs in Amharic, so the engine's own words are looked up in its Amharic catalogue
const am = engineTranslator('am');
const SUBMIT = am('form-engine.renderer.submit.label');
// any number of fields: the plural's "other" form with a number pattern in place of its count
const FIX_FIELDS = new RegExp(am('form-engine.renderer.submit.fixFields', { count: 7 }).replace('7', '\\d+'));

const LEAVE = [
    field('InputText', 'employee', 'Employee', { props: { required: true } }),
    field('Dropdown', 'leaveType', 'Leave type', {
        props: {
            required: true,
            options: [
                { label: 'Annual leave', value: 'annual_leave' },
                { label: 'Sick leave', value: 'sick_leave' }
            ]
        }
    }),
    field('Calendar', 'firstDay', 'First day', { props: { required: true } }),
    field('InputNumber', 'days', 'Days', { props: { required: true } }),
    field('InputSwitch', 'halfDay', 'Half day'),
    field('InputTextarea', 'reason', 'Reason'),
    // picked on the Ethiopian calendar, stored as the Gregorian day (task 0.17b)
    field('EthDate', 'returnDay', 'Return day')
];

interface Submission {
    id: string;
    answers: Record<string, unknown>;
    handlingUnit: { code: string };
}

test('a request filled in is filed with its value shapes and shown read-only', async ({ browser }) => {
    const authorPage = await signedIn(browser, PEOPLE.author);
    const approverPage = await signedIn(browser, PEOPLE.approver);
    const author = api(authorPage);
    const formId = await publishedForm(author, api(approverPage), runName('Leave request'), LEAVE);
    const reason = runName('Fill journey');
    try {
        const page = await signedIn(browser, PEOPLE.filler);
        await page.goto(`/submitted-forms/template/${formId}`);
        await page.getByRole('button', { name: 'New request' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('[data-engine="v2"]')).toBeVisible();

        // a submit with nothing filled in is stopped and says why
        await dialog.getByRole('button', { name: SUBMIT }).click();
        await expect(dialog.getByText(FIX_FIELDS)).toBeVisible();

        await dialog.getByLabel('Employee').fill('Almaz Tesfaye');
        await dialog.getByRole('combobox', { name: 'Leave type' }).click();
        await page.getByRole('option', { name: 'Sick leave' }).click();
        await dialog.getByRole('button', { name: /First day/ }).click();
        await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
        await dialog.getByLabel('Days').fill('2');
        await dialog.getByRole('switch', { name: 'Half day' }).click();
        await dialog.getByLabel('Reason').fill(reason);
        await dialog.getByRole('button', { name: /Return day/ }).click();
        await page.locator('[role="grid"] [data-day="5"]').click();
        await dialog.getByRole('button', { name: SUBMIT }).click();
        await expect(dialog).toBeHidden();

        // filed on the office that filled it in, with the value shapes the queries read
        const mine = await api(page).get<{ items: Submission[] }>(`v1/submissions?formId=${formId}&mine=true`);
        const saved = mine.items.find((s) => s.answers.reason === reason);
        expect(saved).toBeTruthy();
        expect(saved?.handlingUnit.code).toBe('WOL-DAMOT-GALE');
        expect(saved?.answers).toMatchObject({
            employee: 'Almaz Tesfaye',
            leaveType: 'sick_leave',
            days: 2,
            halfDay: true,
            reason
        });
        expect(saved?.answers.firstDay).toMatch(/^\d{4}-\d{2}-15$/);
        // the Ethiopian day is stored as an ISO Gregorian date
        expect(saved?.answers.returnDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // its page: the same form, read-only, with the stored values
        await page.goto(`/submitted-forms/template/${formId}/${saved?.id}`);
        const form = page.locator('[data-engine="v2"]');
        await expect(form.getByLabel('Employee')).toHaveValue('Almaz Tesfaye');
        await expect(form.getByLabel('Employee')).toBeDisabled();
        await expect(form.getByRole('combobox', { name: 'Leave type' })).toContainText('Sick leave');
        await expect(form.getByRole('button', { name: SUBMIT })).toHaveCount(0);
    } finally {
        await switchOff(author, formId);
    }
});
