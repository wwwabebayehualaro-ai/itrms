/**
 * The service catalogue on the screens (task 0.21c): the bureau opens a service from the menu and publishes a version
 * (the region's workflow and request form); the zone's administrator changes a woreda's time limit for a step (an office
 * never changes its own); Damot Gale's records officer files a request at the counter, the service's form filled in,
 * and lands on its case. The setup the journey does not show (the workflow, the form and its approval) goes through the
 * API; each run cleans up the woreda's change, so the journey repeats on the same database.
 */
import { expect, test, type Page } from '@playwright/test';

import { api, field, publishedForm, runName, type Api } from './forms/support';
import { journeyWorkflow, PEOPLE, signedIn } from './workflow/support';

/** A road-safety service no other journey uses: its versions pile up run after run, harmlessly. */
const SERVICE = 'RS-04';

/** Damot Gale's own changes of the service, left from an earlier run, removed (by the zone above it). */
async function resetDamot(zone: Api, damotId: string) {
    const config = await zone
        .get<{ own: { version: number } | null } | undefined>(
            `v1/org-units/${damotId}/services/${SERVICE}/configuration`
        )
        .catch(() => undefined);
    if (config?.own) await zone.delete(`v1/org-units/${damotId}/services/${SERVICE}/override`, config.own.version);
}

const unitOf = async (page: Page, code: string) => {
    const units = (await (await page.request.get('/api/v1/me/workspace')).json()) as {
        activeUnit: { id: string };
    };
    const subtree = (await (await page.request.get(`/api/v1/org-units/${units.activeUnit.id}/subtree`)).json()) as {
        id: string;
        code: string;
    }[];
    const found = subtree.find((u) => u.code === code);
    if (!found) throw new Error(`no unit ${code}`);
    return found.id;
};

test('the bureau publishes a version, the zone changes a woreda’s time limit, the woreda files a request', async ({
    browser
}) => {
    test.setTimeout(300_000);
    const bureauPage = await signedIn(browser, PEOPLE.bureau);
    const bureau = api(bureauPage);
    const workflowId = await journeyWorkflow(bureau, 'services');
    const formName = runName('Road safety report');
    await publishedForm(bureau, api(await signedIn(browser, PEOPLE.bureauHead)), formName, [
        field('InputText', 'plate', 'Plate', { props: { required: true } })
    ]);
    const workflow = await bureau.get<{ name: { am: string }; latestVersion: { number: number } }>(
        `v1/workflow-definitions/${workflowId}`
    );

    // the bureau: the catalogue from the menu, the service, a version published
    await bureauPage.locator('[data-app-sidebar] [data-menu-item="services.catalogue"]').click();
    await expect(bureauPage.getByRole('heading', { name: 'አገልግሎቶች' })).toBeVisible();
    await bureauPage.locator(`[data-service="${SERVICE}"]`).getByRole('link', { name: 'ክፈት' }).click();
    const publish = bureauPage.locator('[data-section="publish"]');
    await publish.getByLabel('የሥራ ፍሰት').click();
    await bureauPage
        .getByRole('option', { name: new RegExp(workflow.name.am.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
        .click();
    await publish.getByLabel('የጥያቄ ቅጽ').click();
    await bureauPage.getByRole('option', { name: new RegExp(formName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await publish.getByRole('button', { name: 'አትም' }).click();
    await expect(bureauPage.locator('[data-versions] li').first()).toBeVisible();

    // the zone: Damot Gale's time limit for the review, three working days
    const zonePage = await signedIn(browser, PEOPLE.author);
    const zone = api(zonePage);
    const damotId = await unitOf(zonePage, 'WOL-DAMOT-GALE');
    await resetDamot(zone, damotId);
    await zonePage.goto(`/services/${SERVICE}`);
    const override = zonePage.locator('[data-section="override"]');
    await override.getByLabel('ጽ/ቤት').click();
    await zonePage.getByRole('option', { name: 'ዳሞት ጋሌ' }).click();
    const review = override.locator('[data-config-key="sla.review"]');
    await review.getByRole('button', { name: 'ቀይር' }).click();
    const dialog = zonePage.getByRole('dialog');
    await dialog.getByLabel('መጠን').fill('3');
    await dialog.getByLabel('የሥራ ሰዓት').click();
    await zonePage.getByRole('option', { name: 'የሥራ ቀን' }).click();
    await dialog.getByLabel('ምክንያት').fill('a woreda with one officer');
    await dialog.getByRole('button', { name: 'አስቀምጥ' }).click();
    await expect(review.locator('[data-value]')).toHaveText('3 የሥራ ቀን');
    await expect(review.locator('[data-source]')).toHaveText('ዳሞት ጋሌ');

    // the woreda: a request at the counter, its form filled in, its case
    const records = await signedIn(browser, PEOPLE.records);
    await records.locator('[data-app-sidebar] [data-menu-item="services.request"]').click();
    await records.getByLabel('አገልግሎት').click();
    await records.getByRole('option', { name: new RegExp(`^${SERVICE}`) }).click();
    const form = records.locator(`[data-request-form="${SERVICE}"]`);
    await form.getByLabel('Plate').fill('ETH ABC 0001');
    await form.getByRole('button', { name: 'ጥያቄውን ጀምር' }).click();
    await expect(records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    await expect(records.locator('[data-actions] [data-action="submit"]')).toBeVisible();

    await resetDamot(zone, damotId);
});
