// The builder path end to end on the demo data: template gallery -> builder -> a form's data viewer.
import { expect, test } from '@playwright/test';
import { apiAs, login, templateId } from './support';

test('admin opens the templates, the builder and a form’s submitted data', async ({ page, request }) => {
    const expenseReport = await templateId(await apiAs(request), 'Expense Report');
    await login(page);

    await page.goto('/dynamic-template/saved-templates');
    await expect(page.getByText('Expense Report').first()).toBeVisible();

    await page.goto('/dynamic-template/builder');
    await expect(page.locator('[data-designer]')).toBeVisible();

    await page.goto(`/submitted-forms/template/${expenseReport}`);
    await expect(page.locator('[data-viewer]')).toBeVisible();
    await expect(page.locator('[data-viewer] tbody tr').first()).toBeVisible();
});
