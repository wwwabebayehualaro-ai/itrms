/**
 * The bolo inspection in a browser, end to end, as it is seeded (task 1.3a, DVC-02). The request is filed through the API (its
 * form is the platform's request form, shown in the other journeys); what is the bolo's own is done on its screens: the officer
 * checks the request, the revenue collector takes the fee at the till, the officer answers the light-vehicle checklist in the
 * inspection step (a failed item blocks the pass) and hands over the sticker of the vehicle's use and fiscal year from Boditi's
 * stock (`pnpm demo:reset`: Boditi's vehicles, and its stickers of this year).
 */
import { randomInt } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, inState, payAtTheTill, person } from './support';

const WORD = {
    approve: 'አጽድቅ',
    passed: 'አልፏል',
    failed: 'አላለፈም',
    issueSticker: 'ምልክቱን ስጥ',
    serial: 'የምርመራ ቅጽ ቁጥር',
    remark: 'አስተያየት'
} as const;

interface People {
    records: Page;
    cashier: Page;
    officer: Page;
}

interface Found {
    id: string;
    use: string;
    status: string;
    handlingUnit: { code: string };
}

const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(d);
};

test.describe.configure({ mode: 'serial' });

test.describe('the bolo inspection', () => {
    let people: People;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        people = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            officer: await person(browser, BODITI.officer)
        };
    });

    test('a vehicle is inspected on the checklist and given its bolo sticker; a failed item blocks the pass', async () => {
        test.setTimeout(420_000);
        const { records, cashier, officer } = people;

        // a private Boditi vehicle of the demo
        const found = await api(officer).get<{ items: Found[] }>('v1/vehicles?status=active&limit=100');
        // one at random: a vehicle given its bolo this year by an earlier run is not filed again
        const candidates = found.items.filter((v) => v.use === 'private' && v.handlingUnit.code === 'WOL-BODITI');
        expect(candidates.length, 'private Boditi vehicles in the demo').toBeGreaterThan(0);
        const vehicle = candidates[randomInt(candidates.length)];
        const answers = {
            vehicle: vehicle?.id,
            use: 'private',
            insuranceCertificate: String(randomInt(1_000_000, 9_999_999)),
            insurer: 'Sample Insurance S.C.',
            insuredFrom: day(-30),
            insuredUntil: day(330)
        };
        const fee = await api(records).post<{ feeRuleVersionId: string; totalSantim: string }>('v1/fees/preview', {
            serviceCode: 'DVC-02',
            answers
        });
        const filed = await api(records).post<{ id: string }>('v1/service-requests', {
            serviceCode: 'DVC-02',
            answers,
            fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim }
        });
        const caseId = filed.id;

        // the bolos list shows it
        await records.goto('/competency/bolos');
        await expect(records.locator('[data-bolos]')).toBeVisible();

        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'review');
        await act(officer, caseId, 'approve', WORD.approve);
        await inState(officer, caseId, 'payment');
        const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
        await payAtTheTill(cashier, caseNumber);
        await inState(officer, caseId, 'inspection');

        // the checklist: every item passed but one, which blocks the pass
        await officer.goto(`/cases/${caseId}`);
        await officer.locator('[data-actions] [data-action="pass"]').click();
        const dialog = officer.locator('[data-action-dialog="pass"]');
        await dialog
            .getByRole('textbox', { name: new RegExp(`^${WORD.serial}( [*])?$`) })
            .fill(`LV-${randomInt(100000, 999999)}`);
        const groups = dialog.locator('[data-checklist] [role="radiogroup"]');
        const count = await groups.count();
        expect(count).toBeGreaterThanOrEqual(20);
        for (let i = 0; i < count; i += 1) await groups.nth(i).getByRole('radio', { name: WORD.passed }).click();
        const outcome = dialog.locator('[data-checklist-outcome] [data-passed]');
        await expect(outcome).toHaveAttribute('data-passed', 'true');
        await groups.nth(4).getByRole('radio', { name: WORD.failed }).click();
        await expect(outcome).toHaveAttribute('data-passed', 'false');
        // a failed item needs its remark, and still blocks the pass on the server
        await dialog.locator('[data-checklist] [data-item]').nth(4).getByRole('textbox').fill('Left lamp out');
        await dialog.getByRole('button', { name: WORD.passed, exact: true }).click();
        await expect(dialog).toBeVisible();
        await inState(officer, caseId, 'inspection');
        // the lamp is fixed on the spot: the item passes, and so does the vehicle
        await groups.nth(4).getByRole('radio', { name: WORD.passed }).click();
        await expect(outcome).toHaveAttribute('data-passed', 'true');
        await dialog.getByRole('button', { name: WORD.passed, exact: true }).click();
        await expect(dialog).toBeHidden();
        await inState(officer, caseId, 'sticker');

        // the sticker of a private vehicle and this fiscal year, from Boditi's stock
        await act(officer, caseId, 'issue_sticker', WORD.issueSticker);
        await inState(officer, caseId, 'issued');
    });
});
