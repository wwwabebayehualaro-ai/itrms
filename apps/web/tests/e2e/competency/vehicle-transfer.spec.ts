/**
 * The transfer of a vehicle between two offices in a browser, end to end, as it is seeded (task 1.4c, DVC-14 and DVC-15,
 * ADR-0057). Only the requests list is service-specific: the request form, the case page, the till and the register's screens are
 * the platform's.
 *
 * On the demo's register (`pnpm demo:reset`): Boditi's records officer files the transfer out of one of its vehicles to the zone,
 * the competency officer checks it, the revenue collector takes the fee, the team leader approves and the officer releases it;
 * then the zone's records officer (demo.dual, at the zone's counter) files the transfer in, the zone's officer checks it (no fee),
 * its team leader approves and the officer receives it. The register then shows the zone handling the vehicle.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, filing, inState, payAtTheTill, person, pick, WORDS } from './support';

/** The zone's people (apps/api/seed/users/wolaita.demo.yaml): demo.dual is its records officer, and Boditi's cashier too. */
const ZONE = {
    records: { id: '0199f0a0-d000-7000-8000-000000000401', username: 'demo.dual' },
    lead: { id: '0199f0a0-d000-7000-8000-000000000103', username: 'demo.zone.lead' },
    officer: { id: '0199f0a0-d000-7000-8000-000000000104', username: 'demo.zone.officer1' }
};

/** A text as a regular expression that matches it literally. */
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORD = {
    vehicle: 'ተሽከርካሪ',
    office: 'የሚዛወርበት መሥሪያ ቤት',
    approve: 'አጽድቅ',
    release: 'ተሽከርካሪውን ልቀቅ',
    receive: 'ተሽከርካሪውን ተረከብ'
} as const;

interface Found {
    id: string;
    status: string;
    currentPlate: { text: string; format: string } | null;
    handlingUnit: { code: string };
}

/** Files a request whose service charges no fee: no fee is shown to wait for. */
async function filingWithoutFee(page: Page, form: Locator) {
    await expect(async () => {
        await form.getByRole('button', { name: WORDS.am.file }).click();
        await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    }).toPass({ timeout: 120_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('the transfer of a vehicle between offices', () => {
    test('a Boditi vehicle is released to the zone and received there', async ({ browser }) => {
        test.setTimeout(600_000);
        const boditi = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            lead: await person(browser, BODITI.lead),
            officer: await person(browser, BODITI.officer)
        };
        const zone = {
            records: await person(browser, ZONE.records),
            lead: await person(browser, ZONE.lead),
            officer: await person(browser, ZONE.officer)
        };

        // a Boditi vehicle of the demo still on its old plate, the last one: the plate exchange's journey takes the first, and the
        // register's journey reads the story vehicle (on its national plate), which stays at Boditi
        const found = await api(boditi.officer).get<{ items: Found[] }>('v1/vehicles?status=active&limit=100');
        const vehicle = found.items
            .filter(
                (v) =>
                    v.status === 'active' && v.handlingUnit.code === 'WOL-BODITI' && v.currentPlate?.format === 'legacy'
            )
            .pop();
        expect(vehicle, 'a Boditi vehicle in the demo').toBeDefined();
        const plate = vehicle?.currentPlate?.text ?? '';

        // the transfer out, at Boditi
        await boditi.records.goto('/competency/vehicle-transfers/out/new');
        const out = boditi.records.locator('[data-request-form="DVC-14"]');
        await expect(out).toBeVisible();
        await pick(boditi.records, out, WORD.vehicle, plate, new RegExp(escaped(plate)));
        await pick(boditi.records, out, WORD.office, 'WOL', /./);
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
        await inState(boditi.officer, outId, 'release');
        await act(boditi.officer, outId, 'release', WORD.release);
        await inState(boditi.officer, outId, 'released');

        // the transfer in, at the zone: demo.dual acts for the zone's counter today; no fee, so the payment wait passes at once
        const switcher = zone.records.locator('[data-app-topbar] [data-active-unit]');
        await switcher.click();
        await zone.records.locator('[data-unit="WOL"]').click();
        await expect(switcher).toHaveAttribute('data-active-unit', 'WOL');
        await zone.records.goto('/competency/vehicle-transfers/in/new');
        const inForm = zone.records.locator('[data-request-form="DVC-15"]');
        await expect(inForm).toBeVisible();
        await pick(zone.records, inForm, WORD.vehicle, plate, new RegExp(escaped(plate)));
        await filingWithoutFee(zone.records, inForm);
        const inId = zone.records.url().split('/').pop() ?? '';
        await act(zone.records, inId, 'submit', 'submit');
        await inState(zone.records, inId, 'review');
        await act(zone.officer, inId, 'approve', WORD.approve);
        await inState(zone.lead, inId, 'approval');
        await act(zone.lead, inId, 'approve', WORD.approve);
        await inState(zone.officer, inId, 'receive');
        await act(zone.officer, inId, 'receive', WORD.receive);
        await inState(zone.officer, inId, 'received');

        // the register: the zone handles the vehicle now
        const record = await api(zone.officer).get<{ handlingUnit: { code: string } }>(`v1/vehicles/${vehicle?.id}`);
        expect(record.handlingUnit.code).toBe('WOL');
    });
});
