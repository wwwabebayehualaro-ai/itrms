/**
 * The back-capture of a paper vehicle file in a browser, end to end, as it is seeded (ADR-0054, task 1.13, MIG-01). Only the requests
 * list is service-specific: the request form, the case page and the register's screens are the platform's.
 *
 * At Boditi, the register finds no vehicle for an old plate and offers the back-capture; the records officer captures the paper file
 * (its first registration in the Ethiopian calendar, the old plate, the scan) and the competency officer checks it against the paper
 * and verifies it. Only then does the register find the vehicle, marked as migrated, with its paper reference and its verifier.
 */
import { randomInt } from 'node:crypto';

import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, ethiopianDay, generated, inState, person, pick } from './support';

/** A VIN with its check digit right, generated: never a real vehicle's. */
function generatedVin(): string {
    const base = `1HGCM82B0${randomInt(10, 99)}${String(randomInt(0, 999999)).padStart(6, '0')}`;
    return `${base.slice(0, 8)}${vinCheckDigit(base) ?? '0'}${base.slice(9)}`;
}

const scan = {
    name: 'paper-file.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% paper file\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
};

const WORD = {
    owner: 'ባለቤት (ሰው)',
    paperReference: 'የወረቀት ፋይል ቁጥር',
    plate: 'ተሽከርካሪው የያዘው ሰሌዳ',
    chassis: 'የሻሲ ቁጥር',
    make: 'ሰሪ',
    model: 'ሞዴል',
    year: 'የተመረተበት ዓመት',
    category: 'የተሽከርካሪ ምድብ',
    use: 'አገልግሎት',
    automobile: 'አውቶሞቢል',
    private: 'የግል',
    addOwner: 'ባለቤት ጨምር',
    file: 'ጥያቄውን ጀምር',
    verify: 'ከወረቀቱ ጋር ይመሳሰላል፤ መዝግብ',
    backCapture: 'የወረቀት ፋይሉን መዝግብ',
    fromPaper: 'ከወረቀት ፋይሉ የተመዘገበ'
} as const;

interface People {
    records: Page;
    officer: Page;
}

test.describe.configure({ mode: 'serial' });

test.describe('the back-capture of a paper vehicle file', () => {
    let people: People;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        people = {
            records: await person(browser, BODITI.records),
            officer: await person(browser, BODITI.officer)
        };
    });

    test('a vehicle on paper joins the register only once a second person verifies it, marked as migrated', async () => {
        test.setTimeout(420_000);
        const { records, officer } = people;

        const father = generated();
        const owner = `ባለቤት ${father}`;
        await api(officer).post('v1/persons', {
            nameAm: { given: 'ባለቤት', father, grandfather: 'ታደሰ' },
            sex: 'female',
            birthYear: 1979,
            acknowledgedDuplicates: []
        });
        const plate = `AA 2-${randomInt(10000, 99999)}`;
        const reference = `BOD/VEH/${randomInt(100000, 999999)}`;

        // the register has no vehicle with this old plate: it offers the back-capture of its paper file
        await records.goto(`/registry/vehicles?q=${encodeURIComponent(plate)}`);
        await records.locator('[data-back-capture]').click();
        await expect(records).toHaveURL(/\/competency\/back-captures\/new$/);

        const form = records.locator('[data-request-form="MIG-01"]');
        await expect(form).toBeVisible();
        const row = form.locator('[data-row="0"]');
        if ((await row.count()) === 0) await form.getByRole('button', { name: WORD.addOwner }).click();
        await expect(form.locator('[data-row]')).toHaveCount(1);
        const named = (label: string) => new RegExp(`^${label}( [*])?$`);
        const input = (label: string) => form.getByRole('textbox', { name: named(label) });
        const choose = async (label: string, option: string) => {
            await form.getByRole('combobox', { name: named(label) }).click();
            await records.getByRole('option', { name: option, exact: true }).click();
        };
        await input(WORD.paperReference).fill(reference);
        await form.locator('[data-field-id="paperFileScan"] input[type="file"]').setInputFiles(scan);
        await expect(form.locator('[data-field-id="paperFileScan"]')).toContainText('paper-file.pdf');
        await pick(records, row, WORD.owner, owner, new RegExp(owner));
        // first registered on 4 Ginbot 2001 E.C., as the file says
        await ethiopianDay(records, form.locator('[data-field-id="firstRegisteredOn"] button').first(), {
            year: 2001,
            month: 9,
            day: 4
        });
        await input(WORD.plate).fill(plate);
        const chassis = generatedVin();
        await input(WORD.chassis).fill(chassis);
        await input(WORD.make).fill('Toyota');
        await input(WORD.model).fill('Corolla');
        await input(WORD.year).fill('2008');
        await choose(WORD.category, WORD.automobile);
        await choose(WORD.use, WORD.private);
        // the file gives no seats: in back-capture mode the box stays empty
        await form.getByRole('button', { name: WORD.file }).click();
        await expect(records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        const caseId = records.url().split('/').pop() ?? '';
        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'verification');

        // captured, not verified: still not on the register
        const before = await api(officer).get<{ items: unknown[] }>(`v1/vehicles?q=${encodeURIComponent(plate)}`);
        expect(before.items).toEqual([]);

        // the competency officer checks it against the paper and verifies it
        await act(officer, caseId, 'verify', WORD.verify);
        await inState(officer, caseId, 'captured');

        // the register finds it by its old plate, marked as migrated in the results and on its record
        await officer.goto(`/registry/vehicles?q=${encodeURIComponent(plate)}`);
        const result = officer.locator('[data-results] [data-vehicle]').first();
        await expect(result.locator('[data-migrated="back_capture"]')).toBeVisible();
        await result.getByRole('link').first().click();
        await expect(officer.locator('[data-screen="vehicle-record"] [data-migration="back_capture"]')).toContainText(
            WORD.fromPaper
        );
        await expect(officer.locator('[data-paper-reference]')).toHaveText(reference);
        await expect(officer.locator('[data-paper-reference]')).toHaveAttribute('href', `/cases/${caseId}`);
    });
});
