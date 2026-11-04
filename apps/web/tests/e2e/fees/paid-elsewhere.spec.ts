/**
 * Paid elsewhere (task 0.22c, ADR-0043): a service whose fee a revenue office collects. Boditi's records officer files the
 * request; the case waits for its payment. The same officer opens the order from the queue of orders paid elsewhere and
 * enters the receipt: the case still waits, because nobody has verified it. The zone's finance officer sees it among the
 * references to verify and verifies it, and the case moves on.
 *
 * The setup the journey does not show goes through the API, as in the counter's journey: the service's workflow, its request
 * form with the Fee field, and the version published by the bureau with the region's approved demo fee rule.
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';
import { PEOPLE, signedIn } from '../workflow/support';

/** Demo accounts of apps/api/seed/users/wolaita.demo.yaml (generated people, never real ones). */
const BODITI_RECORDS = { id: '0199f0a0-d000-7000-8000-000000000302', username: 'demo.boditi.records' };
const ZONE_FINANCE = { id: '0199f0a0-d000-7000-8000-000000000108', username: 'demo.zone.finance' };

async function personSignedIn(browser: Browser, who: { id: string; username: string }): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

/** A service no other journey uses. */
const SERVICE = 'RS-07';
const RULE_KEY = 'dvc-03-new-licence';

const t = (text: string) => ({ am: text, en: text });

const FORM = {
    schemaVersion: 2,
    fields: [
        {
            id: 'plate',
            type: 'InputText',
            label: 'Plate',
            category: 'Input',
            props: { required: true },
            data: { defaultProps: {} },
            behavior: { validation: { supported: true } },
            layout: { options: { isContainer: false } },
            classification: 'personal'
        },
        {
            id: 'grade',
            type: 'Dropdown',
            label: 'Grade',
            category: 'Input',
            props: {
                required: true,
                options: [
                    { label: 'Automobile', value: 'automobile' },
                    { label: 'Public 1', value: 'public-1' }
                ]
            },
            data: { defaultProps: {} },
            behavior: { validation: { supported: true } },
            layout: { options: { isContainer: false } },
            classification: 'personal'
        },
        { id: 'fee', type: 'Fee', category: 'Data', label: 'Fee', props: { showLines: true } }
    ]
};

const WORKFLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        { key: 'payment', kind: 'wait', label: t('Payment') },
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'payment', action: 'submit', effects: ['fees.createPaymentOrder'] },
        { from: 'payment', to: 'done', on: 'event:payment.settled', actor: 'system:fees' }
    ]
};

