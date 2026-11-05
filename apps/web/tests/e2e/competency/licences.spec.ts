/**
 * Both licence services in a browser, end to end, as they are seeded (task 0.24c). Only the registry views are service-specific: the
 * request form, the case page, the till and the documents are the platform's. The worker's fake national platform answers by itself.
 *
 * Boditi's people act: the licensing expert enters the school's list, reviews and examines; the records officer files; the revenue
 * collector takes the fee; the team leader gives final approval. A renewal then runs on the licence the first journey made.
 */
import { randomInt } from 'node:crypto';

import { toEthiopian } from '@itrms/ethiopian-calendar';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';
import { PEOPLE, signedIn } from '../workflow/support';

/** Demo accounts of apps/api/seed/users/wolaita.demo.yaml (generated people, never real ones). */
const BODITI = {
    records: { id: '0199f0a0-d000-7000-8000-000000000302', username: 'demo.boditi.records' },
    cashier: { id: '0199f0a0-d000-7000-8000-000000000303', username: 'demo.boditi.cashier' },
    lead: { id: '0199f0a0-d000-7000-8000-000000000304', username: 'demo.boditi.lead' },
    officer: { id: '0199f0a0-d000-7000-8000-000000000305', username: 'demo.boditi.officer' }
} as const;

const FIELD = {
    applicant: 'አመልካች',
    grade: 'የፈቃድ ደረጃ',
    education: 'የተጠናቀቀ የትምህርት ክፍል',
    school: 'የማሰልጠኛ ተቋም',
    facility: 'የህክምና ተቋም',
    examined: 'የህክምና ምርመራ ቀን',
    licence: 'መንጃ ፈቃድ',
    expiry: 'ፈቃዱ የሚያበቃበት ቀን',
    heldOn: 'የፈተና ቀን',
    theory: 'የንድፈ ሀሳብ ውጤት',
    practical: 'የተግባር ውጤት',
    passed: 'አልፏል'
};
const SEARCH = 'ስም ወይም ቁጥር ይጻፉ…';
const AUTOMOBILE = 'አውቶሞቢል';
const FILE = 'ጥያቄውን ጀምር';

/** Letters only, of ones that don't fold into each other: a name a second run won't take for a duplicate. */
const LETTERS = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const generated = () => Array.from({ length: 5 }, () => LETTERS[randomInt(LETTERS.length)] ?? 'ለ').join('');

