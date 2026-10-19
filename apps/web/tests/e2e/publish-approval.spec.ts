// Maker-checker on the forms path: with approvals required, an editor's publish waits for an admin's approval; meanwhile the form
// cannot take requests. Runs on the demo data (Maria Santos is an editor, the admin approves).
import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD, apiAs, login } from './support';

const EDITOR = process.env.E2E_EDITOR || 'maria.santos@acme-corp.org';

test('an editor publishes, an admin approves, then the form takes requests', async ({ browser, request }) => {
    const admin = await apiAs(request);
    const editor = await apiAs(request, EDITOR);
    expect((await admin.put('/platform/flags/forms.require_approval', { enabled: true })).ok()).toBeTruthy();
    const name = `Travel Request ${Date.now()}`;
    const created = await (
        await editor.post('/template/forms/templates', {
            name,
            form_config: { fields: [{ id: 'destination', type: 'InputText', label: 'Destination' }] },
            file_relations: []
        })
    ).json();
    expect(created.status).toBe('draft');

    try {
        // the editor publishes from the template gallery
        const makerPage = await (await browser.newContext()).newPage();
        await login(makerPage, EDITOR);
        await makerPage.goto('/dynamic-template/saved-templates');
        await makerPage.getByRole('button', { name: `Publish ${name}` }).click();
        await expect(makerPage.getByText('Sent for approval').first()).toBeVisible();
        await expect(makerPage.locator('[data-template-status="pending_approval"]').first()).toBeVisible();

        // not published yet: no new requests
        await makerPage.goto(`/submitted-forms/template/${created.id}`);
        await expect(makerPage.getByRole('button', { name: 'New request' })).toBeDisabled();

        // the editor cannot decide their own request; the admin approves it in the inbox
        const pending = (await editor.get('/platform/approvals?scope=mine')).items.find(
            (a: { resource_id: string }) => a.resource_id === created.id
        );
        expect(pending.can_decide).toBe(false);

        const checkerPage = await (await browser.newContext()).newPage();
        await login(checkerPage, ADMIN);
        await checkerPage.goto('/approvals');
        const row = checkerPage.locator(`[data-approval="${pending.id}"]`);
        await expect(row).toContainText(name);
        await row.getByRole('button', { name: 'Review' }).click();
        const sheet = checkerPage.getByRole('dialog');
        await expect(sheet).toContainText('Publish a form');
        await checkerPage.screenshot({ path: 'test-results/approval-review.png' });
        await sheet.getByRole('button', { name: /approve/i }).click();
        await expect(sheet).toBeHidden();

        const after = await editor.get(`/template/forms/templates/${created.id}`);
        expect(after.status).toBe('published');

        // published: the editor can now fill it in
        await makerPage.reload();
        await expect(makerPage.getByRole('button', { name: 'New request' })).toBeEnabled();
        await makerPage.getByRole('button', { name: 'New request' }).click();
        await expect(makerPage.getByRole('dialog').getByText('Destination')).toBeVisible();
    } finally {
        await admin.put('/platform/flags/forms.require_approval', { enabled: null });
        await request.delete(
            `${process.env.E2E_API || 'http://localhost:8000'}/template/forms/templates/${created.id}`,
            {
                headers: {
                    Authorization: `Bearer ${(await (await request.post(`${process.env.E2E_API || 'http://localhost:8000'}/auth/login`, { data: { email: ADMIN, password: PASSWORD } })).json()).access_token}`
                }
            }
        );
    }
});
