// Read-only smoke test: every main screen renders without a page error. Writes nothing, so it is safe on any database
// (E2E_API=... npm run e2e -- smoke). Screenshots land in test-results/smoke-*.png.
import { expect, test } from '@playwright/test';
import { apiAs, login } from './support';

test('every main screen renders without errors', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const api = await apiAs(request);
    const templates: { id: string; name: string; status: string; category?: string | null }[] = await api.get(
        '/template/forms/templates?limit=500'
    );
    const form = templates.find((t) => t.status === 'published' && t.category !== 'Views');
    expect(form, 'at least one published form').toBeTruthy();
    const requests = await api.get(`/form/submissions?template_id=${form!.id}&page_size=1`);

    await login(page);
    const visit = async (path: string, name: string, ready: () => Promise<void>) => {
        await page.goto(path);
        await ready();
        await page.screenshot({ path: `test-results/smoke-${name}.png`, fullPage: true });
    };

    await visit('/', 'dashboard', async () => {
        await expect(page.locator('[data-slot="sidebar"]')).toContainText('Template Builder');
        await expect(page.locator('[data-stat="Published forms"]')).toContainText(/\d/);
    });
    await visit('/submitted-forms/filter/recent', 'recent', () =>
        expect(page.locator('[data-requests-list] [data-request-link]').first()).toBeVisible()
    );
    await visit('/dynamic-template/saved-templates', 'templates', () =>
        expect(page.locator('[data-template-status]').first()).toBeVisible()
    );
    await visit('/dynamic-template/builder', 'builder', () => expect(page.locator('[data-designer]')).toBeVisible());
    await visit(`/submitted-forms/template/${form!.id}`, 'requests', () =>
        expect(page.locator('[data-viewer]')).toBeVisible()
    );
    if (requests.items?.length) {
        await visit(`/submitted-forms/template/${form!.id}/${requests.items[0].id}`, 'record', () =>
            expect(page.locator('[data-record-page]')).toBeVisible()
        );
    }
    await visit('/approvals', 'approvals', () =>
        expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible()
    );
    await visit('/admin/feature-flags', 'feature-flags', () =>
        expect(page.locator('[data-flag="module.platform"]')).toBeVisible()
    );
    await visit('/admin/sequences', 'sequences', () =>
        expect(page.getByRole('heading', { name: 'Document numbers' })).toBeVisible()
    );

    expect(errors, 'uncaught page errors').toEqual([]);
});

test('on a phone the menu opens from the top bar and closes on an outside click', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const menu = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    await expect(menu).toHaveCount(0);
    await page.locator('[data-app-topbar]').getByRole('button', { name: 'Menu' }).click();
    await expect(menu).toBeVisible();
    await page.mouse.click(380, 600); // outside the menu
    await expect(menu).toHaveCount(0);
    // a navigation closes it too
    await page.locator('[data-app-topbar]').getByRole('button', { name: 'Menu' }).click();
    await menu.getByRole('link', { name: 'Approvals' }).click();
    await expect(page).toHaveURL(/\/approvals/);
    await expect(menu).toHaveCount(0);
    // the page fits the phone: no sideways scrolling
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ).toBeLessThanOrEqual(0);
});
