/**
 * A vehicle arriving from another region in a browser, end to end, as it is seeded (task 1.4c3, DVC-17, ADR-0060). The request form,
 * the case page and the till are the platform's.
 *
 * On the demo's register (`pnpm demo:reset`): Boditi's records officer files the vehicle and the transfer document its owner brought
 * (the vehicle is on an old regional plate, so it takes a national one), the officer checks it, the revenue collector takes the fee,
 * the team leader approves (a plate is held for the case) and the officer registers the vehicle. The register then reads it active at
 * Boditi on a national plate, its old plate in the plate history ended as exchanged. Owner, chassis, plate and document number are
 * generated on every run.
 */
import { randomInt } from 'node:crypto';

import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { expect, test } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, ethiopianDay, filing, generated, inState, payAtTheTill, person, pick } from './support';

/** A VIN with its check digit right, generated: never a real vehicle's. */
function generatedVin(): string {
    const base = `1HGCM82B0${randomInt(10, 99)}${String(randomInt(0, 999999)).padStart(6, '0')}`;
    return `${base.slice(0, 8)}${vinCheckDigit(base) ?? '0'}${base.slice(9)}`;
}

const scan = {
    name: 'transfer-document.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(
        '%PDF-1.4\n% transfer document\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
    )
};

const WORD = {
    owner: 'ባለቤት (ሰው)',
    number: 'የማስተላለፊያ ሰነድ ቁጥር',
    region: 'ሰነዱን የሰጠው ክልል',
    office: 'ሰነዱን የሰጠው መሥሪያ ቤት',
    verified: 'ሰነዱን በሰጪው አካል',
    how: 'ሰነዱ እንዴት ተረጋገጠ',
    page: 'በሰጪው አካል የማረጋገጫ ድረ ገጽ',
    plate: 'ተሽከርካሪው የያዘው ሰሌዳ',
    takes: 'አሮጌ የክልል ሰሌዳው በብሔራዊ ሰሌዳ ይቀየራል',
    libre: 'የፌዴራል ሊብሬ ቁጥር',
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
    addOwner: 'ባለቤት ጨምር'
} as const;

interface Vehicle {
    status: string;
    currentPlate: { text: string; format: string } | null;
    handlingUnit: { code: string };
    plates: { text: string; format: string; until: string | null; endedReason: string | null }[];
}

test.describe.configure({ mode: 'serial' });