/** Birr text of an amount in santim ("55000" → "550.00"), by digits: never through a number. */
const birr = (santim: string) => {
    const digits = santim.padStart(3, '0');
    return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

test('a fee paid at a revenue office settles only once another person verifies its receipt', async ({ browser }) => {
    test.setTimeout(420_000);
    const bureauPage = await signedIn(browser, PEOPLE.bureau);
    const bureau = api(bureauPage);
    const { items: rules } = await bureau.get<{
        items: { key: string; latestVersion: { id: string; status: string } | null }[];
    }>('v1/fee-rules');
    const rule = rules.find((r) => r.key === RULE_KEY)?.latestVersion;
    // CI seeds it (ci.yml); a local stack without the seed skips the journey
    test.skip(
        rule?.status !== 'approved' && !process.env.CI,
        `the demo fee rule ${RULE_KEY} is not seeded and approved (pnpm seed:fees)`
    );
    expect(rule?.status, `the demo fee rule ${RULE_KEY} is seeded and approved`).toBe('approved');

    const suffix = randomUUID().slice(0, 6);
    const form = await bureau.post<{ id: string }>('v1/forms', {
        key: `e2e-elsewhere-${suffix}`,
        name: t(`Licence request ${suffix}`),
        document: FORM
    });
    const asked = await bureau.post<{ id: string; version: number; formVersion: { id: string } }>(
        `v1/forms/${form.id}/publications`
    );
    const head = api(await signedIn(browser, PEOPLE.bureauHead));
    await head.post(`v1/form-publications/${asked.id}/approval`, {}, asked.version);
    const workflow = await bureau.post<{ latestVersion: { id: string } }>('v1/workflow-definitions', {
        key: `e2e-elsewhere-${suffix}`,
        name: t(`Elsewhere ${suffix}`),
        definition: WORKFLOW
    });
    await bureau.post(`v1/services/${SERVICE}/versions`, {
        workflowVersionId: workflow.latestVersion.id,
        formVersionId: asked.formVersion.id,
        feeRuleVersionId: rule?.id,
        defaults: { 'payment.collection': 'elsewhere' },
        overridePolicy: {}
    });

    // filed at the counter: the case waits for its payment
    const records = await personSignedIn(browser, BODITI_RECORDS);
    await records.locator('[data-app-sidebar] [data-menu-item="services.request"]').click();
    await records.getByLabel('አገልግሎት').click();
    await records.getByRole('option', { name: new RegExp(`^${SERVICE}`) }).click();
    const request = records.locator(`[data-request-form="${SERVICE}"]`);
    await request.getByLabel('Plate').fill('ETH ABC 0002');
    await request.getByRole('combobox', { name: 'Grade' }).click();
    await records.getByRole('option', { name: 'Automobile' }).click();
    await expect(request.locator('[data-field-fee]')).toContainText(/\d[\d,]*\.\d{2}/);
    await request.getByRole('button', { name: 'ጥያቄውን ጀምር' }).click();
    await expect(records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    const caseId = records.url().split('/').pop() ?? '';
    await records.locator('[data-actions] [data-action="submit"]').click();
    await records.locator('[data-action-dialog="submit"]').getByRole('button', { name: 'submit' }).click();
    await expect(records.locator('[data-screen="case"][data-state="payment"]')).toBeVisible();
    const filed = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);

    // the queue of orders paid elsewhere, the order, the receipt the applicant brought back
    await records.locator('[data-app-sidebar] [data-menu-item="fees.elsewhere"]').click();
    await expect(records).toHaveURL(/\/paid-elsewhere$/);
    const row = records.locator(`[data-queue] [data-case-number="${filed.number}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'ክፈት' }).click();
    const order = records.locator('[data-screen="payment-order"]');
    await expect(order).toHaveAttribute('data-state', 'open');
    const total = await order.locator('[data-total]').getAttribute('data-total');
    expect(total).toMatch(/^\d+$/);
    const reference = `E2E-${suffix.toUpperCase()}`;
    const entry = records.locator('[data-external-form]');
    await entry.getByRole('combobox', { name: 'የተከፈለበት', exact: true }).click();
    await records.getByRole('option', { name: 'የገቢዎች ጽ/ቤት' }).click();
    await entry.getByLabel('የደረሰኝ ወይም የማጣቀሻ ቁጥር').fill(reference);
    await entry.locator('#external-amount').fill(birr(total ?? ''));
    await entry.locator('#external-paid-on').click();
    await records.locator('[data-day][aria-current="date"]').click();
    await entry.getByLabel('የከፈለው').fill('Generated Applicant');
    await records.locator('[data-action="enter-reference"]').click();

    // entered, not paid
    await expect(records.locator('[data-external-refs] [data-state="pending_verification"]')).toBeVisible();
    await expect(records.locator('[data-external-form]')).toHaveCount(0);
    await expect(order).toHaveAttribute('data-state', 'open');

    // the zone's finance officer verifies it
    const finance = await personSignedIn(browser, ZONE_FINANCE);
    await finance.locator('[data-app-sidebar] [data-menu-item="fees.externalRefs"]').click();
    await expect(finance).toHaveURL(/\/finance\/external-payments$/);
    const waiting = finance.locator(`[data-external-inbox] [data-reference="${reference}"]`);
    await expect(waiting).toBeVisible();
    await waiting.locator('[data-action="verify"]').click();
    await finance.locator('[data-decision-dialog="verified"]').getByRole('button', { name: 'አረጋግጥ' }).click();
    await expect(waiting).toHaveCount(0);

    // the case goes on, and shows whose receipt paid it
    await records.goto(`/cases/${caseId}`);
    await expect(records.locator('[data-case-payment]')).toHaveAttribute('data-state', 'settled');
    await expect(records.locator('[data-screen="case"]')).toHaveAttribute('data-state', 'done');
});
