/**
 * The counter and the cashier (task 0.22b, ADR-0042): Boditi's records officer opens the request screen of a service
 * that charges a fee, sees the fee preview and files the request; the case waits for its payment. Boditi's cashier opens
 * the queue, the payment order, records the cash with the exact amount and gets the receipt, numbered by the office
 * (`WOL-BODITI/…`). The case page shows the receipt and the case is done, moved on by the payment.
 *
 * The setup the journey does not show goes through the API: the service's workflow (a `wait` left by
 * `event:payment.settled`), its request form with the Fee field, and the version published by the bureau with the
 * region's approved fee rule. A fee rule is approved by a second person at the region's root; the demo accounts have no
 * such second person, so the journey uses the demo rule the installation seeds (`pnpm seed:fees`, then
 * `pnpm seed:counters` for the office's receipt counter) and skips when it is not there.
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';
import { PEOPLE, signedIn } from '../workflow/support';

/** Boditi town (ፈርጅ 1), demo accounts of apps/api/seed/users/wolaita.demo.yaml (generated people, never real ones). */
const BODITI = {
    records: {
        id: '0199f0a0-d000-7000-8000-000000000302',
        username: 'demo.boditi.records',
        name: 'Boditi Records Officer (demo)'
    },
    cashier: {
        id: '0199f0a0-d000-7000-8000-000000000303',
        username: 'demo.boditi.cashier',
        name: 'Boditi Revenue Collector (demo)'
    }
} as const;

/** A browser of its own for a Boditi person, signed in through Keycloak (its second factor set up anew). */
async function boditiSignedIn(browser: Browser, who: { id: string; username: string }): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

/** A service no other journey uses (the inbox, case page, services and requests journeys use RS-02 to RS-05). */
const SERVICE = 'RS-06';
/** The seeded demo rule of the new driver licence: a table by `grade`, plus fixed lines (modules/competency/seed). */
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

/** A request filed, then waiting for its payment, and one that moves on when it is paid. */
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

test('a fee is filed at the counter, paid at the till and receipted, and the case goes on', async ({ browser }) => {
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

    // the service: its form (approved by a second person), its workflow, its version with the rule
    const suffix = randomUUID().slice(0, 6);
    const form = await bureau.post<{ id: string }>('v1/forms', {
        key: `e2e-counter-${suffix}`,
        name: t(`Licence request ${suffix}`),
        document: FORM
    });
    const asked = await bureau.post<{ id: string; version: number; formVersion: { id: string } }>(
        `v1/forms/${form.id}/publications`
    );
    const head = api(await signedIn(browser, PEOPLE.bureauHead));
    await head.post(`v1/form-publications/${asked.id}/approval`, {}, asked.version);
    const workflow = await bureau.post<{ latestVersion: { id: string } }>('v1/workflow-definitions', {
        key: `e2e-counter-${suffix}`,
        name: t(`Counter ${suffix}`),
        definition: WORKFLOW
    });
    await bureau.post(`v1/services/${SERVICE}/versions`, {
        workflowVersionId: workflow.latestVersion.id,
        formVersionId: asked.formVersion.id,
        feeRuleVersionId: rule?.id,
        overridePolicy: {}
    });

    // the counter: the request screen shows the fee while the form is filled in; filing starts the case
    const records = await boditiSignedIn(browser, BODITI.records);
    await records.locator('[data-app-sidebar] [data-menu-item="services.request"]').click();
    await records.getByLabel('አገልግሎት').click();
    await records.getByRole('option', { name: new RegExp(`^${SERVICE}`) }).click();
    const request = records.locator(`[data-request-form="${SERVICE}"]`);
    await request.getByLabel('Plate').fill('ETH ABC 0001');
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

    // the till: the queue, the order, the payment of the exact total
    const cashierPage = await boditiSignedIn(browser, BODITI.cashier);
    await cashierPage.locator('[data-app-sidebar] [data-menu-item="fees.cashier"]').click();
    await expect(cashierPage).toHaveURL(/\/cashier$/);
    const row = cashierPage.locator(`[data-queue] [data-case-number="${filed.number}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'ክፈት' }).click();
    const order = cashierPage.locator('[data-screen="payment-order"]');
    await expect(order).toHaveAttribute('data-state', 'open');
    const total = await order.locator('[data-total]').getAttribute('data-total');
    expect(total).toMatch(/^\d+$/);
    await cashierPage.locator('[data-payment-form] #payment-amount').fill(birr(total ?? ''));
    await cashierPage.getByLabel('ከፋዩ').fill('Generated Applicant');
    await cashierPage.locator('[data-action="record-payment"]').click();

    // the receipt, numbered by the office
    await expect(cashierPage).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
    const number = cashierPage.locator('[data-receipt-number]');
    await expect(number).toContainText(/WOL-BODITI\/\d{6}\/\d{4}/);
    const receiptNumber = /WOL-BODITI\/\d{6}\/\d{4}/.exec((await number.textContent()) ?? '')?.[0] ?? '';

    // the case: the receipt shown, and the payment moved it on
    await records.goto(`/cases/${caseId}`);
    const panel = records.locator('[data-case-payment]');
    await expect(panel).toHaveAttribute('data-state', 'settled');
    await expect(panel.locator('[data-case-receipts]')).toContainText(receiptNumber);
    await expect(records.locator('[data-screen="case"]')).toHaveAttribute('data-state', 'done');

    // the receipt's document, its PDF made by the PDF worker: it opens, and it is the stored one
    const receiptDocument = records.locator('[data-case-documents] [data-document="receipt"]');
    await expect(receiptDocument).toHaveAttribute('data-state', 'rendered', { timeout: 90_000 });
    const { items } = await api(records).get<{ items: { id: string; templateKey: string }[] }>(
        `v1/issued-documents?caseId=${caseId}`
    );
    const issued = items.find((d) => d.templateKey === 'receipt');
    const link = await api(records).get<{ url: string }>(`v1/issued-documents/${issued?.id ?? ''}/download`);
    const pdf = await records.request.get(link.url);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
