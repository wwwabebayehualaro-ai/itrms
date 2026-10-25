/**
 * Building and publishing a form (the legacy builder and publish-approval journeys on the forms API, task 0.16f): the
 * zone's admin builds a form from nothing in the builder (palette clicks and a real drag, options, undo/redo, a panel),
 * previews it, saves it, and asks for it to be published; it takes no requests yet. The zone's head approves it in the
 * approvals inbox (the admin cannot decide their own request); then a woreda's records officer fills it in.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { PEOPLE, api, runName, signedIn, switchOff } from './support';

/** A pointer drag dnd-kit sees (it needs real moves after the press). */
async function drag(page: Page, from: Locator, to: Locator) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error('drag: an element is not on screen');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
}

interface FormOut {
    id: string;
    version: number;
    status: string;
    name: Record<string, string>;
    document: { schemaVersion: number; fields: { id: string; type: string; label: string; parentId?: string }[] };
}

test('a form built in the builder is published once a second person approves, then takes requests', async ({
    browser
}) => {
    // three people sign in
    test.setTimeout(300_000);
    const name = runName('Builder journey');
    const page = await signedIn(browser, PEOPLE.author);
    const author = api(page);
    let formId: string | undefined;
    try {
        await page.goto('/dynamic-template/builder');
        const designer = page.locator('[data-designer]');
        await expect(designer).toBeVisible();
        const canvas = designer.locator('[data-canvas]');
        const inspector = designer.getByRole('complementary', { name: 'Field settings' });

        // a text field by click, renamed, required and filterable
        await designer.getByRole('button', { name: 'Add Text', exact: true }).click();
        await inspector.getByLabel('Label').fill('Full name');
        await inspector.getByRole('switch', { name: 'Required' }).click();
        await inspector.getByRole('switch', { name: 'Filterable' }).click();

        // a choice by click: it starts with two options; renaming them renames what is stored
        await designer.getByRole('button', { name: 'Add Pick one' }).click();
        await inspector.getByLabel('Label').fill('Office type');
        await inspector.getByRole('tab', { name: 'Options' }).click();
        await inspector.getByLabel('Option 1 label').fill('Woreda');
        await inspector.getByLabel('Option 2 label').fill('Town');
        await expect(inspector.getByLabel('Option 2 value')).toHaveValue('town');
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

        // the preview is the real form; a submit shows what would be stored
        await designer.getByRole('radio', { name: /Preview/ }).click();
        await designer.getByRole('button', { name: 'Submit' }).click();
        await expect(designer.getByText(/Please fix 1 field/)).toBeVisible();
        await designer.getByLabel('Full name').fill('Almaz Tesfaye');
        await designer.getByRole('combobox', { name: 'Office type' }).click();
        await page.getByRole('option', { name: 'Town' }).click();
        await designer.getByRole('button', { name: 'Submit' }).click();
        await expect(designer.locator('[data-preview-result]')).toContainText('"officeType": "town"');
        await designer.getByRole('radio', { name: /Design/ }).click();

        // saved as a new form, a draft of the author's office
        await designer.getByRole('button', { name: 'Save as…' }).click();
        // its name in Amharic and in English, both required (texts in every language, task 0.17a)
        const saveAs = page.getByRole('dialog');
        await saveAs.getByLabel('Name in አማርኛ').fill(`ቅጽ ${name}`);
        await saveAs.getByLabel('Name in English').fill(name);
        await page.getByRole('button', { name: 'Save form' }).click();
        await expect(designer.getByRole('heading', { name })).toBeVisible();
        await expect(designer.locator('[data-unsaved]')).toHaveCount(0);

        const list = await author.get<{ items: { id: string; name: Record<string, string> }[] }>(
            `v1/forms?q=${encodeURIComponent(name)}`
        );
        formId = list.items.find((f) => f.name.en === name)?.id;
        expect(formId).toBeTruthy();
        const saved = await author.get<FormOut>(`v1/forms/${formId}`);
        expect(saved.status).toBe('draft');
        expect(saved.name).toEqual({ am: `ቅጽ ${name}`, en: name });
        expect(saved.document.schemaVersion).toBe(2);
        expect(saved.document.fields.map((f) => [f.id, f.type, f.label, f.parentId ?? null])).toEqual([
            ['fullName', 'InputText', 'Full name', null],
            ['officeType', 'Dropdown', 'Office type', null],
            ['panel', 'Panel', 'Panel', null],
            ['longText', 'InputTextarea', 'Long text', 'panel']
        ]);

        // asked for from the gallery: it waits for a second person, and takes no requests meanwhile
        await page.goto('/dynamic-template/saved-templates');
        // the gallery shows it by its Amharic name (the page's language)
        await page.getByRole('button', { name: `Publish ቅጽ ${name}` }).click();
        // its labels were written in one language: publishing warns, and goes on when confirmed
        const warning = page.getByRole('alertdialog');
        await expect(warning).toContainText('no Amharic or English text');
        await warning.getByRole('button', { name: 'Publish anyway' }).click();
        await expect(page.getByText('Sent for approval').first()).toBeVisible();
        const filler = await signedIn(browser, PEOPLE.filler);
        await filler.goto(`/submitted-forms/template/${formId}`);
        await expect(filler.getByRole('button', { name: 'New request' })).toBeDisabled();
        const asked = await author.get<{ items: { formId: string; canDecide: boolean }[] }>(
            `v1/form-publications?formId=${formId}`
        );
        expect(asked.items).toHaveLength(1);
        // the author never decides their own request
        expect(asked.items[0]?.canDecide).toBe(false);

        // the zone's head approves it in the inbox
        const checker = await signedIn(browser, PEOPLE.approver);
        await checker.goto('/approvals');
        const row = checker.locator('[data-approval]').filter({ hasText: name });
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: 'Review' }).click();
        const sheet = checker.getByRole('dialog');
        await expect(sheet).toContainText('Publishing a form');
        await sheet.getByRole('button', { name: /approve/i }).click();
        await expect(sheet).toBeHidden();
        expect((await author.get<FormOut>(`v1/forms/${formId}`)).status).toBe('published');

        // published: the woreda's records officer fills it in
        await filler.reload();
        await filler.getByRole('button', { name: 'New request' }).click();
        const dialog = filler.getByRole('dialog');
        await expect(dialog.getByText('Full name')).toBeVisible();
        await expect(dialog.getByText('Office type')).toBeVisible();
    } finally {
        if (formId) await switchOff(author, formId);
    }
});