test.describe('a vehicle arriving from another region', () => {
    test('is registered at Boditi with a national plate, its old plate exchanged', async ({ browser }) => {
        test.setTimeout(600_000);
        const boditi = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            lead: await person(browser, BODITI.lead),
            officer: await person(browser, BODITI.officer)
        };

        // who owns the vehicle: a generated sample owner
        const father = generated();
        const owner = `ባለቤት ${father}`;
        await api(boditi.officer).post('v1/persons', {
            nameAm: { given: 'ባለቤት', father, grandfather: 'ታደሰ' },
            sex: 'female',
            birthYear: 1985,
            acknowledgedDuplicates: []
        });
        const chassis = generatedVin();
        const oldPlate = `AA 2-${randomInt(10000, 99999)}`;
        const documentNumber = `VT/${randomInt(100000, 999999)}`;

        await boditi.records.goto('/competency/vehicle-transfers/arrival/new');
        const form = boditi.records.locator('[data-request-form="DVC-17"]');
        await expect(form).toBeVisible();
        const row = form.locator('[data-row="0"]');
        if ((await row.count()) === 0) await form.getByRole('button', { name: WORD.addOwner }).click();
        await expect(form.locator('[data-row]')).toHaveCount(1);
        // a required field's name ends in its asterisk
        const named = (label: string) => new RegExp(`^${label}( [*])?$`);
        const input = (label: string) => form.getByRole('textbox', { name: named(label) });
        const choose = async (label: string, option: string) => {
            await form.getByRole('combobox', { name: named(label) }).click();
            await boditi.records.getByRole('option', { name: option, exact: true }).click();
        };
        const day = (id: string, d: { year: number; month: number; day: number }) =>
            ethiopianDay(boditi.records, form.locator(`[data-field-id="${id}"] button`).first(), d);

        // the document the owner brought, checked by the officer on its issuer's page
        await input(WORD.number).fill(documentNumber);
        await input(WORD.region).fill('Sample Region');
        await input(WORD.office).fill('Sample Transport Bureau');
        await day('documentDate', { year: 2018, month: 1, day: 1 });
        await day('documentValidUntil', { year: 2100, month: 1, day: 1 });
        await form.getByRole('checkbox', { name: new RegExp(`^${WORD.verified}`) }).check();
        await choose(WORD.how, WORD.page);
        await form.locator('[data-field-id="transferDocumentScan"] input[type="file"]').setInputFiles(scan);
        await expect(form.locator('[data-field-id="transferDocumentScan"]')).toContainText('transfer-document.pdf');

        // the vehicle, as its papers say
        await pick(boditi.records, row, WORD.owner, owner, new RegExp(owner));
        await day('firstRegisteredOn', { year: 2008, month: 1, day: 1 });
        await input(WORD.plate).fill(oldPlate);
        await form.getByRole('checkbox', { name: new RegExp(`^${WORD.takes}`) }).check();
        await input(WORD.libre).fill(`FED-${randomInt(100000, 999999)}`);
        await day('libreIssuedOn', { year: 2010, month: 1, day: 1 });
        await input(WORD.chassis).fill(chassis);
        await input(WORD.make).fill('Toyota');
        await input(WORD.model).fill('Vitz');
        await input(WORD.year).fill('2014');
        await choose(WORD.category, WORD.automobile);
        await choose(WORD.use, WORD.private);
        await input(WORD.seats).fill('5');
        await filing(boditi.records, form);
        const caseId = boditi.records.url().split('/').pop() ?? '';
        await act(boditi.records, caseId, 'submit', 'submit');
        await inState(boditi.records, caseId, 'review');

        // the review, the fee at the till, and the final approval, which holds a national plate for the case
        await act(boditi.officer, caseId, 'approve', WORD.approve);
        await inState(boditi.officer, caseId, 'payment');
        const { number } = await api(boditi.records).get<{ number: number }>(`v1/cases/${caseId}`);
        await payAtTheTill(boditi.cashier, number);
        await inState(boditi.lead, caseId, 'approval');
        await act(boditi.lead, caseId, 'approve', WORD.approve);
        await inState(boditi.officer, caseId, 'arrival');

        // the officer registers it; the plate step names no other plate
        await act(boditi.officer, caseId, 'register', WORD.register);
        await inState(boditi.officer, caseId, 'registered');

        // the registration certificate (beside the fee's receipt)
        const issued = await api(boditi.officer).get<{ items: { templateKey: string }[] }>(
            `v1/issued-documents?caseId=${caseId}`
        );
        expect(issued.items.filter((d) => d.templateKey === 'vehicle-registration-certificate')).toHaveLength(1);

        // the register: active at Boditi, on a national plate, the old plate ended as exchanged
        const found = await api(boditi.officer).get<{ items: { id: string }[] }>(`v1/vehicles?q=${chassis}`);
        const id = found.items[0]?.id;
        expect(id, 'the vehicle the case registered').toBeDefined();
        const vehicle = await api(boditi.officer).get<Vehicle>(`v1/vehicles/${id}`);
        expect(vehicle.status).toBe('active');
        expect(vehicle.handlingUnit.code).toBe('WOL-BODITI');
        expect(vehicle.currentPlate?.format).toBe('national');
        expect(vehicle.currentPlate?.text).toMatch(/^ETH [A-Z]{3} \d{4}$/);
        const old = vehicle.plates.find((p) => p.format === 'legacy');
        expect(old?.endedReason).toBe('exchanged');
        expect(old?.until).not.toBeNull();
    });
});
