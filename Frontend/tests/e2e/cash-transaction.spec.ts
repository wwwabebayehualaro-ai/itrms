// The cash form (a form built with the engine) + its server action (coded posting): a teller types an account number, the account
// is looked up and its details fill in, the deposit posts and the reference is shown; above the limit a supervisor approves.
// Needs the cash demo: node scripts/e2e/cash-transaction/seed.cjs (accounts, teller@ / supervisor@, the form).
import { expect, test, type Page } from '@playwright/test';
import { apiAs, login, templateId } from './support';

const TELLER = 'teller@acme-corp.org';
const SUPERVISOR = 'supervisor@acme-corp.org';
const FORM = 'Cash deposit / withdrawal';

async function openNew(page: Page, formId: string) {
    await page.goto(`/submitted-forms/template/${formId}`);
    await page.getByRole('button', { name: 'New request' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-engine="v2"]')).toBeVisible();
    return dialog;
}

test('a teller looks up the account, and a deposit posts with the request', async ({ page, request }) => {
    const teller = await apiAs(request, TELLER);
    const formId = await templateId(teller, FORM);
    const before = (await teller.get('/core-banking/accounts/1000000000001')).available_balance;

    await login(page, TELLER);
    const dialog = await openNew(page, formId);
    const number = dialog.getByLabel('Account number');

    // a wrong number: the lookup's verdict is shown on the field, and the amount stays closed
    await number.fill('9999999999999');
    await expect(dialog.getByText('Account not found')).toBeVisible();
    await expect(dialog.getByLabel('Amount')).toBeDisabled();

    // the right one: verified, details filled in
    await number.fill('1000000000001');
    await expect(dialog.locator('[data-remote="verified"]')).toBeVisible();
    await expect(dialog.getByLabel('Account holder')).toHaveValue('Abebe Kebede');
    await expect(dialog.getByLabel('Status')).toHaveValue('ACTIVE');
    await expect(dialog.getByLabel('Currency')).toHaveValue('ETB');

    await dialog.getByLabel('Amount').fill('1500');
    await dialog.getByLabel('Narration').fill('Cash deposit (e2e)');
    await dialog.getByLabel('Depositor name').fill('Abebe Kebede');
    await expect(dialog.getByLabel('Balance after this transaction')).toHaveValue(/\d/);
    await page.screenshot({ path: 'test-results/cash-filled.png' });
    await dialog.getByRole('button', { name: /Submit/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Posted: TXN-\d{4}-\d{6}/)).toBeVisible();

    expect((await teller.get('/core-banking/accounts/1000000000001')).available_balance).toBe(before + 1500);
});

test('a withdrawal above the limit waits for a supervisor, then posts', async ({ browser, page, request }) => {
    const teller = await apiAs(request, TELLER);
    const formId = await templateId(teller, FORM);
    const before = (await teller.get('/core-banking/accounts/1000000000006')).available_balance;

    await login(page, TELLER);
    const dialog = await openNew(page, formId);
    await dialog.getByLabel('Account number').fill('1000000000006');
    await expect(dialog.getByLabel('Account holder')).toHaveValue('Meron Haile');
    await dialog.getByRole('radio', { name: 'Withdrawal' }).click();
    await expect(dialog.getByLabel('Depositor name')).toBeHidden();
    await dialog.getByLabel('Amount').fill('150000');
    await dialog.getByLabel('Narration').fill('Large withdrawal (e2e)');
    await dialog.getByRole('button', { name: /Submit/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Awaiting approval: TXN-/)).toBeVisible();
    expect((await teller.get('/core-banking/accounts/1000000000006')).available_balance).toBe(before); // not posted yet

    const supervisor = await apiAs(request, SUPERVISOR);
    const pending = (await supervisor.get('/platform/approvals?scope=to_decide')).items.find((a: { title: string }) => a.title.includes('1000000000006'));
    expect(pending).toBeTruthy();
    const checker = await (await browser.newContext()).newPage();
    await login(checker, SUPERVISOR);
    await checker.goto('/approvals');
    await checker.locator(`[data-approval="${pending.id}"]`).getByRole('button', { name: 'Review' }).click();
    const sheet = checker.getByRole('dialog');
    await expect(sheet).toContainText('Post a teller transaction above the limit');
    await checker.screenshot({ path: 'test-results/cash-approval.png' });
    await sheet.getByRole('button', { name: /approve/i }).click();
    await expect(sheet).toBeHidden();

    expect((await teller.get('/core-banking/accounts/1000000000006')).available_balance).toBe(before - 150000);
    const mine = await teller.get(`/form/submissions?template_id=${formId}&mine=true&sort=-created_at`);
    expect(mine.items[0]).toMatchObject({ status: 'completed', submission_data: { postingStatus: 'Posted', accountNumber: '1000000000006' } });
});
