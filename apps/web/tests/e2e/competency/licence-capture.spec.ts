/**
 * The back-capture of a paper driver licence in a browser, end to end, as it is seeded (MIG-02, ADR-0054, task 1.6b). Only the
 * requests list is service-specific: the request form, the case page and the register's screens are the platform's.
 *
 * At Boditi, the licence register finds nothing for a printed number: it tells the officer the records officer captures it, and offers
 * the records officer (who reads the register through a role grant, ADR-0065) the capture itself. The records officer captures the paper
 * licence (its holder, the printed number and card serial, its days in the Ethiopian calendar, its
 * grade, the scan) and the competency officer checks it against the paper and verifies it. Only then does the register find the licence, with the number printed
 * on it, marked as captured from paper.
 */
import { randomInt } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, ethiopianDay, generated, inState, person, pick } from './support';

const scan = {
    name: 'paper-licence.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% paper licence\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
};

const WORD = {
    holder: 'የፈቃዱ ባለቤት',
    paperReference: 'የወረቀት ፋይል ቁጥር',
    number: 'በፈቃዱ ላይ የታተመው ቁጥር',
    cardSerial: 'የካርድ ሴሪ ቁጥር (ካለ)',
    kind: 'የፈቃዱ ዓይነት',
    permanent: 'ቋሚ',
    grade: 'ደረጃ',
    addGrade: 'ደረጃ ጨምር',
    automobile: 'አውቶሞቢል',
    file: 'ጥያቄውን ጀምር',
    verify: 'ከወረቀቱ ጋር ይመሳሰላል፤ መዝግብ',
    notOnRegister: 'ፈቃዱ በወረቀት ብቻ ካለ፣ የሪከርድ ባለሙያው ከወረቀቱ ይመዘግበዋል፤ ከዚያ እርስዎ ከወረቀቱ ጋር ያረጋግጡታል።'
} as const;

interface People {
    records: Page;
    officer: Page;
}

test.describe.configure({ mode: 'serial' });

test.describe('the back-capture of a paper driver licence', () => {
    let people: People;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        people = {
            records: await person(browser, BODITI.records),
            officer: await person(browser, BODITI.officer)
        };
    });

    test('a licence on paper joins the register only once a second person verifies it, with its printed number', async () => {
        test.setTimeout(420_000);
        const { records, officer } = people;

        const father = generated();
        const holder = `አሽከርካሪ ${father}`;
        await api(officer).post('v1/persons', {
            nameAm: { given: 'አሽከርካሪ', father, grandfather: 'ታደሰ' },
            sex: 'male',
            birthYear: 1985,
            acknowledgedDuplicates: []
        });
        // an old booklet's number, with its one-digit grade prefix (ADR-0051): outside the range the demo region reserves for ITRMS
        // (all of 06-…), generated
        const number = `4-${String(randomInt(100000, 999999))}`;
        const serial = `ሀ-${randomInt(100000, 999999)}`;
        const reference = `BOD/DL/${randomInt(100000, 999999)}`;

        // the register has no licence with this number: the officer, who reads it but does not file, is told the records officer
        // captures it from paper (who files is offered the capture itself: the integration suite's clerk)
        await officer.goto('/competency/licences');
        await officer.locator('#licence-number').fill(number);
        await officer.locator('form[role="search"] button[type="submit"]').click();
        await expect(officer.getByText(WORD.notOnRegister)).toBeVisible();
        await expect(officer.locator('[data-licence-back-capture]')).toHaveCount(0);

        // the intake desk reads the register too (a role grant, ADR-0065, on by default): its empty search offers the capture
        await records.goto('/competency/licences');
        await records.locator('#licence-number').fill(number);
        await records.locator('form[role="search"] button[type="submit"]').click();
        await records.locator('[data-licence-back-capture]').click();
        await expect(records).toHaveURL(/\/competency\/licence-captures\/new$/);

        const form = records.locator('[data-request-form="MIG-02"]');
        await expect(form).toBeVisible();
        const named = (label: string) => new RegExp(`^${label.replace(/[()]/g, '\\$&')}( [*])?$`);
        const input = (label: string) => form.getByRole('textbox', { name: named(label) });
        await input(WORD.paperReference).fill(reference);
        await form.locator('[data-field-id="paperFileScan"] input[type="file"]').setInputFiles(scan);
        await expect(form.locator('[data-field-id="paperFileScan"]')).toContainText('paper-licence.pdf');
        await pick(records, form, WORD.holder, holder, new RegExp(holder));
        await input(WORD.number).fill(number);
        await input(WORD.cardSerial).fill(serial);
        await form.getByRole('combobox', { name: named(WORD.kind) }).click();
        await records.getByRole('option', { name: WORD.permanent, exact: true }).click();
        // issued on 8 Hamle 2013 E.C., valid to 7 Hamle 2017, as the paper says
        await ethiopianDay(records, form.locator('[data-field-id="issuedOn"] button').first(), {
            year: 2013,
            month: 11,
            day: 8
        });
        await ethiopianDay(records, form.locator('[data-field-id="validUntil"] button').first(), {
            year: 2017,
            month: 11,
            day: 7
        });
        const row = form.locator('[data-row="0"]');
        if ((await row.count()) === 0) await form.getByRole('button', { name: WORD.addGrade }).click();
        await expect(form.locator('[data-row]')).toHaveCount(1);
        await row.getByRole('combobox', { name: named(WORD.grade) }).click();
        await records.getByRole('option', { name: WORD.automobile, exact: true }).click();
        await form.getByRole('button', { name: WORD.file }).click();
        await expect(records).toHaveURL(/\/cases\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        const caseId = records.url().split('/').pop() ?? '';
        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'verification');

        // captured, not verified: still not on the register
        const before = await api(officer).get<{ items: unknown[] }>(
            `v1/competency/licences?number=${encodeURIComponent(number)}`
        );
        expect(before.items).toEqual([]);

        // the competency officer checks it against the paper and verifies it
        await act(officer, caseId, 'verify', WORD.verify);
        await inState(officer, caseId, 'captured');

        // the register finds it by the number printed on it, marked as captured from paper
        await officer.goto('/competency/licences');
        await officer.locator('#licence-number').fill(number);
        await officer.locator('form[role="search"] button[type="submit"]').click();
        const found = officer.locator('[data-licences] [data-licence]').first();
        await expect(found.locator('[data-licence-number]')).toHaveText(number);
        await expect(found.locator('[data-card-serial]')).toHaveText(serial);
        await expect(found.locator('[data-status="migrated"]')).toBeVisible();
        await expect(found).toHaveAttribute('data-kind', 'permanent');
    });
});
