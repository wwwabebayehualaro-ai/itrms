/**
 * Repeating rows and formulas (the legacy multi-row journey on the forms API, task 0.16f): a records officer fills two
 * expense lines; each line's total and the report's total calculate themselves; a receipt number is asked for only on a
 * line above 500 Birr, and its absence stops the submit; the request is filed with the rows as the queries read them.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { PEOPLE, api, field, publishedForm, runName, signedIn, switchOff } from './support';

const EXPENSES = [
    field('InputText', 'title', 'Report title', { props: { required: true } }),
    field('FormArray', 'lines', 'Expense lines', {
        props: { minItems: 1, itemLabel: 'Expense', addButtonLabel: 'Add expense' }
    }),
    field('Calendar', 'date', 'Date', { parentId: 'lines', props: { required: true } }),
    field('Dropdown', 'category', 'Category', {
        parentId: 'lines',
        props: {
            required: true,
            options: [
                { label: 'Fuel', value: 'fuel' },
                { label: 'Per diem', value: 'per_diem' },
                { label: 'Spare parts', value: 'spare_parts' }
            ]
        }
    }),
    field('InputText', 'description', 'Description', { parentId: 'lines' }),
    field('InputNumber', 'amount', 'Amount (Birr)', { parentId: 'lines', props: { required: true } }),
    field('InputNumber', 'taxRate', 'Tax %', { parentId: 'lines' }),
    field('InputNumber', 'lineTotal', 'Line total', {
        parentId: 'lines',
        data: {
            defaultProps: {},
            computed: { expression: '{{= round(row.amount * (1 + (row.taxRate || 0) / 100), 2) }}', readOnly: true }
        }
    }),
    field('InputText', 'receiptNo', 'Receipt no.', {
        parentId: 'lines',
        props: { required: true },
        behavior: {
            validation: { supported: true },
            visibilityConditions: [{ field: 'amount', operator: 'gt', value: 500 }]
        }
    }),
    field('InputNumber', 'total', 'Total (Birr)', {
        data: {
            defaultProps: {},
            computed: { expression: "{{= round(sum(root.lines, 'lineTotal'), 2) }}", readOnly: true }
        }
    }),
    field('InputTextarea', 'notes', 'Notes')
];

async function pick(page: Page, combo: Locator, option: string) {
    await combo.click();
    await page.getByRole('option', { name: option }).click();
}

interface Submission {
    id: string;
    answers: { title?: string; total?: number; lines?: Record<string, unknown>[] };
}

test('expense lines calculate, ask for what they need, and are filed as rows', async ({ browser }) => {
    const authorPage = await signedIn(browser, PEOPLE.author);
    const approverPage = await signedIn(browser, PEOPLE.approver);
    const author = api(authorPage);
    const formId = await publishedForm(author, api(approverPage), runName('Expense report'), EXPENSES);
    const title = runName('Multi-row journey');
    try {
        const page = await signedIn(browser, PEOPLE.filler);
        await page.goto(`/submitted-forms/template/${formId}`);
        await page.getByRole('button', { name: 'New request' }).click();
        const form = page.getByRole('dialog').locator('[data-engine="v2"]');
        await expect(form).toBeVisible();
        await form.getByLabel('Report title').fill(title);

        // line 1: 400 Birr + 15 % -> 460; no receipt asked at or below 500
        const line1 = form.getByRole('group', { name: 'Expense 1' });
        await line1.getByRole('button', { name: /Date/ }).click();
        await page.getByRole('gridcell').filter({ hasText: /^10$/ }).first().click();
        await pick(page, line1.getByRole('combobox', { name: 'Category' }), 'Fuel');
        await line1.getByLabel('Description').fill('Field visit, Boditi');
        await line1.getByLabel('Amount (Birr)').fill('400');
        await line1.getByLabel('Tax %').fill('15');
        await line1.getByLabel('Amount (Birr)').click();
        await expect(line1.getByLabel('Line total')).toHaveValue(/^460(\.00)?$/);
        await expect(line1.getByLabel('Receipt no.')).toHaveCount(0);

        // line 2: 1,200 Birr -> a receipt is required
        await form.getByRole('button', { name: 'Add expense' }).click();
        const line2 = form.getByRole('group', { name: 'Expense 2' });
        await line2.getByRole('button', { name: /Date/ }).click();
        await page.getByRole('gridcell').filter({ hasText: /^12$/ }).first().click();
        await pick(page, line2.getByRole('combobox', { name: 'Category' }), 'Spare parts');
        await line2.getByLabel('Amount (Birr)').fill('1200');
        await line2.getByLabel('Tax %').fill('0');
        await expect(line2.getByLabel('Receipt no.')).toBeVisible();
        await form.getByLabel('Notes').click();
        await expect(form.getByLabel('Total (Birr)')).toHaveValue(/^1,?660(\.00)?$/);

        // the missing receipt stops the submit and says so
        await form.getByRole('button', { name: /Submit/ }).click();
        await expect(form.getByText(/Please fix 1 field before submitting/)).toBeVisible();
        await line2.getByLabel('Receipt no.').fill('R-2041');
        await form.getByRole('button', { name: /Submit/ }).click();
        await expect(page.getByRole('dialog')).toBeHidden();

        const mine = await api(page).get<{ items: Submission[] }>(`v1/submissions?formId=${formId}&mine=true`);
        const saved = mine.items.find((s) => s.answers.title === title);
        expect(saved).toBeTruthy();
        const answers = saved?.answers ?? {};
        // computed on the server too: what the browser sent for them does not count
        expect(answers.total).toBe(1660);
        expect(answers.lines).toHaveLength(2);
        expect(answers.lines?.[0]).toMatchObject({ category: 'fuel', amount: 400, taxRate: 15, lineTotal: 460 });
        // hidden: not filed
        expect(answers.lines?.[0]?.receiptNo).toBeUndefined();
        expect(answers.lines?.[1]).toMatchObject({ category: 'spare_parts', amount: 1200, receiptNo: 'R-2041' });
        expect(answers.lines?.[0]?.date).toMatch(/^\d{4}-\d{2}-10$/);
    } finally {
        await switchOff(author, formId);
    }
});
