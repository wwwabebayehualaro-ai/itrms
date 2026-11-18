/**
 * The replacement of a lost bolo sticker in a browser, end to end, as it is seeded (task 1.5b, DVC-06, ADR-0062). A Boditi vehicle is
 * given its bolo first (the inspection of the bolo journey, on its screens); its sticker is then reported lost with the police
 * letter, the case is checked, paid at the till, approved by the lead, and the officer hands over a new sticker from Boditi's stock.
 * The old bolo document's QR, read on the public verification endpoint as a phone reads it, says superseded from then on
 * (`pnpm demo:reset`: Boditi's vehicles and its stickers of this year).
 */
import { randomInt } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { act, BODITI, inState, payAtTheTill, person } from './support';

const WORD = {
    approve: 'አጽድቅ',
    passed: 'አልፏል',
    issueSticker: 'ምልክቱን ስጥ',
    replaceSticker: 'ተለጣፊውን ተካ',
    serial: 'የምርመራ ቅጽ ቁጥር'
} as const;

// the API itself, as the verifier app calls it (the one playwright.config starts, or E2E_API's)
const API = process.env.E2E_API ?? 'http://127.0.0.1:4000';

interface People {
    records: Page;
    cashier: Page;
    officer: Page;
    lead: Page;
}

interface Found {
    id: string;
    use: string;
    handlingUnit: { code: string };
}

interface IssuedList {
    items: { id: string; templateKey: string; state: string }[];
}

const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(d);
};

const labelled = (text: string) => new RegExp(`^${text}( [*])?$`);

/** The address a document's QR holds: the PDF links it, so a phone that opens it can tap it. */
function verificationUrl(pdf: Buffer): string {
    const find = (text: string) => /\/URI\s*\((https?:\/\/[^)]+)\)/.exec(text)?.[1];
    const raw = pdf.toString('latin1');
    const plain = find(raw);
    if (plain) return plain;
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

/** A private Boditi vehicle of the demo inspected and given its bolo sticker: the case of the inspection, and the vehicle. */
async function givenItsBolo({ records, cashier, officer }: People): Promise<{ vehicle: string; inspection: string }> {
    const found = await api(officer).get<{ items: Found[] }>('v1/vehicles?status=active&limit=100');
    const candidates = found.items.filter((v) => v.use === 'private' && v.handlingUnit.code === 'WOL-BODITI');
    expect(candidates.length, 'private Boditi vehicles in the demo').toBeGreaterThan(0);
    const vehicle = candidates[randomInt(candidates.length)]?.id ?? '';
    const answers = {
        vehicle,
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
    await act(records, caseId, 'submit', 'submit');
    await inState(records, caseId, 'review');
    await act(officer, caseId, 'approve', WORD.approve);
    await inState(officer, caseId, 'payment');
    const { number: caseNumber } = await api(records).get<{ number: number }>(`v1/cases/${caseId}`);
    await payAtTheTill(cashier, caseNumber);
    await inState(officer, caseId, 'inspection');

    // the light-vehicle checklist, every item passed
    await officer.goto(`/cases/${caseId}`);
    await officer.locator('[data-actions] [data-action="pass"]').click();
    const dialog = officer.locator('[data-action-dialog="pass"]');
    await dialog.getByRole('textbox', { name: labelled(WORD.serial) }).fill(`LV-${randomInt(100000, 999999)}`);
    const groups = dialog.locator('[data-checklist] [role="radiogroup"]');
    const count = await groups.count();
    expect(count).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < count; i += 1) await groups.nth(i).getByRole('radio', { name: WORD.passed }).click();
    await dialog.getByRole('button', { name: WORD.passed, exact: true }).click();
    await expect(dialog).toBeHidden();
    await inState(officer, caseId, 'sticker');
    await act(officer, caseId, 'issue_sticker', WORD.issueSticker);
    await inState(officer, caseId, 'issued');
    return { vehicle, inspection: caseId };
}

test.describe.configure({ mode: 'serial' });

test.describe('the replacement of a lost bolo sticker', () => {
    let people: People;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300_000);
        people = {
            records: await person(browser, BODITI.records),
            cashier: await person(browser, BODITI.cashier),
            officer: await person(browser, BODITI.officer),
            lead: await person(browser, BODITI.lead)
        };
    });

    test('is paid, approved and replaced from the stock: the old bolo document reads superseded', async ({
        request
    }) => {
        test.setTimeout(900_000);
        const { records, cashier, officer, lead } = people;
        const { vehicle, inspection } = await givenItsBolo(people);

        // the bolo document of the inspection, rendered; its QR as a phone reads it
        const staff = api(records);
        const bolo = async (caseId: string) => {
            const { items } = await staff.get<IssuedList>(`v1/issued-documents?caseId=${caseId}`);
            return items.filter((d) => d.templateKey === 'vehicle-bolo');
        };
        await expect.poll(async () => (await bolo(inspection))[0]?.state, { timeout: 120_000 }).toBe('rendered');
        const old = (await bolo(inspection))[0];
        const { url } = await staff.get<{ url: string }>(`v1/issued-documents/${old?.id}/download`);
        const pdf = Buffer.from(await (await request.get(url)).body());
        const token = new URL(verificationUrl(pdf)).pathname.split('/').pop() ?? '';
        const status = async () =>
            ((await (await request.get(`${API}/api/v1/public/verifications/${token}`)).json()) as { status: string })
                .status;
        expect(await status()).toBe('valid');

        // the sticker is reported lost, with the police letter: a hold would not stop it
        const answers = {
            vehicle,
            item: 'bolo',
            reason: 'lost',
            use: 'private',
            policeReportReference: `PL-${randomInt(1000, 9999)}`,
            policeReportOn: day(-3)
        };
        const fee = await staff.post<{ feeRuleVersionId: string; totalSantim: string }>('v1/fees/preview', {
            serviceCode: 'DVC-06',
            answers
        });
        const filed = await staff.post<{ id: string }>('v1/service-requests', {
            serviceCode: 'DVC-06',
            answers,
            fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim }
        });
        const caseId = filed.id;
        await act(records, caseId, 'submit', 'submit');
        await inState(records, caseId, 'review');
        await act(officer, caseId, 'approve', WORD.approve);
        await inState(officer, caseId, 'payment');
        const { number: caseNumber } = await staff.get<{ number: number }>(`v1/cases/${caseId}`);
        await payAtTheTill(cashier, caseNumber);
        await inState(lead, caseId, 'approval');
        await act(lead, caseId, 'approve', WORD.approve);
        await inState(officer, caseId, 'bolo');

        // the next sticker of Boditi's stock is handed over
        await act(officer, caseId, 'replace_sticker', WORD.replaceSticker);
        await inState(officer, caseId, 'replaced');

        // the old QR says so; the new bolo document stands
        expect(await status()).toBe('superseded');
        const fresh = await bolo(caseId);
        expect(fresh).toHaveLength(1);
        await expect.poll(async () => (await bolo(caseId))[0]?.state, { timeout: 120_000 }).toBe('rendered');
    });
});
