// The form builder: build a form from nothing — palette clicks and a real drag, settings, options,
// undo/redo with the keyboard — preview it, save it, and fill it in on the requests page. Cleans up after itself.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, apiAs, login } from './support';

/** A pointer drag dnd-kit sees (it needs real moves after the press). */
async function drag(page: Page, from: Locator, to: Locator) {
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
}

test('a form built in the new builder is saved as version 2 and works on the requests page', async ({
    page,
    request
}) => {
    const admin = await apiAs(request, ADMIN);
    const name = `E2E builder v2 ${Date.now()}`;
    let createdId: string | undefined;
    try {
        await login(page);
        await page.goto('/dynamic-template/saved-templates');
        await page.goto('/dynamic-template/builder');
        const designer = page.locator('[data-designer]');
        await expect(designer).toBeVisible();
        const canvas = designer.locator('[data-canvas]');
        const inspector = designer.getByRole('complementary', { name: 'Field settings' });

        // a text field by click, renamed
        await designer.getByRole('button', { name: 'Add Text', exact: true }).click();
        await inspector.getByLabel('Label').fill('Full name');
        await inspector.getByRole('switch', { name: 'Required' }).click();

        // a choice by click: it starts with two options; renaming them renames what is stored
        await designer.getByRole('button', { name: 'Add Pick one' }).click();
        await inspector.getByLabel('Label').fill('Department');
        await inspector.getByRole('tab', { name: 'Options' }).click();
        await inspector.getByLabel('Option 1 label').fill('Sales');
        await inspector.getByLabel('Option 2 label').fill('Finance');
        await expect(inspector.getByLabel('Option 2 value')).toHaveValue('finance');
        // a third one, added and then removed again
        await inspector.getByRole('button', { name: 'Add option' }).click();
        await expect(inspector.getByLabel('Option 3 label')).toBeFocused();
        await inspector.getByRole('button', { name: 'Remove option 3' }).click();

        // a long text dragged to the end of the form
        await drag(
            page,
            designer.getByRole('button', { name: 'Add Long text' }),
            canvas.locator('[data-drop-zone="form"]')
        );
        await expect(canvas.locator('[data-design-field]')).toHaveCount(3);
        await expect(canvas.locator('[data-design-field]').nth(2)).toHaveAttribute('data-field-type', 'InputTextarea');

        // undo / redo from the keyboard (focus on the canvas, not in a text box)
        await canvas.click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+z');
        await expect(canvas.locator('[data-design-field]')).toHaveCount(2);
        await page.keyboard.press('Control+Shift+z');
        await expect(canvas.locator('[data-design-field]')).toHaveCount(3);

        // a panel, and the long text dragged into it
        await canvas.click({ position: { x: 5, y: 5 } });
        await designer.getByRole('button', { name: 'Add Panel' }).click();
        await drag(page, canvas.locator('[data-design-field="longText"]'), canvas.locator('[data-drop-zone="panel"]'));
        await expect(canvas.locator('[data-design-field="panel"] [data-design-field="longText"]')).toHaveCount(1);
        await page.screenshot({ path: 'test-results/builder-v2-design.png', fullPage: true });

        // the preview is the real form; a submit shows what would be stored
        await designer.getByRole('radio', { name: /Preview/ }).click();
        await designer.getByRole('button', { name: 'Submit' }).click();
        await expect(designer.getByText(/Please fix 1 field/)).toBeVisible();
        await designer.getByLabel('Full name').fill('Priya Nair');
        await designer.getByRole('combobox', { name: 'Department' }).click();
        await page.getByRole('option', { name: 'Finance' }).click();
        await designer.getByRole('button', { name: 'Submit' }).click();
        await expect(designer.locator('[data-preview-result]')).toContainText('"department": "finance"');
        await page.screenshot({ path: 'test-results/builder-v2-preview.png', fullPage: true });
        await designer.getByRole('radio', { name: /Design/ }).click();

        // save as a new form
        await designer.getByRole('button', { name: 'Save as…' }).click();
        await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name);
        await page.getByRole('button', { name: 'Save form' }).click();
        await expect(designer.getByRole('heading', { name })).toBeVisible();
        await expect(designer.locator('[data-unsaved]')).toHaveCount(0);

        const list: Array<{ id: string; name: string; form_config: any }> = await admin.get(
            '/template/forms/templates?limit=500'
        );
        const saved = list.find((t) => t.name === name);
        expect(saved).toBeTruthy();
        createdId = saved!.id;
        expect(saved!.form_config.schemaVersion).toBe(2);
        expect(saved!.form_config.fields.map((f: any) => [f.id, f.type, f.label, f.parentId ?? null])).toEqual([
            ['fullName', 'InputText', 'Full name', null],
            ['department', 'Dropdown', 'Department', null],
            ['panel', 'Panel', 'Panel', null],
            ['longText', 'InputTextarea', 'Long text', 'panel']
        ]);
        expect(saved!.form_config.fields[1].data.dataSource.staticData).toEqual([
            { label: 'Sales', value: 'sales' },
            { label: 'Finance', value: 'finance' }
        ]);

        // people fill it in
        await page.goto(`/submitted-forms/template/${createdId}`);
        await page.getByRole('button', { name: 'New request' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Full name')).toBeVisible();
        await expect(dialog.getByText('Department')).toBeVisible();
    } finally {
        if (createdId) await admin.delete(`/template/forms/templates/${createdId}`);
    }
});
