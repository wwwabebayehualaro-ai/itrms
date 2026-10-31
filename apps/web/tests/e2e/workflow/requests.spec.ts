/**
 * The office's requests (task 0.21e): Damot Gale's records officer files a request at the counter (through the API: the
 * setup the journey does not show), finds it among the waiting requests from the menu, opens its case and corrects the
 * request through its workflow: the request form filled in again, the change named on the timeline. Approved by the
 * office's head, it leaves the waiting list and heads the recent one.
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { field, publishedForm, runName } from '../forms/support';
import { PEOPLE, api, signedIn } from './support';

/** A road-safety service no other journey uses: its versions pile up run after run, harmlessly. */
const SERVICE = 'RS-05';

test('a request waits in the office’s list, is corrected through its case and moves to the recent ones', async ({
    browser
}) => {
    test.setTimeout(300_000);
    const bureau = api(await signedIn(browser, PEOPLE.bureau));
    const formName = runName('Plate request');
    const formId = await publishedForm(bureau, api(await signedIn(browser, PEOPLE.bureauHead)), formName, [
        field('InputText', 'plate', 'Plate', { props: { required: true } })
    ]);
    const form = await bureau.get<{ publishedVersion: { id: string } }>(`v1/forms/${formId}`);
    const workflow = await bureau.post<{ latestVersion: { id: string } }>('v1/workflow-definitions', {
        key: `e2e-requests-${randomUUID().slice(0, 6)}`,
        name: { am: 'የሙከራ ጥያቄዎች', en: 'Journey requests' },
        definition: {
            schemaVersion: 1,
            states: [
                { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
                {
                    key: 'review',
                    kind: 'task',
                    label: { am: 'ማጣራት', en: 'Review' },
                    assignee: { role: 'records_officer', unit: 'handling' }
                },
                {
                    key: 'approval',
                    kind: 'task',
                    label: { am: 'ማጽደቅ', en: 'Approval' },
                    assignee: { role: 'unit_head', unit: 'handling' }
                },
                { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
            ],
            transitions: [
                { from: 'draft', to: 'review', action: 'submit' },
                {
                    from: 'review',
                    to: 'review',
                    action: 'correct',
                    label: { am: 'ጥያቄውን አስተካክል', en: 'Correct the request' },
                    amendsRequest: true
                },
                { from: 'review', to: 'approval', action: 'forward', label: { am: 'አስተላልፍ', en: 'Forward' } },
                { from: 'approval', to: 'done', action: 'approve', label: { am: 'አጽድቅ', en: 'Approve' } }
            ]
        }
    });
    await bureau.post(`v1/services/${SERVICE}/versions`, {
        workflowVersionId: workflow.latestVersion.id,
        formVersionId: form.publishedVersion.id
    });

    const page = await signedIn(browser, PEOPLE.records);
    const records = api(page);
    const filed = await records.post<{ id: string; number: number; version: number }>('v1/service-requests', {
        serviceCode: SERVICE,
        answers: { plate: 'ETH ABC 0042' }
    });
    await records.post(`v1/cases/${filed.id}/transitions`, { action: 'submit' }, filed.version);

    // the waiting requests, from the menu: the one the officer filed, found by its number
    await page.locator('[data-app-sidebar] [data-menu-item="workflow.requests"]').click();
    await expect(page.getByRole('heading', { name: 'ጥያቄዎች' })).toBeVisible();
    await page.locator('[data-filter="mine"]').click();
    await page.getByLabel('የጉዳይ ቁጥር').fill(String(filed.number));
    await page.getByRole('button', { name: 'ፈልግ' }).click();
    const row = page.locator(`[data-requests="waiting"] [data-case="${filed.id}"]`);
    await expect(row).toHaveAttribute('data-state', 'review');
    await expect(row).toContainText(PEOPLE.records.name);
    await row.getByRole('link', { name: 'ክፈት' }).click();

    // the request corrected through its case: its form filled in again, the change on the timeline
    await expect(page.locator(`[data-screen="case"][data-case="${filed.id}"]`)).toBeVisible();
    await page.locator('[data-action="correct"]').click();
    const dialog = page.locator('[data-action-dialog="correct"]');
    const again = dialog.locator('[data-amends]');
    await expect(again.getByLabel('Plate')).toHaveValue('ETH ABC 0042');
    await again.getByLabel('Plate').fill('ETH ABC 0043');
    await again.getByRole('button', { name: 'ጥያቄውን አስተካክል' }).click();
    await expect(page.locator('[data-timeline] [data-amended="plate"]')).toContainText('ጥያቄውን ቀይሯል፦ Plate');
    await page.getByRole('tab', { name: 'የተሞሉ መረጃዎች' }).click();
    await expect(page.locator('[data-step="draft"]')).toContainText('ETH ABC 0043');

    // forwarded, then approved: no longer waiting, the first of the recent ones
    const now = await records.get<{ version: number }>(`v1/cases/${filed.id}`);
    await records.post(`v1/cases/${filed.id}/transitions`, { action: 'forward' }, now.version);
    const head = api(await signedIn(browser, PEOPLE.head));
    const forwarded = await head.get<{ version: number }>(`v1/cases/${filed.id}`);
    await head.post(`v1/cases/${filed.id}/transitions`, { action: 'approve' }, forwarded.version);
    await page.goto('/requests');
    await page.getByLabel('የጉዳይ ቁጥር').fill(String(filed.number));
    await page.getByRole('button', { name: 'ፈልግ' }).click();
    await expect(page.getByText('የሚጠብቅ ጥያቄ የለም')).toBeVisible();
    await page.locator('[data-list="recent"]').click();
    await expect(page.locator('[data-requests="recent"] tbody tr').first()).toHaveAttribute('data-case', filed.id);
});
