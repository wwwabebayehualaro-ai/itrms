/**
 * What the licence journeys share (tasks 0.24c, 0.25c): the demo's Boditi people, the words they click in each language, and the steps
 * of a case. The words are the seeded forms' and workflows' (modules/competency/seed) and the catalogues'; a journey in another
 * language takes the same steps with that language's words.
 */
import { randomInt } from 'node:crypto';

import { expect, type Browser, type Locator, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';

/** Demo accounts of apps/api/seed/users/wolaita.demo.yaml (generated people, never real ones). */
export const BODITI = {
    records: { id: '0199f0a0-d000-7000-8000-000000000302', username: 'demo.boditi.records' },
    cashier: { id: '0199f0a0-d000-7000-8000-000000000303', username: 'demo.boditi.cashier' },
    lead: { id: '0199f0a0-d000-7000-8000-000000000304', username: 'demo.boditi.lead' },
    officer: { id: '0199f0a0-d000-7000-8000-000000000305', username: 'demo.boditi.officer' }
} as const;

export type Lang = 'am' | 'en';

/** The words a licence journey clicks, per language. */
export const WORDS = {
    am: {
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
        passed: 'አልፏል',
        automobile: 'አውቶሞቢል',
        search: 'ስም ወይም ቁጥር ይጻፉ…',
        file: 'ጥያቄውን ጀምር',
        approve: 'አጽድቅ',
        returnIt: 'ለማስተካከያ መልስ',
        correct: 'አስተካክለህ አስገባ',
        open: 'ክፈት',
        receivedFrom: 'ከፋዩ',
        person: 'ሰው',
        enrolGrade: 'ደረጃ',
        add: 'ጨምር',
        licenceNumber: 'የፈቃድ ቁጥር',
        find: 'ፈልግ',
        language: 'ቋንቋ',
        home: 'መነሻ',
        female: 'ሴት',
        register: 'መዝግብ',
        newPerson: 'ሰው መመዝገብ',
        school_a: 'ናሙና ማሰልጠኛ ተቋም ሀ',
        unreadable: 'የህክምና ማስረጃው አይነበብም'
    },
    en: {
        applicant: 'Applicant',
        grade: 'Licence grade',
        education: 'School grade completed',
        school: 'Training school',
        facility: 'Medical facility',
        examined: 'Date of the medical examination',
        licence: 'Driver licence',
        expiry: 'The licence’s expiry date',
        heldOn: 'Exam date',
        theory: 'Theory score',
        practical: 'Practical score',
        passed: 'Passed',
        automobile: 'Automobile',
        search: 'Type a name or number…',
        file: 'Start the request',
        approve: 'Approve',
        returnIt: 'Return for correction',
        correct: 'Correct and resubmit',
        open: 'Open',
        receivedFrom: 'Received from',
        person: 'Person',
        enrolGrade: 'Grade',
        add: 'Add',
        licenceNumber: 'Licence number',
        find: 'Find',
        language: 'Language',
        home: 'Home',
        female: 'Female',
        register: 'Register',
        newPerson: 'Register a person',
        school_a: 'Sample Driving School A',
        unreadable: 'The medical certificate is unreadable'
    }
} as const satisfies Record<Lang, Record<string, string>>;

/** Letters only, of ones that don't fold into each other: a name a second run won't take for a duplicate. */
const LETTERS = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
export const generated = () => Array.from({ length: 5 }, () => LETTERS[randomInt(LETTERS.length)] ?? 'ለ').join('');
const LATIN = 'bcdfghjklmnprstvwyz';
export const latin = () =>
    `${(LATIN[randomInt(LATIN.length)] ?? 'b').toUpperCase()}${Array.from({ length: 5 }, (_, i) =>
        i % 2 ? (LATIN[randomInt(LATIN.length)] ?? 'b') : 'aeiou'[randomInt(5)]
    ).join('')}`;

export const birr = (santim: string) => {
    const digits = santim.padStart(3, '0');
    return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

/** A demo person signed in afresh (a new second factor), in a browser of their own. */
export async function person(browser: Browser, who: { id: string; username: string }): Promise<Page> {
    await resetAccount(who.id);
    const page = await (await browser.newContext()).newPage();
    await firstSignIn(page, who.username);
    return page;
}

/** The person's language, saved on the server as their own choice would be, and shown. */
export async function speaks(page: Page, lang: string) {
    await api(page).patch('v1/me/preferences', { language: lang }, 0);
    await page.context().addCookies([{ name: 'itrms_lang', value: lang, url: new URL(page.url()).origin }]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

export async function pick(
    page: Page,
    within: Locator,
    label: string,
    search: string,
    option: string | RegExp,
    lang: Lang = 'am'
) {
    await within.getByRole('combobox', { name: label }).click();
    await page.getByPlaceholder(WORDS[lang].search).fill(search);
    await page.getByRole('option', { name: option }).first().click();
}

export async function today(page: Page, within: Locator, label: string) {
    await within.getByRole('button', { name: new RegExp(label) }).click();
    await page.locator('[role="grid"] [aria-current="date"]').click();
}

/** A day in the Ethiopian calendar, picked as a clerk does: the month, the year, then the day. */
export async function ethiopianDay(page: Page, trigger: Locator, day: { year: number; month: number; day: number }) {
    await trigger.click();
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('select').selectOption(String(day.month));
    await popover.locator('input[type="number"]').fill(String(day.year));
    await popover.locator(`[data-day="${day.day}"]`).click();
}

/**
 * Files what the form holds. The fee is worked out again as answers change, and the server refuses a filing whose fee wasn't shown (and
 * starts no case), so a click made while the last answer's preview is on its way is simply made again.
 */
export async function filing(page: Page, form: Locator, lang: Lang = 'am') {
    await expect(form.locator('[data-field-fee]')).toContainText(/\d[\d,]*\.\d{2}/);
    await expect(async () => {
        await form.getByRole('button', { name: WORDS[lang].file }).click();
        await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    }).toPass({ timeout: 120_000 });
}

/** A step of a case, by its action and the name of the dialog's button. */
export async function act(
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

export const inState = async (page: Page, caseId: string, state: string) => {
    await expect
        .poll(async () => (await api(page).get<{ state: string }>(`v1/cases/${caseId}`)).state, { timeout: 90_000 })
        .toBe(state);
};

/** The cashier takes the fee of a case at the till; the receipt's page opens. */
export async function payAtTheTill(page: Page, caseNumber: number, lang: Lang = 'am') {
    await page.goto('/cashier');
    const row = page.locator(`[data-queue] [data-case-number="${caseNumber}"]`);
    await row.getByRole('link', { name: WORDS[lang].open }).click();
    const order = page.locator('[data-screen="payment-order"]');
    const total = await order.locator('[data-total]').getAttribute('data-total');
    await page.locator('[data-payment-form] #payment-amount').fill(birr(total ?? ''));
    await page.getByLabel(WORDS[lang].receivedFrom).fill('Generated Applicant');
    await page.locator('[data-action="record-payment"]').click();
    await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}$/);
}
