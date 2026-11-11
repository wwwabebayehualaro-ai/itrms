/**
 * The new vehicle registration service in a browser, end to end, as it is seeded (task 1.2b, DVC-01). Only the requests list and the
 * reserved plates are service-specific: the request form, the case page, the till and the documents are the platform's.
 *
 * Boditi's people act on the demo's plate stock (`pnpm demo:reset`: Boditi holds its own plates): the records officer files the
 * request at the counter, the competency officer checks it, the revenue collector takes the fee, the team leader approves (a plate
 * is held for the case from then on) and the officer registers the vehicle with the federal id. The libre is made by the PDF worker,
 * and the register finds the vehicle by its new plate.
 */
import { randomInt } from 'node:crypto';

import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, filing, generated, inState, payAtTheTill, person, pick } from './support';

/** A VIN with its check digit right, generated: never a real vehicle's. */
function generatedVin(): string {
    const base = `1HGCM82B0${randomInt(10, 99)}${String(randomInt(0, 999999)).padStart(6, '0')}`;
    return `${base.slice(0, 8)}${vinCheckDigit(base) ?? '0'}${base.slice(9)}`;
}

const WORD = {
    owner: 'ባለቤት (ሰው)',
    chassis: 'የሻሲ ቁጥር',
    make: 'ሰሪ',
    model: 'ሞዴል',
    year: 'የተመረተበት ዓመት',
    category: 'የተሽከርካሪ ምድብ',
    use: 'አገልግሎት',
    seats: 'የመቀመጫ ብዛት',
    automobile: 'አውቶሞቢል',
    private: 'የግል',
    approve: 'አጽድቅ',
    register: 'መዝግብ',
    federalId: 'የፌዴራል ተሽከርካሪ መለያ',
    addOwner: 'ባለቤት ጨምር'
} as const;

interface People {
    records: Page;
    cashier: Page;
    lead: Page;
    officer: Page;
}

test.describe.configure({ mode: 'serial' });

test.describe('the new vehicle registration service', () => {
    let people: People;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        people = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            lead: await person(browser, BODITI.lead),
            officer: await person(browser, BODITI.officer)
        };
    });

    test('a vehicle is registered at the counter, with its plate from the stock and its libre', async () => {
        test.setTimeout(420_000);
        const { records, cashier, lead, officer } = people;

        // who owns the vehicle: the register's own screens have their own journey
        const father = generated();
        const owner = `ባለቤት ${father}`;
        await api(officer).post('v1/persons', {
            nameAm: { given: 'ባለቤት', father, grandfather: 'ታደሰ' },
            sex: 'male',
            birthYear: 1985,
            acknowledgedDuplicates: []
        });
        const chassis = generatedVin();

        // the counter files it; the plates held for cases are the officers' to see, not the counter's
        await records.goto('/competency/vehicle-registrations');
        await expect(records.locator('[data-vehicle-registrations]')).toBeVisible();
        await expect(records.locator('[data-reserved-plates]')).toHaveCount(0);
        await officer.goto('/competency/vehicle-registrations');
        await expect(officer.locator('[data-reserved-plates]')).toBeVisible();
        await records.goto('/competency/vehicle-registrations/new');
        const form = records.locator('[data-request-form="DVC-01"]');
        // the form opens with its one required owner row; wait for it before deciding to add one
        await expect(form).toBeVisible();
        const row = form.locator('[data-row="0"]');
        if ((await row.count()) === 0) await form.getByRole('button', { name: WORD.addOwner }).click();
        await expect(form.locator('[data-row]')).toHaveCount(1);
        // a required field's name ends in its asterisk
        const named = (label: string) => new RegExp(`^${label}( [*])?$`);
        const input = (label: string) => form.getByRole('textbox', { name: named(label) });
        const choose = async (label: string, option: string) => {
            await form.getByRole('combobox', { name: named(label) }).click();
            await records.getByRole('option', { name: option, exact: true }).click();
        };
        await pick(records, row, WORD.owner, owner, new RegExp(owner));
        await input(WORD.chassis).fill(chassis);
        await input(WORD.make).fill('Toyota');
        await input(WORD.model).fill('Vitz');
        await input(WORD.year).fill('2018');
        await choose(WORD.category, WORD.automobile);
        await choose(WORD.use, WORD.private);
        await input(WORD.seats).fill('5');
        await filing(records, form);
        const caseId = records.url().split('/').pop() ?? '';
        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'review');

        // the review, the fee at the till, and the final approval
        await act(officer, caseId, 'approve', WORD.approve);
        await inState(officer, caseId, 'payment');
        const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
        await payAtTheTill(cashier, caseNumber);
        await inState(lead, caseId, 'approval');
        await act(lead, caseId, 'approve', WORD.approve);
        await inState(lead, caseId, 'registration');

        // a plate is held for the case: the office's panel lists it, and it opens the case
        await officer.goto('/competency/vehicle-registrations');
        await expect(officer.locator(`[data-reserved-plates] a[href="/cases/${caseId}"]`)).toBeVisible();

        // the officer registers it with the federal id the national system gave
        const federalId = `FV-${randomInt(100000, 999999)}`;
        await act(officer, caseId, 'register', WORD.register, async (dialog) => {
            await dialog.getByRole('textbox', { name: new RegExp(`^${WORD.federalId}( [*])?$`) }).fill(federalId);
        });
        await inState(officer, caseId, 'registered');

        // the libre, made by the PDF worker
        await records.goto(`/cases/${caseId}`);
        await expect(records.locator('[data-case-documents] [data-document="vehicle-libre"]')).toHaveAttribute(
            'data-state',
            'rendered',
            { timeout: 120_000 }
        );

        // the register finds the vehicle by the plate it was given
        const found = await api(officer).get<{
            items: { id: string; federalVehicleId: string | null; currentPlate: { text: string } | null }[];
        }>(`v1/vehicles?q=${chassis}`);
        const vehicle = found.items[0];
        expect(vehicle?.federalVehicleId).toBe(federalId);
        const plate = vehicle?.currentPlate?.text ?? '';
        expect(plate).toMatch(/^ETH [A-Z]{3} \d{4}$/);
        await officer.goto(`/registry/vehicles?q=${encodeURIComponent(plate)}`);
        await expect(officer.locator('[data-results]').getByRole('link', { name: plate })).toBeVisible();

        // its plate is no longer held for a case
        await officer.goto('/competency/vehicle-registrations');
        await expect(officer.locator(`[data-reserved-plates] a[href="/cases/${caseId}"]`)).toHaveCount(0);
    });
});
