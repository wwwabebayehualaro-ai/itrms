/**
 * The demo journey, steps 1–10 of docs/demo-plan.md §3 (tasks 0.25c, 0.25d), as docs/demo-script.md tells it: once in Amharic and once in
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
 *   9  at the zone, a licence 14 months late renewed: the practical exam, the late fee, paid at the revenue office and verified
 *      by the zone's finance officer; the same receipt refused on another renewal
 *  10  the bureau sends Boditi's final approvals to the zone (an office's override), not its fee rule (not an office's to
 *      change); Boditi's next case is approved at the zone
 */
import { randomInt } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { addisDay, addMonths } from '@itrms/competency/contracts';
import { toEthiopian } from '@itrms/ethiopian-calendar';
import { expect, test, type Page } from '@playwright/test';

import {
    act,
    BODITI,
    birr,
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
const BUREAU_ADMIN = { id: '0199f0a0-d000-7000-8000-000000000001', username: 'demo.bureau.admin' };
/** The zone department's people (apps/api/seed/users/wolaita.demo.yaml): demo.dual is its records officer, and Boditi's cashier. */
const ZONE = {
    records: { id: '0199f0a0-d000-7000-8000-000000000401', username: 'demo.dual' },
    lead: { id: '0199f0a0-d000-7000-8000-000000000103', username: 'demo.zone.lead' },
    examiner: { id: '0199f0a0-d000-7000-8000-000000000106', username: 'demo.zone.examiner' },
    finance: { id: '0199f0a0-d000-7000-8000-000000000108', username: 'demo.zone.finance' }
} as const;

interface LicenceRow {
    id: string;
    number: string | null;
    kind: string;
    validUntil: string | null;
    grades: { key: string; name: Record<string, string> }[];
}
// the API itself, as the verifier app calls it (the one playwright.config starts, or E2E_API's)
const API = process.env.E2E_API ?? 'http://127.0.0.1:4000';
const ETHIOPIC = /[ሀ-፿]/;

/** A tiny PDF, as a scanner would give: the register keeps it, the officer opens it. */
const scan = (name: string) => ({
    name: `${name}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% ${name}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
});

type Zone = Partial<Record<keyof typeof ZONE | 'officer', Page>>;

/** A renewal at the zone's counter, through its review and practical exam to its payment. Returns its case's id. */
async function renewalToPayment(zone: Zone, lang: Lang, licence: LicenceRow): Promise<string> {
    const W = WORDS[lang];
    const { records: desk, officer: reviewer, examiner } = zone;
    if (!desk || !reviewer || !examiner || !licence.number || !licence.validUntil)
        throw new Error('the zone signed in');
    const [year = 0, month = 0, day = 0] = licence.validUntil.split('-').map(Number);
    const expiry = toEthiopian({ year, month, day });
    const grade = licence.grades[0]?.name[lang] ?? W.automobile;

    await desk.goto('/competency/applications');
    const applications = desk.locator('[data-applications]');
    await applications.locator('[data-choice="DVC-04"]').click();
    await applications.getByRole('link').click();
    const form = desk.locator('[data-request-form="DVC-04"]');
    await pick(desk, form, W.licence, licence.number, licence.number, lang);
    await form.getByRole('combobox', { name: W.grade }).click();
    await desk.getByRole('option', { name: grade, exact: true }).click();
    await form.getByRole('button', { name: W.expiry }).click();
    await desk.getByLabel(W.year).fill(String(expiry.year));
    await desk.getByLabel(W.month, { exact: true }).selectOption(String(expiry.month));
    await desk.locator(`[role="grid"] [data-day="${expiry.day}"]`).click();
    await form.getByLabel(W.facility).fill('Sample Health Centre');
    await today(desk, form, W.examined);
    await filing(desk, form, lang);
    const renewal = /\/cases\/([0-9a-f-]{36})$/.exec(desk.url())?.[1] ?? '';
    await act(desk, renewal, 'submit', 'submit');

    // more than a year late: the practical exam comes first (Art. 19(5))
    await act(reviewer, renewal, 'approve', W.approve);
    await inState(reviewer, renewal, 'field_exam');
    await act(examiner, renewal, 'pass', W.passed, async (dialog) => {
        await today(examiner, dialog, W.heldOn);
        await dialog.getByLabel(W.practical).fill('74');
        await dialog.getByRole('checkbox', { name: W.passed }).click();
    });
    await inState(desk, renewal, 'payment');
    return renewal;
}

/** The payment order of a case paid elsewhere, opened from the counter's list. */
async function paidElsewhere(page: Page, lang: Lang, caseId: string) {
    const { number } = await api(page).get<{ number: number }>(`v1/cases/${caseId}`);
    await page.locator('[data-app-sidebar] [data-menu-item="fees.elsewhere"]').click();
    await page
        .locator(`[data-queue] [data-case-number="${number}"]`)
        .getByRole('link', { name: WORDS[lang].open })
        .click();
    return page.locator('[data-screen="payment-order"]');
}

/** A revenue office's receipt entered against the open order, for its whole total. */
async function enterReceipt(page: Page, lang: Lang, reference: string) {
    const W = WORDS[lang];
    const total = await page.locator('[data-screen="payment-order"] [data-total]').getAttribute('data-total');
    const entry = page.locator('[data-external-form]');
    await entry.getByRole('combobox', { name: W.paidAt, exact: true }).click();
    await page.getByRole('option', { name: W.revenueOffice }).click();
    await entry.getByLabel(W.reference).fill(reference);
    await entry.locator('#external-amount').fill(birr(total ?? ''));
    await entry.locator('#external-paid-on').click();
    await page.locator('[data-day][aria-current="date"]').click();
    await entry.getByLabel(W.whoPaid).fill('Generated Applicant');
    await page.locator('[data-action="enter-reference"]').click();
}

/** A new licence filed and submitted at Boditi's counter (step 2; step 10 files the next one). Returns its case's id. */
async function fileNewLicence(page: Page, lang: Lang, who: { search: string; shown: RegExp }, withScans: boolean) {
    const W = WORDS[lang];
    await page.goto('/competency/applications');
    await page.locator('[data-applications]').getByRole('link').click();
    const form = page.locator('[data-request-form="DVC-03"]');
    await pick(page, form, W.applicant, who.search, who.shown, lang);
    await form.getByRole('combobox', { name: W.grade }).click();
    await page.getByRole('option', { name: W.automobile, exact: true }).click();
    await form.getByLabel(W.education).fill('10');
    await pick(page, form, W.school, W.school_a, W.school_a, lang);
    await form.getByLabel(W.facility).fill('Sample Health Centre');
    await today(page, form, W.examined);
    if (withScans)
        for (const [field, file] of [
            ['educationCertificate', 'education'],
            ['identityDocument', 'kebele-id'],
            ['medicalCertificate', 'medical'],
            ['trainingCertificate', 'training']
        ] as const) {
            await form.locator(`[data-field-id="${field}"] input[type="file"]`).setInputFiles(scan(file));
            await expect(form.locator(`[data-field-id="${field}"]`)).toContainText(`${file}.pdf`);
        }
    await filing(page, form, lang);
    const id = /\/cases\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? '';
    await act(page, id, 'submit', 'submit');
    await inState(page, id, 'review');
    return id;
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

    test.describe(`the demo journey, steps 1–10 (${lang})`, () => {
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
        // steps 9 and 10: the zone's people, the bureau, the receipt paid at the revenue office, Boditi's override
        const zone: Zone = {};
        let bureau: Page | undefined;
        let boditiId = '';

        // the demo accounts are shared with the other journeys, which read Amharic: each is left in Amharic, as it started
        test.afterAll(async () => {
            // Boditi approves its own cases again, as the other journeys expect
            if (bureau && !bureau.isClosed() && boditiId) {
                const path = `v1/org-units/${boditiId}/services/DVC-03`;
                const { own } = await api(bureau).get<{ own: { version: number } | null }>(`${path}/configuration`);
                if (own)
                    await api(bureau)
                        .delete(`${path}/override`, own.version)
                        .catch(() => undefined);
            }
            for (const page of [records, officer, cashier, lead, bureau, ...Object.values(zone)]) {
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
            await records.getByRole('menuitem', { name: WORDS.am.language }).click();
            await records.getByRole('menuitemradio', { name: 'Wolayttatto' }).click();
            await expect(records.locator('html')).toHaveAttribute('lang', 'wal-Latn');
            await expect(sidebar.getByRole('link', { name: WORDS.am.home })).toBeVisible();
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
            caseId = await fileNewLicence(records, lang, { search: applicant.givenAm, shown }, true);
        });

        test('3. keeps the case to Boditi and the zone above it', async ({ browser }) => {
            test.setTimeout(240_000);
            // a road-safety officer in Damot Gale, a sibling of Boditi: no licence case, not even this one
            const damot = await person(browser, DAMOT_SAFETY);
            // its menu is there (its own work), and has no licence entry
            await expect(damot.locator('[data-app-sidebar] [data-menu-item]').first()).toBeVisible();
            await expect(damot.locator('[data-app-sidebar] [data-menu-item^="competency."]')).toHaveCount(0);
            // refused, as a case of another office is: not found under its scope, or not a thing it may read
            expect([403, 404]).toContain(await api(damot).status('GET', `v1/cases/${caseId}`));

            // the zone's competency officer sees Boditi's case (its subtree), and has no step of it to take
            const zone = await person(browser, ZONE_OFFICER);
            await zone.goto(`/cases/${caseId}`);
            await expect(zone.locator('[data-screen="case"]')).toHaveAttribute('data-state', 'review');
            await expect(zone.locator('[data-actions] [data-action]')).toHaveCount(0);
            const { version } = await api(zone).get<{ version: number }>(`v1/cases/${caseId}`);
            expect(
                await api(zone).status('POST', `v1/cases/${caseId}/transitions`, { action: 'approve' }, version)
            ).toBe(403);
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
                await api(officer).status('POST', `v1/cases/${caseId}/transitions`, { action: 'approve' }, version)
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
            const { items } = await api(officer).get<{
                items: { id: string; number: string; issuedOn: string | null; validUntil: string | null }[];
            }>(`v1/competency/licences?personId=${personId}`);
            const licence = items[0];
            expect(licence?.number).toMatch(/^WOL-BODITI\/DL\/\d{6}$/);
            // valid for two years from its issue (Proclamation 1074/2018: a temporary licence)
            const [year = '', rest = ''] = (licence?.issuedOn ?? '').split(/-(.*)/s);
            expect(licence?.validUntil).toBe(`${Number(year) + 2}-${rest}`);
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
            expect(shownToAnyone.holder).not.toContain(`${applicant.givenEn} ${applicant.fatherEn}`);
            expect(shownToAnyone.holder).not.toContain(applicant.fatherEn);
        });

        test('9. renews at the zone a licence 14 months late: the practical exam, the late fee, a receipt from the revenue office used once', async ({
            browser
        }) => {
            test.setTimeout(600_000);
            zone.records = await person(browser, ZONE.records);
            zone.officer = await person(browser, ZONE_OFFICER);
            zone.examiner = await person(browser, ZONE.examiner);
            zone.finance = await person(browser, ZONE.finance);
            zone.lead = await person(browser, ZONE.lead);
            const { records: desk, officer: reviewer, examiner, finance, lead: zoneLead } = zone;
            if (!desk || !reviewer || !examiner || !finance || !zoneLead) throw new Error('the zone signed in');
            for (const page of [desk, reviewer, examiner, finance, zoneLead]) await speaks(page, lang);

            // demo.dual works at Boditi's till and at the zone's counter: today, at the zone
            const switcher = desk.locator('[data-app-topbar] [data-active-unit]');
            await switcher.click();
            await desk.locator('[data-unit="WOL"]').click();
            await expect(switcher).toHaveAttribute('data-active-unit', 'WOL');

            // a permanent licence that expired 14 months ago (the demo counts its data from the day of its reset)
            // around 14 months: a reset just before midnight in Addis Ababa and a journey just after see different todays
            const [from, to] = [addMonths(addisDay(), -15), addMonths(addisDay(), -13)];
            const { items } = await api(reviewer).get<{ items: LicenceRow[] }>(
                'v1/competency/licences?status=active&limit=100'
            );
            const late = items.filter(
                (l) => l.kind === 'permanent' && l.validUntil !== null && l.validUntil >= from && l.validUntil <= to
            );
            // two of them: each journey renews both, so they leave this list, and the next run (or retry) takes the next two
            const [licence, another] = [late[0], late[1]];
            if (!licence || !another) throw new Error('the demo has permanent licences 14 months late');
            const renewal = await renewalToPayment(zone, lang, licence);

            // the late fee, paid at the revenue office: its receipt entered at the zone's counter
            const order = await paidElsewhere(desk, lang, renewal);
            await expect(order.locator('[data-lines]')).toContainText(W.overYear);
            const reference = `DEMO-${lang.toUpperCase()}-${randomInt(100_000, 999_999)}`;
            await enterReceipt(desk, lang, reference);
            await expect(desk.locator('[data-external-refs] [data-state="pending_verification"]')).toBeVisible();

            // another person, the zone's finance officer, verifies it against the revenue office's records
            await finance.locator('[data-app-sidebar] [data-menu-item="fees.externalRefs"]').click();
            const waiting = finance.locator(`[data-external-inbox] [data-reference="${reference}"]`);
            await waiting.locator('[data-action="verify"]').click();
            await finance.locator('[data-decision-dialog="verified"]').getByRole('button', { name: W.verify }).click();
            await expect(waiting).toHaveCount(0);

            // the zone's team leader approves: renewed, permanent, valid again
            await inState(zoneLead, renewal, 'approval');
            await act(zoneLead, renewal, 'approve', W.approve);
            await inState(zoneLead, renewal, 'issued');
            const renewed = await api(reviewer).get<LicenceRow>(`v1/competency/licences/${licence.id}`);
            expect(renewed.kind).toBe('permanent');
            expect((renewed.validUntil ?? '') > addisDay()).toBe(true);

            // the same receipt on another renewal at its payment: refused, one receipt pays one order
            const second = await renewalToPayment(zone, lang, another);
            await paidElsewhere(desk, lang, second);
            await enterReceipt(desk, lang, reference);
            // said on the form and in a notice
            await expect(desk.getByText(W.referenceUsed).first()).toBeVisible();
            await expect(desk.locator('[data-external-refs] [data-state="pending_verification"]')).toHaveCount(0);

            // its own receipt then pays it, and it is renewed too: no request is left open for the next demo
            const own = `${reference}-2`;
            await enterReceipt(desk, lang, own);
            await expect(desk.locator('[data-external-refs] [data-state="pending_verification"]')).toBeVisible();
            await finance.reload();
            const next = finance.locator(`[data-external-inbox] [data-reference="${own}"]`);
            await next.locator('[data-action="verify"]').click();
            await finance.locator('[data-decision-dialog="verified"]').getByRole('button', { name: W.verify }).click();
            await expect(next).toHaveCount(0);
            await inState(zoneLead, second, 'approval');
            await act(zoneLead, second, 'approve', W.approve);
            await inState(zoneLead, second, 'issued');
        });

        test('10. sends Boditi’s final approval to the zone, as the bureau sets it, but never its fee rule', async ({
            browser
        }) => {
            test.setTimeout(600_000);
            bureau = await person(browser, BUREAU_ADMIN);
            await speaks(bureau, lang);
            boditiId = (await api(records).get<{ activeUnit: { id: string } }>('v1/me/workspace')).activeUnit.id;

            // the bureau: Boditi's final approvals to the office above it, an override the service allows an office
            await bureau.goto('/services/DVC-03');
            const override = bureau.locator('[data-section="override"]');
            await override.locator('#override-unit').click();
            await bureau
                .getByRole('option', { name: /Boditi|ቦዲቲ/ })
                .first()
                .click();
            const row = override.locator('[data-config-key="approval_unit"]');
            await row.getByRole('button', { name: W.change }).click();
            const dialog = bureau.getByRole('dialog');
            await dialog.locator('#approval-rule').click();
            await bureau.getByRole('option', { name: W.ruleParent }).click();
            await dialog.locator('#override-reason').fill(W.overrideReason);
            await dialog.getByRole('button', { name: W.save }).click();
            await expect(row.locator('[data-value]')).toHaveText(W.ruleParent);
            await expect(row.locator('[data-source]')).toHaveAttribute('data-source', 'unit');

            // the fee rule belongs to the region's version of the service: an office's configuration has no key for it, so the
            // screen offers none and the API refuses one (what an office may change is its policy's families: sla,
            // approval_unit, help, the header, payment)
            const path = `v1/org-units/${boditiId}/services/DVC-03`;
            const { own } = await api(bureau).get<{ own: { version: number } | null }>(`${path}/configuration`);
            expect([400, 422]).toContain(
                await api(bureau).status(
                    'PUT',
                    `${path}/override`,
                    { values: { approval_unit: 'parent', fee: 'none' }, reason: W.overrideReason },
                    own?.version ?? 0
                )
            );

            // Boditi's next applicant, registered and trained as step 2 showed
            const next = { givenAm: generated(), fatherAm: generated() };
            const { id: nextId } = await api(records).post<{ id: string }>('v1/persons', {
                nameAm: { given: next.givenAm, father: next.fatherAm, grandfather: 'ተሰማ' },
                sex: 'male',
                birthYear: 1992,
                sensitive: { birthDate: '1992-03-10' },
                acknowledgedDuplicates: []
            });
            const { items: schools } = await api(officer).get<{ items: { id: string }[] }>(
                `v1/organisations?q=${encodeURIComponent(W.school_a)}`
            );
            const enrolment = await api(officer).post<{ id: string; version: number }>(
                'v1/competency/training-enrolments',
                {
                    personId: nextId,
                    schoolId: schools[0]?.id,
                    grade: 'automobile'
                }
            );
            await api(officer).post(
                `v1/competency/training-enrolments/${enrolment.id}/completion`,
                { completedOn: addisDay() },
                enrolment.version
            );

            const nextCase = await fileNewLicence(
                records,
                lang,
                { search: next.givenAm, shown: new RegExp(next.givenAm) },
                false
            );
            await act(officer, nextCase, 'approve', W.approve);
            await inState(officer, nextCase, 'exam');
            await act(officer, nextCase, 'pass', W.passed, async (d) => {
                await today(officer, d, W.heldOn);
                await d.getByLabel(W.theory).fill('80');
                await d.getByLabel(W.practical).fill('80');
                await d.getByRole('checkbox', { name: W.passed }).click();
            });
            await inState(officer, nextCase, 'payment');

            const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${nextCase}`);
            // paid at Boditi's till; the approval is now the zone's
            await payAtTheTill(cashier, caseNumber, lang);
            await inState(lead, nextCase, 'approval');
            await lead.goto(`/cases/${nextCase}`);
            await expect(lead.locator('[data-screen="case"]')).toHaveAttribute('data-state', 'approval');
            await expect(lead.locator('[data-actions] [data-action="approve"]')).toHaveCount(0);
            const zoneLead = zone.lead;
            if (!zoneLead) throw new Error('step 9 signed the zone in');
            await act(zoneLead, nextCase, 'approve', W.approve);
            await inState(zoneLead, nextCase, 'issued');
        });
    });
}