const birr = (santim: string) => {
    const digits = santim.padStart(3, '0');
    return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

interface People {
    records: Page;
    cashier: Page;
    lead: Page;
    officer: Page;
}

async function person(browser: Browser, who: { id: string; username: string }): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

async function pick(page: Page, within: Locator, label: string, search: string, option: string | RegExp) {
    await within.getByRole('combobox', { name: label }).click();
    await page.getByPlaceholder(SEARCH).fill(search);
    await page.getByRole('option', { name: option }).first().click();
}

async function today(page: Page, within: Locator, label: string) {
    await within.getByRole('button', { name: new RegExp(label) }).click();
    await page.locator('[role="grid"] [aria-current="date"]').click();
}

/** A step of a case, by its action and the name of the dialog's button. */
async function act(
    page: Page,
    caseId: string,
    action: string,
    button: string,
    fill?: (dialog: Locator) => Promise<void>
) {
    await page.goto(`/cases/${caseId}`);
    await page.locator(`[data-actions] [data-action="${action}"]`).click();
    const dialog = page.locator(`[data-action-dialog="${action}"]`);
    if (fill) await fill(dialog);
    await dialog.getByRole('button', { name: button, exact: true }).click();
    await expect(dialog).toBeHidden();
}

const inState = async (page: Page, caseId: string, state: string) => {
    await expect
        .poll(async () => (await api(page).get<{ state: string }>(`v1/cases/${caseId}`)).state, { timeout: 90_000 })
        .toBe(state);
};

async function payAtTheTill(page: Page, caseNumber: number) {
    await page.goto('/cashier');
    const row = page.locator(`[data-queue] [data-case-number="${caseNumber}"]`);
    await row.getByRole('link', { name: 'ክፈት' }).click();
    const order = page.locator('[data-screen="payment-order"]');
    const total = await order.locator('[data-total]').getAttribute('data-total');
    await page.locator('[data-payment-form] #payment-amount').fill(birr(total ?? ''));
    await page.getByLabel('ከፋዩ').fill('Generated Applicant');
    await page.locator('[data-action="record-payment"]').click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
}

test.describe.configure({ mode: 'serial' });

test.describe('the driver licence services', () => {
    let people: People;
    let personId: string;
    let holder: string;
    let number: string;
    let licenceId: string;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        people = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            lead: await person(browser, BODITI.lead),
            officer: await person(browser, BODITI.officer)
        };
    });

    test('a new licence, from the school’s list to a card and the print batch', async () => {
        test.setTimeout(420_000);
        const { records, cashier, lead, officer } = people;
        const staff = api(officer);

        // who the journey is about: the register's own screens have their own journey
        const father = generated();
        holder = `ሰላም ${father}`;
        const made = await staff.post<{ id: string }>('v1/persons', {
            nameAm: { given: 'ሰላም', father, grandfather: 'ተሰማ' },
            sex: 'female',
            birthYear: 1990,
            sensitive: { birthDate: '1990-01-15' },
            acknowledgedDuplicates: []
        });
        personId = made.id;
        const school = `ናሙና ማሰልጠኛ ${generated()}`;
        await staff.post('v1/organisations', {
            kind: 'training_school',
            name: { am: school, en: `Sample School ${father}` }
        });

        // the school's list
        await officer.goto('/competency/training');
        const enrol = officer.locator('[data-enrol]');
        await pick(officer, enrol, 'ሰው', holder, new RegExp(holder));
        await pick(officer, enrol, FIELD.school, school, school);
        await enrol.getByRole('combobox', { name: 'ደረጃ' }).click();
        await officer.getByRole('option', { name: AUTOMOBILE }).click();
        await enrol.getByRole('button', { name: 'ጨምር' }).click();
        const listed = officer.locator(`[data-enrolment][data-person="${personId}"]`);
        await listed.locator('[data-action="complete"]').click();
        await expect(listed).toHaveAttribute('data-status', 'completed');

        // the counter
        await records.goto('/competency/applications');
        await records.locator('[data-applications]').getByRole('link').click();
        const form = records.locator('[data-request-form="DVC-03"]');
        await pick(records, form, FIELD.applicant, holder, new RegExp(holder));
        await form.getByRole('combobox', { name: FIELD.grade }).click();
        await records.getByRole('option', { name: AUTOMOBILE, exact: true }).click();
        await form.getByLabel(FIELD.education).fill('10');
        await pick(records, form, FIELD.school, school, school);
        await form.getByLabel(FIELD.facility).fill('Sample Health Centre');
        await today(records, form, FIELD.examined);
        await expect(form.locator('[data-field-fee]')).toContainText(/\d[\d,]*\.\d{2}/);
        await form.getByRole('button', { name: FILE }).click();
        await expect(records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
        const caseId = records.url().split('/').pop() ?? '';
        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'review');

        // the review and the exam
        await act(officer, caseId, 'approve', 'አጽድቅ');
        await inState(officer, caseId, 'exam');
        await officer.goto('/competency/exams');
        await expect(officer.locator('[data-screen="requests"]')).toBeVisible();
        await act(officer, caseId, 'pass', FIELD.passed, async (dialog) => {
            await today(officer, dialog, FIELD.heldOn);
            await dialog.getByLabel(FIELD.theory).fill('80');
            await dialog.getByLabel(FIELD.practical).fill('75');
            await dialog.getByRole('checkbox', { name: FIELD.passed }).click();
        });
        await inState(officer, caseId, 'payment');

        // the till moves it on by itself
        const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
        await payAtTheTill(cashier, caseNumber);
        await inState(lead, caseId, 'approval');

        // final approval; the fake platform answers through the outbox, and only that makes a licence
        await act(lead, caseId, 'approve', 'አጽድቅ');
        await inState(lead, caseId, 'issued');

        // the card, made by the PDF worker
        await records.goto(`/cases/${caseId}`);
        await expect(records.locator('[data-case-documents] [data-document="licence-card"]')).toHaveAttribute(
            'data-state',
            'rendered',
            { timeout: 120_000 }
        );

        // the register
        await officer.goto('/competency/licences');
        const { items } = await staff.get<{ items: { id: string; number: string }[] }>(
            `v1/competency/licences?personId=${personId}`
        );
        licenceId = items[0]?.id ?? '';
        number = items[0]?.number ?? '';
        expect(number).toMatch(/^WOL-BODITI\/DL\/\d{6}$/);
        await officer.getByLabel('የፈቃድ ቁጥር').fill(number);
        await officer.locator('[data-screen="licences"]').getByRole('button', { name: 'ፈልግ' }).click();
        const row = officer.locator(`[data-licence="${licenceId}"]`);
        await expect(row).toHaveAttribute('data-status', 'active');
        await expect(row).toHaveAttribute('data-kind', 'temporary');
        await expect(row.locator('[data-licence-number]')).toHaveText(number);

        // the print batch, sent once
        await lead.goto('/competency/print-batches');
        const open = lead.locator('[data-batch][data-status="open"]');
        await expect(open.locator('[data-batch-licences]')).not.toHaveText('0');
        await open.locator('[data-action="send"]').click();
        await expect(lead.locator('[data-batch][data-status="open"]')).toHaveCount(0);
    });

    test('its renewal: the offence check, the fee, and a new card', async ({ browser }) => {
        test.setTimeout(420_000);
        const { records, cashier, lead, officer } = people;

        // a licence two years from its expiry is renewed only if the region's window allows it: the setting a bureau would change
        const bureau = api(await signedIn(browser, PEOPLE.bureau));
        const { activeUnit } = await bureau.get<{ activeUnit: { id: string } }>('v1/me/workspace');
        const setting = `v1/org-units/${activeUnit.id}/settings/competency.renewal_window_months`;
        // a first write of a setting is its version 1; a retry of this journey must find it gone
        await bureau.put(setting, { value: 60 }, 0);
        try {
            const { validUntil } = await api(officer).get<{ validUntil: string }>(
                `v1/competency/licences/${licenceId}`
            );
            const [year = 0, month = 0, day = 0] = validUntil.split('-').map(Number);
            const expiry = toEthiopian({ year, month, day });

            // the counter
            await records.goto('/competency/applications');
            const applications = records.locator('[data-applications]');
            await applications.locator('[data-choice="DVC-04"]').click();
            await applications.getByRole('link').click();
            const form = records.locator('[data-request-form="DVC-04"]');
            await pick(records, form, FIELD.licence, number, new RegExp(number));
            await form.getByRole('combobox', { name: FIELD.grade }).click();
            await records.getByRole('option', { name: AUTOMOBILE, exact: true }).click();
            await form.getByRole('button', { name: new RegExp(FIELD.expiry) }).click();
            await records.getByLabel('ዓመት').fill(String(expiry.year));
            await records.getByLabel('ወር', { exact: true }).selectOption(String(expiry.month));
            await records.locator(`[role="grid"] [data-day="${expiry.day}"]`).click();
            await form.getByLabel(FIELD.facility).fill('Sample Health Centre');
            await today(records, form, FIELD.examined);
            await form.getByRole('button', { name: FILE }).click();
            await expect(records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
            const caseId = records.url().split('/').pop() ?? '';
            await act(records, caseId, 'submit', 'submit');

            // a temporary licence: its record is checked first
            await act(officer, caseId, 'approve', 'አጽድቅ');
            await inState(officer, caseId, 'offence_check');
            await act(officer, caseId, 'clear', 'መዝገቡ ንጹህ ነው');
            await inState(officer, caseId, 'payment');

            const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
            await payAtTheTill(cashier, caseNumber);
            await inState(lead, caseId, 'approval');
            await act(lead, caseId, 'approve', 'አጽድቅ');
            await inState(lead, caseId, 'issued');

            // permanent now, for 4 years from the old expiry, and the case has its card
            await officer.goto('/competency/licences');
            const row = officer.locator(`[data-licence="${licenceId}"]`);
            await expect(row).toHaveAttribute('data-kind', 'permanent');
            await expect(row.locator('[data-valid-until]')).toHaveAttribute(
                'data-valid-until',
                `${year + 4}${validUntil.slice(4)}`
            );
            await records.goto(`/cases/${caseId}`);
            await expect(records.locator('[data-case-documents] [data-document="licence-card"]')).toBeVisible();
        } finally {
            await bureau.delete(setting, 1);
        }
    });
});
