/**
 * The cashier's day (task 1.12, ADR-0063): Boditi's cashier takes a fee at the till (the first payment of the day opens the
 * session if none is open), counts the till one Birr short, is told to explain the difference, and sends the count; the zone's
 * finance officer approves it in the closings inbox and the session is closed.
 *
 * The three e2e shards share the demo users, so the journey never assumes a fresh session: it reads what the screen says
 * (the session bar, the figure the till should hold) and opens a session explicitly only when none is open today.
 *
 * The setup goes through the API as the counter journey's does: a service whose request waits for its payment, filed with the
 * region's seeded demo fee rule (`pnpm seed:fees`, `pnpm seed:counters`); the journey skips when the rule is not there.
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { payAtTheTill } from '../competency/support';
import { api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';
import { PEOPLE, signedIn } from '../workflow/support';

const BODITI = {
    records: { id: '0199f0a0-d000-7000-8000-000000000302', username: 'demo.boditi.records' },
    cashier: { id: '0199f0a0-d000-7000-8000-000000000303', username: 'demo.boditi.cashier' }
} as const;
const ZONE_FINANCE = { id: '0199f0a0-d000-7000-8000-000000000108', username: 'demo.zone.finance' };

/** The counter journey's service: the one with a fee form and a workflow that waits for the payment. */
const SERVICE = 'RS-06';
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
const birr = (santim: bigint) => {
    const digits = santim.toString().padStart(3, '0');
    return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

async function person(browser: Browser, who: { id: string; username: string }): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

test('the cashier counts the till one Birr short, the finance officer approves, and the session closes', async ({
    browser
}) => {
    test.setTimeout(420_000);
    const bureauPage = await signedIn(browser, PEOPLE.bureau);
    const bureau = api(bureauPage);
    const { items: rules } = await bureau.get<{
        items: { key: string; latestVersion: { id: string; status: string } | null }[];
    }>('v1/fee-rules');
    const rule = rules.find((r) => r.key === RULE_KEY)?.latestVersion;
    test.skip(
        rule?.status !== 'approved' && !process.env.CI,
        `the demo fee rule ${RULE_KEY} is not seeded and approved (pnpm seed:fees)`
    );
    expect(rule?.status, `the demo fee rule ${RULE_KEY} is seeded and approved`).toBe('approved');

    // the service and a request waiting for its payment
    const suffix = randomUUID().slice(0, 6);
    const form = await bureau.post<{ id: string }>('v1/forms', {
        key: `e2e-day-${suffix}`,
        name: t(`Cashier day ${suffix}`),
        document: FORM
    });
    const asked = await bureau.post<{ id: string; version: number; formVersion: { id: string } }>(
        `v1/forms/${form.id}/publications`
    );
    const head = api(await signedIn(browser, PEOPLE.bureauHead));
    await head.post(`v1/form-publications/${asked.id}/approval`, {}, asked.version);
    const workflow = await bureau.post<{ latestVersion: { id: string } }>('v1/workflow-definitions', {
        key: `e2e-day-${suffix}`,
        name: t(`Cashier day ${suffix}`),
        definition: WORKFLOW
    });
    await bureau.post(`v1/services/${SERVICE}/versions`, {
        workflowVersionId: workflow.latestVersion.id,
        formVersionId: asked.formVersion.id,
        feeRuleVersionId: rule?.id,
        overridePolicy: {}
    });
    const recordsPage = await person(browser, BODITI.records);
    const records = api(recordsPage);
    const answers = { plate: 'ETH ABC 0002', grade: 'automobile' };
    const shown = await records.post<{ feeRuleVersionId: string; totalSantim: string }>('v1/fees/preview', {
        serviceCode: SERVICE,
        answers
    });
    const started = await records.post<{ id: string; version: number; number: number }>('v1/service-requests', {
        serviceCode: SERVICE,
        answers,
        fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
    });
    await records.post(`v1/cases/${started.id}/transitions`, { action: 'submit' }, started.version);

    // the till: open a session only when none is open today, then take the fee
    const cashier = await person(browser, BODITI.cashier);
    await cashier.goto('/cashier');
    const bar = cashier.locator('[data-session-bar]');
    await expect(bar).toBeVisible();
    if ((await bar.getAttribute('data-session-state')) !== 'open')
        await bar.locator('[data-action="open-session"]').click();
    await expect(bar).toHaveAttribute('data-session-state', 'open');
    await payAtTheTill(cashier, started.number);

    // the count: the figure the screen says the till should hold, one Birr (100 santim) less
    await cashier.goto('/cashier');
    await cashier.locator('[data-session-bar] [data-action="open-session-page"]').click();
    const session = cashier.locator('[data-screen="cashier-session"]');
    await expect(session).toHaveAttribute('data-state', 'open');
    const sessionId = cashier.url().split('/').pop() ?? '';
    const expected = BigInt((await session.getAttribute('data-expected')) ?? '0');
    expect(expected).toBeGreaterThan(100n);
    await cashier.locator('#count-total').fill(birr(expected - 100n));
    // a difference is explained: without a note the count is not sent
    await cashier.locator('[data-action="submit-count"]').click();
    await expect(cashier.locator('[data-count-form]')).toContainText('ልዩነቱን ያብራሩ');
    await expect(session).toHaveAttribute('data-state', 'open');
    await cashier.getByLabel('የልዩነቱ ማስታወሻ').fill('One Birr short in the till today');
    await cashier.locator('[data-action="submit-count"]').click();
    await expect(session).toHaveAttribute('data-state', 'pending_approval');
    await expect(cashier.locator('[data-counts] [data-count-state="pending"]')).toBeVisible();

    // the decision: the zone's finance officer approves it, never the cashier
    const finance = await person(browser, ZONE_FINANCE);
    await finance.locator('[data-app-sidebar] [data-menu-item="fees.closings"]').click();
    await expect(finance).toHaveURL(/\/finance\/closings$/);
    const row = finance.locator(`[data-closings] [data-closing="${sessionId}"]`);
    await expect(row).toBeVisible();
    await row.locator('[data-action="approve"]').click();
    await finance.locator('[data-decision-dialog="approve"] [data-action="confirm-decision"]').click();
    await expect(row).toHaveCount(0);

    // closed
    await cashier.reload();
    await expect(cashier.locator('[data-screen="cashier-session"]')).toHaveAttribute('data-state', 'closed');
});
