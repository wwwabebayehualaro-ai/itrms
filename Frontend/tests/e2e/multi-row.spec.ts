// A form with repeating rows, formulas and a people picker (the demo's Expense Report): a person fills two expense lines; line
// totals and the report total calculate themselves, the receipt number is asked for only above 50 USD, and the request is
// stored with the rows as the backend queries them. Cleans up after itself.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, SUBMITTER, apiAs, login, templateId } from './support';

async function pick(page: Page, combo: Locator, option: string | RegExp) {
    await combo.click();
    await page.getByRole('option', { name: option }).click();
}

test('expense lines calculate, show what they need, and are stored as rows', async ({ page, request }) => {
    const admin = await apiAs(request, ADMIN);
    const formId = await templateId(admin, 'Expense Report');
    const title = `Multi-row e2e ${Date.now()}`;
    let createdId: string | undefined;
    try {
        await login(page, SUBMITTER);
        await page.goto(`/submitted-forms/template/${formId}`);
        await page.getByRole('button', { name: 'New request' }).click();
        const form = page.getByRole('dialog').locator('[data-engine="v2"]');
        await expect(form).toBeVisible();

        // filled from the signed-in person ({{user.name}}), not editable by hand where read-only
        await expect(form.getByLabel('Employee')).toHaveValue('Priya Nair');
        await form.getByLabel('Report title').fill(title);
        await pick(page, form.getByRole('combobox', { name: 'Approver' }), 'Maria Santos'); // options from the directory data source

        // line 1: 40 USD + 10 % tax -> 44; no receipt asked below 50
        const line1 = form.getByRole('group', { name: 'Expense 1' });
        await line1.getByRole('button', { name: /Date/ }).click();
        await page.getByRole('gridcell').filter({ hasText: /^10$/ }).first().click();
        await pick(page, line1.getByRole('combobox', { name: 'Category' }), 'Meals');
        await line1.getByLabel('Description').fill('Team lunch');
        await line1.getByLabel('Amount (USD)').fill('40');
        await line1.getByLabel('Tax %').fill('10');
        await line1.getByLabel('Amount (USD)').click(); // leave the tax box so it shows formatted
        await expect(line1.getByLabel('Line total')).toHaveValue(/^44(\.00)?$/);
        await expect(line1.getByLabel('Receipt no.')).toHaveCount(0);

        // line 2: 100 USD -> a receipt is required
        await form.getByRole('button', { name: 'Add expense' }).click();
        const line2 = form.getByRole('group', { name: 'Expense 2' });
        await line2.getByRole('button', { name: /Date/ }).click();
        await page.getByRole('gridcell').filter({ hasText: /^12$/ }).first().click();
        await pick(page, line2.getByRole('combobox', { name: 'Category' }), 'Travel');
        await line2.getByLabel('Description').fill('Train ticket');
        await line2.getByLabel('Amount (USD)').fill('100');
        await line2.getByLabel('Tax %').fill('0');
        await expect(line2.getByLabel('Receipt no.')).toBeVisible();
        await form.getByLabel('Notes').click();
        await expect(form.getByLabel('Total (USD)')).toHaveValue(/^144(\.00)?$/);

        // the missing receipt stops the submit and says so
        await form.getByRole('button', { name: /Submit/ }).click();
        await expect(form.getByText(/Please fix 1 field before submitting/)).toBeVisible();
        await line2.getByLabel('Receipt no.').fill('R-2041');
        await page.screenshot({ path: 'test-results/multi-row-filled.png', fullPage: true });
        await form.getByRole('button', { name: /Submit/ }).click();
        await expect(page.getByRole('dialog')).toBeHidden();

        const list = await admin.get(`/form/submissions?template_id=${formId}&limit=200`);
        const saved = (list.items ?? list).find((s: { submission_data: { title?: string } }) => s.submission_data.title === title);
        expect(saved).toBeTruthy();
        createdId = saved.id;
        const d = saved.submission_data;
        expect(d).toMatchObject({ employee: 'Priya Nair', total: 144 });
        expect(d.lines).toHaveLength(2);
        expect(d.lines[0]).toMatchObject({ category: 'meals', description: 'Team lunch', amount: 40, taxRate: 10, lineTotal: 44 });
        expect(d.lines[0].receiptNo).toBeUndefined(); // hidden: not stored
        expect(d.lines[1]).toMatchObject({ category: 'travel', amount: 100, lineTotal: 100, receiptNo: 'R-2041' });
        expect(d.lines[0].date).toMatch(/^\d{4}-\d{2}-10$/);
    } finally {
        if (createdId) await admin.delete(`/form/submissions/${createdId}`);
    }
});
