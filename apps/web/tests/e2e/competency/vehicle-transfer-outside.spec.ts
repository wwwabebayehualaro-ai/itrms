/**
 * A vehicle released outside the region, and the release cancelled, in a browser, end to end, as it is seeded (task 1.4c2 and
 * 1.4c2b, DVC-14 "outside" and DVC-16, ADR-0058, ADR-0059). The request form, the case page and the till are the platform's.
 *
 * On the demo's register (`pnpm demo:reset`): Boditi's records officer files the transfer out of one of its vehicles to another
 * region, the officer checks it, the revenue collector takes the fee, the team leader approves and the officer issues the vehicle
 * data transfer document. Then the owner changes their mind: the records officer files the cancellation with the number of the
 * document handed back, the officer checks it and the team leader approves. The register reads the vehicle active again.
 */
import { expect, test } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, filing, inState, payAtTheTill, person, pick, WORDS } from './support';

/** A text as a regular expression that matches it literally. */
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORD = {
    vehicle: 'ተሽከርካሪ',
    destination: 'የሚዛወርበት',
    outside: 'ሌላ ክልል ወይም ITRMS የሌለው መሥሪያ ቤት',
    name: 'የሚዛወርበት መሥሪያ ቤት ስም',
    region: 'የሚዛወርበት ክልል',
    number: 'ተመላሽ የሆነው የማስተላለፊያ ሰነድ ቁጥር',
    reason: 'የመሰረዙ ምክንያት',
    approve: 'አጽድቅ',
    issue: 'ሰነዱን ስጥ',
    cancel: 'መልቀቂያውን ሰርዝ'
} as const;

interface Found {
    id: string;
    status: string;
    currentPlate: { text: string; format: string } | null;
    handlingUnit: { code: string };
}

test.describe.configure({ mode: 'serial' });

test.describe('a vehicle released outside the region', () => {
    test('is given its transfer document, and reads active again once the release is cancelled', async ({
        browser
    }) => {
        test.setTimeout(600_000);
        const boditi = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            lead: await person(browser, BODITI.lead),
            officer: await person(browser, BODITI.officer)
        };

        // a Boditi vehicle of the demo still on its old plate; the transfer journey between offices takes the last one, this the first
        const found = await api(boditi.officer).get<{ items: Found[] }>('v1/vehicles?status=active&limit=100');
        const vehicle = found.items.find(
            (v) => v.status === 'active' && v.handlingUnit.code === 'WOL-BODITI' && v.currentPlate?.format === 'legacy'
        );
        expect(vehicle, 'a Boditi vehicle in the demo').toBeDefined();
        const plate = vehicle?.currentPlate?.text ?? '';

        // the transfer out of the region, at Boditi, through the document step
        await boditi.records.goto('/competency/vehicle-transfers/out/new');
        const out = boditi.records.locator('[data-request-form="DVC-14"]');
        await expect(out).toBeVisible();
        await pick(boditi.records, out, WORD.vehicle, plate, new RegExp(escaped(plate)));
        await out.getByRole('combobox', { name: WORD.destination, exact: true }).click();
        await boditi.records.getByRole('option', { name: WORD.outside }).click();
        await out.getByLabel(WORD.name).fill('Sample Transport Bureau');
        await out.getByLabel(WORD.region).fill('Sample Region');
        await filing(boditi.records, out);
        const outId = boditi.records.url().split('/').pop() ?? '';
        await act(boditi.records, outId, 'submit', 'submit');
        await inState(boditi.records, outId, 'review');
        await act(boditi.officer, outId, 'approve', WORD.approve);
        await inState(boditi.officer, outId, 'payment');
        const { number } = await api(boditi.records).get<{ number: number }>(`v1/cases/${outId}`);
        await payAtTheTill(boditi.cashier, number);
        await inState(boditi.lead, outId, 'approval');
        await act(boditi.lead, outId, 'approve', WORD.approve);
        await inState(boditi.officer, outId, 'document');
        await act(boditi.officer, outId, 'issue_document', WORD.issue);
        await inState(boditi.officer, outId, 'transferred_out');

        // the documents are issued: the transfer document, with its number, and the covering letter (beside the fee's receipt)
        const issued = await api(boditi.officer).get<{ items: { templateKey: string; number: string | null }[] }>(
            `v1/issued-documents?caseId=${outId}`
        );
        expect(
            issued.items
                .map((d) => d.templateKey)
                .filter((k) => k.startsWith('vehicle-transfer-'))
                .sort()
        ).toEqual(['vehicle-transfer-covering-letter', 'vehicle-transfer-document']);
        const documentNumber = issued.items.find((d) => d.templateKey === 'vehicle-transfer-document')?.number ?? '';
        expect(documentNumber).not.toBe('');
        const left = await api(boditi.officer).get<{ status: string }>(`v1/vehicles/${vehicle?.id}`);
        expect(left.status).toBe('transferred_out');

        // the owner hands the document back: the cancellation, with its number
        await boditi.records.goto('/competency/vehicle-transfers/cancel/new');
        const cancel = boditi.records.locator('[data-request-form="DVC-16"]');
        await expect(cancel).toBeVisible();
        await pick(boditi.records, cancel, WORD.vehicle, plate, new RegExp(escaped(plate)));
        await cancel.getByLabel(WORD.number).fill(documentNumber);
        await cancel.getByLabel(WORD.reason).fill('The owner changed their mind');
        await expect(async () => {
            await cancel.getByRole('button', { name: WORDS.am.file }).click();
            await expect(boditi.records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        }).toPass({ timeout: 120_000 });
        const cancelId = boditi.records.url().split('/').pop() ?? '';
        await act(boditi.records, cancelId, 'submit', 'submit');
        await inState(boditi.records, cancelId, 'review');
        await act(boditi.officer, cancelId, 'approve', WORD.approve);
        await inState(boditi.lead, cancelId, 'approval');
        await act(boditi.lead, cancelId, 'approve', WORD.cancel);
        await inState(boditi.officer, cancelId, 'cancelled');

        const back = await api(boditi.officer).get<{ status: string; handlingUnit: { code: string } }>(
            `v1/vehicles/${vehicle?.id}`
        );
        expect(back.status).toBe('active');
        expect(back.handlingUnit.code).toBe('WOL-BODITI');
    });
});
