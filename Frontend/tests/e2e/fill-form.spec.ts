// The form renderer (design system): a person fills in a real form, the request is stored with the
// same value shapes as before, and its page shows the form read-only. Runs on the demo data (Leave Request).
import { expect, test } from '@playwright/test';
import { ADMIN, SUBMITTER, apiAs, login, templateId } from './support';

test('a request filled in with the new renderer is stored and shown like any other', async ({ page, request }) => {
    const admin = await apiAs(request, ADMIN);
    const formId = await templateId(admin, 'Leave Request');
    const reason = `Engine v2 e2e ${Date.now()}`;
    let createdId: string | undefined;
    try {
        await login(page, SUBMITTER);
        await page.goto(`/submitted-forms/template/${formId}`);
        await page.getByRole('button', { name: 'New request' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('[data-engine="v2"]')).toBeVisible();

        // a submit with nothing filled in is stopped and says why
        await dialog.getByRole('button', { name: /Submit/ }).click();
        await expect(dialog.getByText(/Please fix \d+ fields? before submitting/)).toBeVisible();

        await dialog.getByLabel('Employee').fill('Priya Nair');
        await dialog.getByRole('combobox', { name: 'Leave type' }).click();
        await page.getByRole('option', { name: 'Sick leave' }).click();
        await dialog.getByRole('button', { name: /First day/ }).click();
        await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
        await dialog.getByLabel('Days').fill('2');
        await dialog.getByRole('switch', { name: 'Half day' }).click();
        await dialog.getByLabel('Reason').fill(reason);
        await page.screenshot({ path: 'test-results/engine-v2-filled.png' });
        await dialog.getByRole('button', { name: /Submit/ }).click();
        await expect(dialog).toBeHidden();

        // stored with the value shapes the backend queries: option value, "YYYY-MM-DD", number, boolean
        const list = await admin.get(`/form/submissions?template_id=${formId}&limit=100`);
        const saved = (list.items ?? list).find((s: { submission_data: { reason?: string } }) => s.submission_data.reason === reason);
        expect(saved).toBeTruthy();
        createdId = saved.id;
        expect(saved.submission_data).toMatchObject({ employee: 'Priya Nair', leaveType: 'sick_leave', days: 2, halfDay: true, reason });
        expect(saved.submission_data.firstDay).toMatch(/^\d{4}-\d{2}-15$/);

        // its page: the same form, read-only, with the stored values
        await page.goto(`/submitted-forms/template/${formId}/${saved.id}`);
        const form = page.locator('[data-engine="v2"]');
        await expect(form.getByLabel('Employee')).toHaveValue('Priya Nair');
        await expect(form.getByLabel('Employee')).toBeDisabled();
        await expect(form.getByRole('combobox', { name: 'Leave type' })).toContainText('Sick leave');
        await expect(form.getByRole('button', { name: /Submit/ })).toHaveCount(0);
    } finally {
        if (createdId) await admin.delete(`/form/submissions/${createdId}`); // the demo data stays as seeded
    }
});
