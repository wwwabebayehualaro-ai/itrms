/**
 * The plate exchange in a browser, end to end, as it is seeded (task 1.2c, DVC-12, Directive 1050/2025). Only the requests list is
 * service-specific: the request form, the case page, the till and the register's screens are the platform's.
 *
 * Boditi's people act on the demo's register and plate stock (`pnpm demo:reset`: Boditi has vehicles still on old regional plates,
 * and its own national plates): the records officer files the exchange for a vehicle picked from the register, the competency
 * officer checks it, the revenue collector takes the fee, the team leader approves (a plate is held for the case from then on) and
 * the officer hands the plate over. The register then shows the national plate, and the old one retired, exchanged for it.
 */
import { randomInt } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import vehiclesAm from '@itrms/vehicles/messages/am';

import { act, BODITI, filing, inState, payAtTheTill, person, pick } from './support';

/** A text as a regular expression that matches it literally. */
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORD = {
    vehicle: 'ተሽከርካሪ',
    use: 'አገልግሎት (የሰሌዳ ኮድ)',
    approve: 'አጽድቅ',
    exchange: 'ሰሌዳውን ስጥ',
    federalId: 'የፌዴራል ተሽከርካሪ መለያ',
    plates: 'ሰሌዳዎች'
} as const;

interface People {
    records: Page;
    cashier: Page;
    lead: Page;
    officer: Page;
}

interface Found {
    id: string;
    use: string;
    status: string;
    currentPlate: { text: string; format: string } | null;
    handlingUnit: { code: string };
}

test.describe.configure({ mode: 'serial' });

test.describe('the plate exchange', () => {
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

    test('an old regional plate is exchanged for a national plate from the stock, the old one retired', async () => {
        test.setTimeout(420_000);
        const { records, cashier, lead, officer } = people;

        // a Boditi vehicle of the demo still on its old regional plate (the demo has several)
        const found = await api(officer).get<{ items: Found[] }>('v1/vehicles?status=active&limit=100');
        const vehicle = found.items.find(
            (v) => v.status === 'active' && v.currentPlate?.format === 'legacy' && v.handlingUnit.code === 'WOL-BODITI'
        );
        expect(vehicle, 'a Boditi vehicle on an old plate in the demo').toBeDefined();
        const oldPlate = vehicle?.currentPlate?.text ?? '';

        await records.goto('/competency/plate-exchanges/new');
        const form = records.locator('[data-request-form="DVC-12"]');
        await expect(form).toBeVisible();
        await pick(records, form, WORD.vehicle, oldPlate, new RegExp(escaped(oldPlate)));
        await form.getByRole('combobox', { name: new RegExp(`^${escaped(WORD.use)}( [*])?$`) }).click();
        await records
            .getByRole('option', {
                name: (vehiclesAm as Record<string, string>)[`vehicles.use.${vehicle?.use ?? ''}`],
                exact: true
            })
            .click();
        await filing(records, form);
        const caseId = records.url().split('/').pop() ?? '';
        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'review');

        await act(officer, caseId, 'approve', WORD.approve);
        await inState(officer, caseId, 'payment');
        const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
        await payAtTheTill(cashier, caseNumber);
        await inState(lead, caseId, 'approval');
        await act(lead, caseId, 'approve', WORD.approve);
        await inState(lead, caseId, 'exchange');

        // the officer hands the held plate over, with the federal id the national system gave
        const federalId = `FV-${randomInt(100000, 999999)}`;
        await act(officer, caseId, 'exchange', WORD.exchange, async (dialog) => {
            await dialog.getByRole('textbox', { name: new RegExp(`^${WORD.federalId}( [*])?$`) }).fill(federalId);
        });
        await inState(officer, caseId, 'exchanged');

        // the register: the national plate now, the old one retired, exchanged for it
        const record = await api(officer).get<{
            federalVehicleId: string | null;
            currentPlate: { text: string; format: string } | null;
        }>(`v1/vehicles/${vehicle?.id}`);
        expect(record.federalVehicleId).toBe(federalId);
        expect(record.currentPlate?.format).toBe('national');
        await officer.goto(`/registry/vehicles/${vehicle?.id}`);
        await officer.getByRole('tab', { name: WORD.plates }).click();
        await expect(officer.locator('[data-plates] [data-replaced-by]').first()).toContainText(
            record.currentPlate?.text ?? ''
        );
    });
});
