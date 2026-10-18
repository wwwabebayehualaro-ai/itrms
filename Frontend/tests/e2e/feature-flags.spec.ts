// Platform screen on the design system: an admin switches a module off, the menu and the API follow, then resets it.
import { expect, test } from '@playwright/test';
import { apiAs, login, SUBMITTER } from './support';

test('switching a module off hides it from the menu and its API, reset brings it back', async ({ page, request }) => {
    const admin = await apiAs(request);
    await admin.put('/platform/flags/module.form_submission', { enabled: null });
    await login(page);

    await page.goto('/admin/feature-flags');
    await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
    const row = page.locator('[data-flag="module.form_submission"]');
    await expect(row.getByRole('switch')).toBeChecked();
    await expect(page.locator('[data-flag="module.platform"]').getByRole('switch')).toBeDisabled();
    await page.screenshot({ path: 'test-results/feature-flags.png', fullPage: true });

    const group = (title: string) => page.locator(`[data-slot="sidebar"] [data-nav-group="${title}"]`);
    await expect(group('Submitted Forms')).toBeVisible();
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await expect(group('Submitted Forms')).toBeHidden();
    expect((await (await admin.post('/form/submissions/query', { template_id: '00000000-0000-0000-0000-000000000000' })).json()).code).toBe('feature_disabled');

    await row.getByRole('button', { name: /reset module.form_submission/i }).click();
    await expect(row.getByRole('switch')).toBeChecked();
    await expect(group('Submitted Forms')).toBeVisible();
});

test('a submitter sees neither the administration menu nor the flags', async ({ page, request }) => {
    const submitter = await apiAs(request, SUBMITTER);
    expect((await submitter.post('/platform/modules')).status()).toBe(405);
    await login(page, SUBMITTER);
    await expect(page.locator('[data-slot="sidebar"]').getByText('Templates Pool')).toBeVisible();
    await expect(page.locator('[data-slot="sidebar"] [data-nav-group="Administration"]')).toHaveCount(0);
});
