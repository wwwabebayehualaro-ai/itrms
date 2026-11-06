/**
 * The demo journey, steps 1–8 of docs/demo-plan.md §3 (task 0.25c), as docs/demo-script.md tells it: once in Amharic and once in
 * English, on the data `pnpm demo:reset` makes. Also the regression suite of the licence services for later phases.
 *
 *   1  sign-in with a second factor; the sign-in screen in Amharic; the app in Wolaytta (falling back to Amharic) and back
 *   2  a new applicant registered at Boditi, the school's list, a new licence filed with its documents and its fee
 *   3  the isolation: Damot Gale sees no licence case; the zone sees Boditi's, and has nothing to do on it
 *   4  the case returned with a comment, corrected with a new scan of the ID, both on the timeline (the medical certificate is
 *      sensitive: the records officer never sees it, so a correction keeps it as it is)
 *   5  the exam
 *   6  the fee at the till, a numbered receipt with a QR
 *   7  final approval (the reviewer refused), a temporary licence for 2 years, the print batch, the card
 *   8  the card's QR checked on the public verification endpoint, as a phone does: valid, with a masked name
 */
import { randomInt, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';

import {
    act,
    BODITI,
    ethiopianDay,
    filing,
    generated,
    inState,
    latin,
    payAtTheTill,
    person,
    pick,
    speaks,
    today,
    WORDS,
    type Lang
} from '../competency/support';
import { api } from '../forms/support';
import { firstSignIn, resetAccount } from '../keycloak';

const ZONE_OFFICER = { id: '0199f0a0-d000-7000-8000-000000000104', username: 'demo.zone.officer1' };
const DAMOT_SAFETY = { id: '0199f0a0-d000-7000-8000-000000000203', username: 'demo.damot.safety' };
const API = 'http://127.0.0.1:4000';
const CSRF_COOKIE = '__Host-itrms_csrf';
const ETHIOPIC = /[ሀ-፿]/;

/** A tiny PDF, as a scanner would give: the register keeps it, the officer opens it. */
const scan = (name: string) => ({
    name: `${name}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% ${name}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
});

/** A request through the person's session that is meant to be refused: its status, not an error. */
async function attempt(page: Page, method: string, path: string, data?: unknown, version?: number) {
    const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE)?.value ?? '';
    const res = await page.request.fetch(`/api/${path}`, {
        method,
        data,
        headers: {
            'x-csrf-token': csrf,
            origin: new URL(page.url()).origin,
            ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
            ...(version === undefined ? {} : { 'if-match': `"${version}"` })
        }
    });
    return res.status();
}

/** The address a document's QR holds: the card links it too, so a phone that opens the PDF can tap it. */
function verificationUrl(pdf: Buffer): string {
    const find = (text: string) => /\/URI\s*\((https?:\/\/[^)]+)\)/.exec(text)?.[1];
    const plain = find(pdf.toString('latin1'));
    if (plain) return plain;
    // in a compressed stream
    const raw = pdf.toString('latin1');
    for (const m of raw.matchAll(/stream\r?\n/g)) {
        const start = (m.index ?? 0) + m[0].length;
        const end = raw.indexOf('endstream', start);
        try {
            const found = find(inflateSync(pdf.subarray(start, end)).toString('latin1'));
            if (found) return found;
        } catch {
            // not a deflated stream
        }
    }
    throw new Error('the PDF links no verification address');
}

for (const lang of ['am', 'en'] as const satisfies readonly Lang[]) {
    const W = WORDS[lang];

    test.describe(`the demo journey, steps 1–8 (${lang})`, () => {
        test.describe.configure({ mode: 'serial' });

        let records: Page;
        let officer: Page;
        let cashier: Page;
        let lead: Page;
        const applicant = { givenAm: generated(), fatherAm: generated(), givenEn: latin(), fatherEn: latin() };
        const fullName = `${applicant.givenAm} ${applicant.fatherAm}`;
        const shown = new RegExp(`${applicant.givenAm}|${applicant.givenEn}`);
        let personId = '';
        let caseId = '';

        // the demo accounts are shared with the other journeys, which read Amharic: each is left in Amharic, as it started
        test.afterAll(async () => {
            for (const page of [records, officer, cashier, lead]) {
                if (!page || page.isClosed()) continue;
                await api(page)
                    .patch('v1/me/preferences', { language: 'am' }, 0)
                    .catch(() => undefined);
                await page.context().close();
            }
        });

        test('1. signs in with a second factor, and shows Wolaytta', async ({ browser }) => {
            test.setTimeout(300_000);
            await resetAccount(BODITI.records.id);
            records = await (await browser.newContext()).newPage();
            await records.goto('/');
            // the sign-in screen speaks Amharic first
            const button = records.locator('#kc-login');
            await expect(button).toBeVisible();
            expect(await button.evaluate((e) => (e as HTMLInputElement).value || e.textContent || '')).toMatch(
                ETHIOPIC
            );
            await firstSignIn(records, BODITI.records.username);
            await speaks(records, 'am');

            // Wolaytta, as far as it is translated: the rest in Amharic
            const sidebar = records.locator('[data-app-sidebar]');
            await records.locator('[data-user-menu]').click();
            await records.getByRole('menuitem', { name: 'ቋንቋ' }).click();
            await records.getByRole('menuitemradio', { name: 'Wolayttatto' }).click();
            await expect(records.locator('html')).toHaveAttribute('lang', 'wal-Latn');
            await expect(sidebar.getByRole('link', { name: 'መነሻ' })).toBeVisible();
            await speaks(records, lang);
            await expect(sidebar.getByRole('link', { name: W.home })).toBeVisible();

            officer = await person(browser, BODITI.officer);
            cashier = await person(browser, BODITI.cashier);
            lead = await person(browser, BODITI.lead);
            for (const page of [officer, cashier, lead]) await speaks(page, lang);
        });

        test('2. registers the applicant, and files a new licence with its documents and fee', async () => {
            test.setTimeout(420_000);
            // the register: both scripts, an Ethiopian birth date, a Fayda number, an address down to the kebele
            await records.locator('[data-app-sidebar] [data-menu-item="parties.persons"]').click();
            await records.getByRole('link', { name: W.newPerson }).first().click();
            await expect(records.locator('[data-screen="person-new"]')).toBeVisible();
            await records.locator('#givenAm').fill(applicant.givenAm);
            await records.locator('#fatherAm').fill(applicant.fatherAm);
            await records.locator('#givenEn').fill(applicant.givenEn);
            await records.locator('#fatherEn').fill(applicant.fatherEn);
            await records.locator('#sex').click();
            await records.getByRole('option', { name: W.female }).click();
            await ethiopianDay(records, records.locator('#birthDate'), { year: 1982, month: 5, day: 7 });
            await records.locator('#addressUnitId').click();
            await records.getByRole('option').first().click();
            await records.locator('#kebele').fill('03');
            await records.locator('#fin').fill(`4${String(randomInt(10 ** 10, 10 ** 11 - 1))}`);
            await records.getByRole('button', { name: W.register }).click();
            await expect(records.locator('[data-screen="person-record"]')).toBeVisible();
            personId = /\/([0-9a-f-]{36})$/.exec(records.url())?.[1] ?? '';
            expect(personId).not.toBe('');

            // the school's list: the applicant trained at a demo school
            await officer.goto('/competency/training');
            const enrol = officer.locator('[data-enrol]');
            await pick(officer, enrol, W.person, applicant.givenAm, shown, lang);
            await pick(officer, enrol, W.school, W.school_a, W.school_a, lang);
            await enrol.getByRole('combobox', { name: W.enrolGrade }).click();
            await officer.getByRole('option', { name: W.automobile }).click();
            await enrol.getByRole('button', { name: W.add }).click();
            const listed = officer.locator(`[data-enrolment][data-person="${personId}"]`);
            await listed.locator('[data-action="complete"]').click();
            await expect(listed).toHaveAttribute('data-status', 'completed');

            // the counter: the request, its documents, the school by a lookup, the fee shown before it is filed
            await records.goto('/competency/applications');
            await records.locator('[data-applications]').getByRole('link').click();
            const form = records.locator('[data-request-form="DVC-03"]');
            await pick(records, form, W.applicant, applicant.givenAm, shown, lang);
            await form.getByRole('combobox', { name: W.grade }).click();
            await records.getByRole('option', { name: W.automobile, exact: true }).click();
            await form.getByLabel(W.education).fill('10');
            await pick(records, form, W.school, W.school_a, W.school_a, lang);
            await form.getByLabel(W.facility).fill('Sample Health Centre');
            await today(records, form, W.examined);
            for (const [field, file] of [
                ['educationCertificate', 'education'],
                ['identityDocument', 'kebele-id'],
                ['medicalCertificate', 'medical'],
                ['trainingCertificate', 'training']
            ] as const) {
                await form.locator(`[data-field-id="${field}"] input[type="file"]`).setInputFiles(scan(file));
                await expect(form.locator(`[data-field-id="${field}"]`)).toContainText(`${file}.pdf`);
            }
            await filing(records, form, lang);
            caseId = /\/cases\/([0-9a-f-]{36})$/.exec(records.url())?.[1] ?? '';
            await act(records, caseId, 'submit', 'submit');
            await inState(records, caseId, 'review');
        });

        test('3. keeps the case to Boditi and the zone above it', async ({ browser }) => {
            test.setTimeout(240_000);
            // a road-safety officer in Damot Gale, a sibling of Boditi: no licence case, not even this one
            const damot = await person(browser, DAMOT_SAFETY);
            await expect(damot.locator('[data-app-sidebar] [data-menu-item^="competency."]')).toHaveCount(0);
            // refused, as a case of another office is: not found under its scope, or not a thing it may read
            expect([403, 404]).toContain(await attempt(damot, 'GET', `v1/cases/${caseId}`));

            // the zone's competency officer sees Boditi's case (its subtree), and has no step of it to take
            const zone = await person(browser, ZONE_OFFICER);
            await zone.goto(`/cases/${caseId}`);
            await expect(zone.locator('[data-screen="case"]')).toHaveAttribute('data-state', 'review');
            await expect(zone.locator('[data-actions] [data-action]')).toHaveCount(0);
            const { version } = await api(zone).get<{ version: number }>(`v1/cases/${caseId}`);
            expect(await attempt(zone, 'POST', `v1/cases/${caseId}/transitions`, { action: 'approve' }, version)).toBe(
                403
            );
            await damot.context().close();
            await zone.context().close();
        });

        test('4. is returned once with a comment, corrected with a readable certificate, and both are on its timeline', async () => {
            test.setTimeout(300_000);
            await act(officer, caseId, 'return', W.returnIt, (dialog) =>
                dialog.locator('#action-comment').fill(W.unreadable)
            );
            await inState(records, caseId, 'draft');

            // the records officer reads why, and files the request again with a new scan
            await records.goto(`/cases/${caseId}`);
            await expect(records.locator('[data-timeline]')).toContainText(W.unreadable);
            await records.locator('[data-actions] [data-action="correct"]').click();
            const dialog = records.locator('[data-action-dialog="correct"]');
            await dialog
                .locator('[data-field-id="identityDocument"] input[type="file"]')
                .setInputFiles(scan('kebele-id-rescanned'));
            await expect(dialog.locator('[data-field-id="identityDocument"]')).toContainText('kebele-id-rescanned.pdf');
            // a correction shows no fee: it is worked out again as the corrected request goes in (fees.assess)
            // the whole request is taller than the screen: its button is reached by scrolling the dialog
            await dialog.getByRole('button', { name: W.correct, exact: true }).click();
            await expect(dialog).toBeHidden({ timeout: 60_000 });
            await inState(records, caseId, 'review');

            await records.reload();
            const timeline = records.locator('[data-timeline]');
            await expect(timeline).toContainText(W.unreadable);
            // the return, then the correction that changed the ID's scan
            await expect(timeline.locator('[data-amended]')).toHaveAttribute('data-amended', /identityDocument/);
            expect(await timeline.locator('[data-event="transition"]').count()).toBeGreaterThanOrEqual(3);
        });

        test('5. passes its exam', async () => {
            test.setTimeout(240_000);
            await act(officer, caseId, 'approve', W.approve);
            await inState(officer, caseId, 'exam');
            await act(officer, caseId, 'pass', W.passed, async (dialog) => {
                await today(officer, dialog, W.heldOn);
                await dialog.getByLabel(W.theory).fill('82');
                await dialog.getByLabel(W.practical).fill('78');
                await dialog.getByRole('checkbox', { name: W.passed }).click();
            });
            await inState(officer, caseId, 'payment');
        });

        test('6. is paid at Boditi’s till, with a numbered receipt that carries a QR', async () => {
            test.setTimeout(240_000);
            const { number } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
            await payAtTheTill(cashier, number, lang);
            await expect(cashier.locator('[data-receipt-number]')).toContainText(/\d/);
            await expect(cashier.locator('[data-qr-on-pdf]')).toBeVisible();
            await inState(lead, caseId, 'approval');
        });

        test('7. is approved by the team leader, never by its reviewer, and makes a temporary licence and its card', async () => {
            test.setTimeout(300_000);
            // the reviewer has no hand in the final approval
            await officer.goto(`/cases/${caseId}`);
            await expect(officer.locator('[data-screen="case"]')).toHaveAttribute('data-state', 'approval');
            await expect(officer.locator('[data-actions] [data-action="approve"]')).toHaveCount(0);
            const { version } = await api(officer).get<{ version: number }>(`v1/cases/${caseId}`);
            expect(
                await attempt(officer, 'POST', `v1/cases/${caseId}/transitions`, { action: 'approve' }, version)
            ).toBe(403);

            // the team leader approves; the national platform answers (the fake, through the outbox), then the licence is made
            await act(lead, caseId, 'approve', W.approve);
            await inState(lead, caseId, 'issued');
            await records.goto(`/cases/${caseId}`);
            await expect(records.locator('[data-case-documents] [data-document="licence-card"]')).toHaveAttribute(
                'data-state',
                'rendered',
                { timeout: 120_000 }
            );

            // temporary, for two years, numbered by Boditi
            const { items } = await api(officer).get<{ items: { id: string; number: string }[] }>(
                `v1/competency/licences?personId=${personId}`
            );
            const licence = items[0];
            expect(licence?.number).toMatch(/^WOL-BODITI\/DL\/\d{6}$/);
            await officer.goto('/competency/licences');
            await officer.getByLabel(W.licenceNumber).fill(licence?.number ?? '');
            await officer.locator('[data-screen="licences"]').getByRole('button', { name: W.find }).click();
            const row = officer.locator(`[data-licence="${licence?.id}"]`);
            await expect(row).toHaveAttribute('data-status', 'active');
            await expect(row).toHaveAttribute('data-kind', 'temporary');

            // in the region's print batch
            await lead.goto('/competency/print-batches');
            await expect(lead.locator('[data-batch][data-status="open"] [data-batch-licences]')).not.toHaveText('0');
        });

        test('8. shows "valid", with a masked name, to whoever checks its QR', async ({ request }) => {
            test.setTimeout(180_000);
            const staff = api(records);
            const { items } = await staff.get<{ items: { id: string; templateKey: string; state: string }[] }>(
                `v1/issued-documents?caseId=${caseId}`
            );
            const card = items.find((d) => d.templateKey === 'licence-card');
            expect(card?.state).toBe('rendered');
            const { url } = await staff.get<{ url: string }>(`v1/issued-documents/${card?.id}/download`);
            const pdf = Buffer.from(await (await request.get(url)).body());
            expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

            // what a phone reads from the QR: the token in its address; the public check needs no sign-in
            const address = new URL(verificationUrl(pdf));
            const token = address.pathname.split('/').pop() ?? '';
            const res = await request.get(`${API}/api/v1/public/verifications/${token}`);
            expect(res.status()).toBe(200);
            const shownToAnyone = (await res.json()) as {
                status: string;
                holder: string | null;
                number: string | null;
            };
            expect(shownToAnyone.status).toBe('valid');
            expect(shownToAnyone.number).toMatch(/^WOL-BODITI\/DL\/\d{6}$/);
            expect(shownToAnyone.holder).toBeTruthy();
            expect(shownToAnyone.holder).not.toContain(fullName);
            expect(shownToAnyone.holder).not.toContain(applicant.fatherAm);
        });
    });
}
