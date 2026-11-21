/**
 * What a document says, read back from the PDF (task 0.23a): golden text extraction per template, Ethiopic text and Ethiopian
 * dates, applicant text as text, and nothing fetched. Chrome is on CI's runners; on a machine without it these are skipped, but
 * never on CI.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import puppeteer from 'puppeteer-core';
import { afterAll, describe, expect, it } from 'vitest';

import { DOCUMENT_DATA_SCHEMAS, documentTemplateVersionSchema, type DocumentDataSchema } from '../contracts';
import { findChrome, PdfRenderer } from '../api/render/chrome';
import { birrText, ethiopianDay, isTemplateProblem, renderHtml, templateProblems } from '../api/render/html';
import { qrImage } from '../api/pdf-worker';
import { TEMPLATE_SEEDS } from '../seed/templates';

const chrome = findChrome();
if (process.env.CI && !chrome) throw new Error('CI must have Chrome: the PDF tests would not run');

const blocked: string[] = [];
const renderer = chrome
    ? new PdfRenderer({
          executablePath: chrome,
          noSandbox: process.env.CHROME_NO_SANDBOX === '1',
          onBlocked: (url) => blocked.push(url)
      })
    : undefined;
afterAll(() => renderer?.close());

const template = (key: string) => {
    const seed = TEMPLATE_SEEDS.find((s) => s.key === key);
    if (!seed) throw new Error(key);
    return seed.version;
};

const OFFICE = { name: { am: 'የናሙና ከተማ አስተዳደር', en: 'Sample Town Administration' } };
const ISSUED_AT = new Date('2026-11-04T09:00:00Z');

/** The words of a PDF, joined by page, with its page count. */
async function textOf(pdf: Uint8Array): Promise<{ text: string; pages: number }> {
    const doc = await getDocument({ data: pdf.slice(), useSystemFonts: false, disableFontFace: true }).promise;
    const parts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return { text: parts.join('\n').replace(/\s+/g, ' '), pages: doc.numPages };
}

const SAMPLES: Record<DocumentDataSchema, Record<string, unknown>> = {
    'receipt.v1': {
        number: 'WOL-BODITI/000123/2019',
        issuedOn: '2026-11-04',
        caseNumber: 17,
        serviceName: { am: 'አዲስ መንጃ ፈቃድ', en: 'New driver licence' },
        receivedFrom: 'አበበ በቀለ',
        method: 'cash',
        amountSantim: '125050',
        lines: [
            { label: { am: 'የፈቃድ ክፍያ', en: 'Licence fee' }, quantity: null, amountSantim: '115050' },
            { label: { am: 'የካርድ ክፍያ', en: 'Card fee' }, quantity: 1, amountSantim: '10000' }
        ],
        demo: true
    },
    'remittance.v1': {
        number: 'WOL-BODITI/RM/00007/2019',
        preparedOn: '2026-11-18',
        periodFrom: '2026-11-16',
        periodTo: '2026-11-18',
        revenueTotalSantim: '210000',
        cashSantim: '160000',
        bankSlipSantim: '60000',
        reversalSantim: '-10000',
        depositDueSantim: '155000',
        differenceSantim: '-500',
        groups: [
            {
                accountCode: '0000',
                budgetCategory: 'PLACEHOLDER',
                accountName: { am: 'ጊዜያዊ የሂሳብ ኮድ (ማሳያ)', en: 'Placeholder account code (demo)' },
                mappedByDefault: true,
                receiptSantim: '220000',
                reversalSantim: '-10000',
                totalSantim: '210000'
            }
        ],
        lines: [
            {
                kind: 'receipt',
                receiptNumber: 'WOL-BODITI/000123/2019',
                lineKey: 'base',
                accountCode: '0000',
                mappedByDefault: true,
                amountSantim: '220000'
            },
            {
                kind: 'reversal',
                receiptNumber: 'WOL-BODITI/000120/2019',
                lineKey: 'base',
                accountCode: '0000',
                mappedByDefault: true,
                amountSantim: '-10000'
            }
        ],
        sessions: [
            {
                businessDay: '2026-11-16',
                openingFloatSantim: '5000',
                expectedCashSantim: '165500',
                countedSantim: '160000',
                differenceSantim: '-5500'
            }
        ],
        demo: true
    },
    'application-copy.v1': {
        caseNumber: 18,
        serviceName: 'የመንጃ ፈቃድ እድሳት',
        filedOn: '2026-09-11',
        fields: [{ label: 'ስም', value: 'ሰላም ታደሰ' }]
    },
    'licence-card.v1': {
        number: 'SER-000456',
        holderName: 'ሰላም ታደሰ',
        birthDate: '1990-03-15',
        grades: [{ grade: 'B', name: { am: 'አውቶሞቢል', en: 'Automobile' } }],
        issuedOn: '2026-11-04',
        validUntil: '2030-11-03',
        photo: null
    },
    'licence-medical-referral.v1': {
        number: 'WOL-BODITI/MR/00003/2019',
        issuedOn: '2026-11-04',
        caseNumber: 41,
        institution: 'Sample Health Centre',
        attempt: 1,
        of: 3,
        holderName: 'ሰላም ታደሰ',
        licence: {
            number: '06-00012',
            cardSerial: 'ሀ-004512',
            validUntil: '2026-11-20',
            grades: [{ name: { am: 'አውቶሞቢል', en: 'Automobile' } }]
        }
    },
    'licence-driving-permit.v1': {
        number: 'WOL-BODITI/TP/00007/2019',
        issuedOn: '2026-11-04',
        validUntil: '2027-02-01',
        caseNumber: 52,
        holderName: 'ሰላም ታደሰ',
        licence: {
            id: '0199f0a0-d000-7000-8000-0000000000aa',
            number: '06-00012',
            validUntil: '2030-11-03',
            grades: [{ grade: 'automobile', name: { am: 'አውቶሞቢል', en: 'Automobile' } }]
        }
    },
    'vehicle-libre.v1': {
        number: 'WOL-BODITI/LB/000012',
        issuedOn: '2026-11-04',
        firstRegisteredOn: '2026-11-04',
        plate: 'ETH ABC 1234',
        federalVehicleId: 'FV-000123',
        chassisNumber: 'JTDKB20U093051234',
        engineNumber: '2NZ1234567',
        make: 'Toyota',
        model: 'Vitz',
        modelYear: 2018,
        category: { am: 'አውቶሞቢል', en: 'Automobile' },
        use: { am: 'የግል', en: 'Private' },
        fuel: { am: 'ቤንዚን', en: 'Petrol' },
        colour: 'White',
        seats: 5,
        loadCapacityKg: null,
        owners: [{ name: 'ሰላም ታደሰ' }]
    },
    'vehicle-registration-certificate.v1': {
        number: 'WOL-BODITI/RC/000012',
        issuedOn: '2026-11-04',
        firstRegisteredOn: '2026-11-04',
        plate: 'ETH ABC 1234',
        federalVehicleId: 'FV-000123',
        owners: [{ name: 'ሰላም ታደሰ', address: 'ቦዲቲ ከተማ አስተዳደር, ቀበሌ 02' }],
        category: { am: 'አውቶሞቢል', en: 'Automobile' },
        make: 'Toyota',
        model: 'Vitz',
        modelYear: 2018,
        madeIn: 'Japan',
        chassisNumber: 'JTDKB20U093051234',
        engineNumber: '2NZ1234567',
        engineCc: 1300,
        engineHp: 86,
        cylinders: 4,
        fuel: { am: 'ቤንዚን', en: 'Petrol' },
        colour: 'White',
        lengthMm: 3945,
        widthMm: 1695,
        heightMm: 1500,
        tyreSize: '175/65R14',
        tyres: 4,
        grossWeightKg: 1450,
        netWeightKg: 980,
        seats: 5,
        loadCapacityKg: null,
        use: { am: 'የግል', en: 'Private' },
        boloNumber: null,
        bookletSerial: null,
        nationalReference: null
    },
    'vehicle-bolo.v1': {
        number: 'P0001301',
        plate: 'ETH ABC 1234',
        chassisNumber: 'JTDKB20U093051234',
        make: 'Toyota',
        model: 'Vitz',
        category: { am: 'አውቶሞቢል', en: 'Automobile' },
        use: { am: 'የግል', en: 'Private' },
        checklistSerial: 'LV-004512',
        inspectedOn: '2026-11-04',
        fiscalYear: 2019,
        validUntil: '2027-07-07',
        temporaryUntil: null,
        insurance: { certificate: '1234567', insurer: 'Sample Insurance S.C.', until: '2027-10-31' }
    },
    'vehicle-transfer-letter.v1': {
        number: 'WOL-BODITI/OT/00007/2019',
        issuedOn: '2026-11-04',
        validUntil: '2026-12-04',
        kind: 'revenue',
        addressee: 'የናሙና ገቢዎች ጽ/ቤት',
        caseNumber: 21,
        acquiredBy: { am: 'ሽያጭ', en: 'Sale' },
        vehicle: {
            plate: 'ETH ABC 1234',
            chassisNumber: 'JTDKB20U093051234',
            engineNumber: '2NZ1234567',
            make: 'Toyota',
            model: 'Vitz',
            modelYear: 2018,
            category: { am: 'አውቶሞቢል', en: 'Automobile' },
            use: { am: 'የግል', en: 'Private' }
        },
        sellers: [{ name: 'አበበ በቀለ' }],
        buyers: [{ name: 'ሰላም ታደሰ' }, { name: 'ታደሰ ወልደ' }],
        valuation: {
            valuedOn: '2026-11-04',
            committeeValueSantim: '35000000',
            purchasePriceSantim: '30000000',
            marketValueSantim: '36000000',
            contractValueSantim: '32000000',
            // the committee's working: kept on the document's data, never printed
            depreciationPercent: '12.50',
            valuers: 'የግምት ኮሚቴ',
            inspectionNote: null
        }
    },
    'vehicle-transfer-document.v1': {
        number: 'WOL-BODITI/VT/00001/2019',
        issuedOn: '2026-11-04',
        validUntil: '2026-11-19',
        validDays: 15,
        caseNumber: 22,
        destination: { name: 'Sample Transport Bureau', region: 'Sample Region' },
        owners: [{ name: 'አበበ በቀለ', address: 'ቦዲቲ, ቀበሌ 02' }],
        vehicle: {
            plate: 'ETH ABC 1234',
            chassisNumber: 'JTDKB20U093051234',
            engineNumber: '2NZ1234567',
            make: 'Toyota',
            model: 'Vitz',
            modelYear: 2018,
            category: { am: 'አውቶሞቢል', en: 'Automobile' },
            use: { am: 'የግል', en: 'Private' }
        },
        plates: [
            { plate: 'ETH ABC 1234', since: '2024-03-01', until: null, year: null, place: 'Sample Region' },
            { plate: 'AA 2-12345', since: null, until: null, year: 2010, place: 'Addis Ababa' }
        ],
        customsDeclarationNumber: null,
        taxReceiptNumber: 'TR-77',
        purchaseValueSantim: '35000000',
        excisePaidSantim: null,
        bolo: { serial: 'P0001301', validUntil: '2027-07-07', temporary: false },
        holds: [],
        remarks: null,
        preparedBy: 'ሰላም ታደሰ',
        approvedBy: null
    },
    'vehicle-transfer-covering-letter.v1': {
        number: 'WOL-BODITI/VT/00002/2019',
        issuedOn: '2026-11-04',
        validUntil: '2026-11-19',
        caseNumber: 22,
        addressee: 'Sample Transport Bureau',
        documentNumber: 'WOL-BODITI/VT/00001/2019',
        vehicle: { plate: 'ETH ABC 1234', chassisNumber: 'JTDKB20U093051234', make: 'Toyota', model: 'Vitz' },
        owners: [{ name: 'አበበ በቀለ' }]
    },
    'exam-result.v1': {
        sessionOn: '2026-11-04',
        serviceName: { am: 'አዲስ መንጃ ፈቃድ', en: 'New driver licence' },
        candidates: [{ name: 'ሰላም ታደሰ', grade: 'B', theory: 85, practical: 90, passed: true }]
    }
};

const SCHEMA_OF: Record<string, DocumentDataSchema> = {
    receipt: 'receipt.v1',
    remittance: 'remittance.v1',
    'application-copy': 'application-copy.v1',
    'licence-card': 'licence-card.v1',
    'licence-medical-referral': 'licence-medical-referral.v1',
    'licence-driving-permit': 'licence-driving-permit.v1',
    'vehicle-registration-certificate': 'vehicle-registration-certificate.v1',
    'vehicle-bolo': 'vehicle-bolo.v1',
    'vehicle-temporary-bolo': 'vehicle-bolo.v1',
    'vehicle-transfer-justice-letter': 'vehicle-transfer-letter.v1',
    'vehicle-transfer-revenue-letter': 'vehicle-transfer-letter.v1',
    'vehicle-transfer-tax-letter': 'vehicle-transfer-letter.v1',
    'vehicle-transfer-document': 'vehicle-transfer-document.v1',
    'vehicle-transfer-covering-letter': 'vehicle-transfer-covering-letter.v1',
    'exam-result': 'exam-result.v1'
};

async function pdfOf(key: string, data: Record<string, unknown>, language = 'am') {
    const version = template(key);
    const html = await renderHtml({
        template: version,
        data,
        language,
        office: OFFICE,
        header: {},
        issuedAt: ISSUED_AT
    });
    const pdf = await renderer?.render(html, version.paper);
    if (!pdf) throw new Error('no Chrome');
    return textOf(pdf);
}

describe('a template', () => {
    it.each(TEMPLATE_SEEDS.map((s) => [s.key, s] as const))(
        '%s is well-formed, and takes its sample data',
        (key, seed) => {
            expect(documentTemplateVersionSchema.safeParse(seed.version).success).toBe(true);
            expect(templateProblems(seed.version.body)).toEqual([]);
            const schema = SCHEMA_OF[key];
            expect(schema).toBe(seed.version.dataSchema);
            if (schema) expect(DOCUMENT_DATA_SCHEMAS[schema].safeParse(SAMPLES[schema]).success).toBe(true);
        }
    );

    it('is refused when it names a filter that does not exist, or has broken syntax', () => {
        expect(templateProblems('{{ x | nothing }}').length).toBe(1);
        expect(templateProblems('{% if %}').length).toBe(1);
    });

    it('names data of the right shape only', () => {
        expect(
            DOCUMENT_DATA_SCHEMAS['receipt.v1'].safeParse({ ...SAMPLES['receipt.v1'], amountSantim: 1250.5 }).success
        ).toBe(false);
        expect(
            DOCUMENT_DATA_SCHEMAS['licence-card.v1'].safeParse({ ...SAMPLES['licence-card.v1'], grades: [] }).success
        ).toBe(false);
        expect(
            DOCUMENT_DATA_SCHEMAS['licence-card.v1'].safeParse({
                ...SAMPLES['licence-card.v1'],
                photo: 'https://example.com/a.png'
            }).success
        ).toBe(false);
    });
});

describe('what a document prints', () => {
    it('shows santim as Birr by its digits, and a stored day in the Ethiopian calendar', () => {
        expect(birrText('125050')).toBe('1,250.50');
        expect(birrText('7')).toBe('0.07');
        expect(birrText('9007199254740993')).toBe('90,071,992,547,409.93');
        expect(birrText('12.5')).toBe('');
        // 11 September 2026 is Meskerem 1, 2019 E.C.
        expect(ethiopianDay('2026-09-11', 'am')).toContain('2019');
        expect(ethiopianDay('2026-09-11', 'am')).toContain('መስከረም');
        expect(ethiopianDay('2026-09-11', 'en')).toContain('Meskerem');
    });

    it('never makes markup of a value, even when the template asks it to', async () => {
        const html = await renderHtml({
            template: { body: '<p>{{ a }}</p><p>{{ a | raw }}</p>', strings: {}, paper: 'A4' },
            data: { a: '<script>alert(1)</script><img src=x>' },
            language: 'am',
            office: OFFICE,
            header: {},
            issuedAt: ISSUED_AT
        });
        expect(html).not.toContain('<script>alert');
        expect(html).not.toContain('<img src=x>');
        expect(html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)).toHaveLength(2);
    });

    it('has no way out of the escaping: echo, alone or in a liquid tag, is refused', async () => {
        const render = (body: string) =>
            renderHtml({
                template: { body, strings: {}, paper: 'A4' },
                data: { a: '<img src=x>' },
                language: 'am',
                office: OFFICE,
                header: {},
                issuedAt: ISSUED_AT
            });
        expect(templateProblems('{% echo a %}').length).toBe(1);
        expect(templateProblems('{% liquid\n echo a\n%}').length).toBe(1);
        await expect(render('{% echo a %}')).rejects.toThrow();
        // and what is refused is the template's problem, never tried again
        await render('{% echo a %}').catch((error: unknown) => expect(isTemplateProblem(error)).toBe(true));
        await render('{{ a | nothing }}').catch((error: unknown) => expect(isTemplateProblem(error)).toBe(true));
        expect(isTemplateProblem(new Error('Chrome died'))).toBe(false);
    });

    it('allows nothing to load: its policy, and no partials from disk', async () => {
        const render = (body: string) =>
            renderHtml({
                template: { body, strings: {}, paper: 'A4' },
                data: {},
                language: 'am',
                office: OFFICE,
                header: {},
                issuedAt: ISSUED_AT
            });
        expect(await render('x')).toContain(`default-src 'none'`);
        await expect(render(`{% include 'package.json' %}`)).rejects.toThrow();
        await expect(render(`{% render '/etc/passwd' %}`)).rejects.toThrow();
    });
});

describe.skipIf(!chrome)('a QR on the page', () => {
    /** What a camera would see: the page drawn by Chrome at print size, 2× for a phone's resolution. */
    async function scanned(key: string, data: Record<string, unknown>, width: number, height: number) {
        const url = `https://verify.example.test/${'t'.repeat(22)}#${'p'.repeat(230)}.${'s'.repeat(86)}`;
        const seed = template(key);
        const html = await renderHtml({
            template: seed,
            data,
            language: 'am',
            office: OFFICE,
            header: {},
            issuedAt: ISSUED_AT,
            verification: { url, qr: await qrImage(url) }
        });
        const browser = await puppeteer.launch({
            executablePath: chrome ?? '',
            headless: true,
            // a runner busy with the other packages' tests can take longer than the 30 s default to start Chrome (the worker's own)
            timeout: 90_000,
            args: process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []
        });
        try {
            const page = await browser.newPage();
            await page.setViewport({ width, height, deviceScaleFactor: 3 });
            await page.setContent(html);
            const png = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png', fullPage: true })));
            return { expected: url, read: jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data };
        } finally {
            await browser.close();
        }
    }

    it('reads back from a receipt', async () => {
        const { expected, read } = await scanned('receipt', SAMPLES['receipt.v1'], 560, 794);
        expect(read).toBe(expected);
    }, 120_000);

    it('reads back from a licence card, at its small size', async () => {
        const { expected, read } = await scanned('licence-card', SAMPLES['licence-card.v1'], 324, 204);
        expect(read).toBe(expected);
    }, 120_000);
});

describe.skipIf(!chrome)('a PDF from Chrome', () => {
    it('receipt: Ethiopic text, an Ethiopian date, the amounts', async () => {
        const { text, pages } = await pdfOf('receipt', SAMPLES['receipt.v1']);
        expect(pages).toBe(1);
        expect(text).toContain('የገንዘብ መቀበያ ደረሰኝ');
        expect(text).toContain('የናሙና ከተማ አስተዳደር');
        // a long number may wrap, or come in pieces: its characters, in order
        expect(text.replace(/\s/g, '')).toContain('WOL-BODITI/000123/2019');
        expect(text).toContain('አበበ በቀለ');
        expect(text).toContain('1,250.50');
        expect(text).toContain('ጥቅምት');
        expect(text).toContain('2019');
        expect(text).toContain('የማሳያ ሰነድ');
    }, 180_000);

    it('receipt in English', async () => {
        const { text } = await pdfOf('receipt', SAMPLES['receipt.v1'], 'en');
        expect(text).toContain('Payment receipt');
        expect(text).toContain('Sample Town Administration');
        expect(text).toContain('Tikimt');
        expect(text).toContain('New driver licence');
    }, 180_000);

    it('remittance: grouped by account, the late reversal negative, the default flagged, the demo marker', async () => {
        const { text, pages } = await pdfOf('remittance', SAMPLES['remittance.v1']);
        expect(pages).toBe(1);
        expect(text).toContain('የገቢ ማስገቢያ ሪፖርት');
        expect(text.replace(/\s/g, '')).toContain('WOL-BODITI/RM/00007/2019');
        expect(text).toContain('PLACEHOLDER');
        expect(text).toContain('-100.00');
        expect(text).toContain('1,550.00');
        expect(text).toContain('በነባሪ ሂሳብ የተመዘገበ');
        expect(text).toContain('የማሳያ ሰነድ');
    }, 180_000);

    it('remittance in English', async () => {
        const { text } = await pdfOf('remittance', SAMPLES['remittance.v1'], 'en');
        expect(text).toContain('Remittance of revenue');
        expect(text).toContain('Booked to the default account');
        expect(text).toContain('To deposit at the bank');
        expect(text).toContain('-100.00');
    }, 180_000);

    it('application copy', async () => {
        const { text, pages } = await pdfOf('application-copy', SAMPLES['application-copy.v1']);
        expect(pages).toBe(1);
        expect(text).toContain('የማመልከቻ ቅጂ');
        expect(text).toContain('ሰላም ታደሰ');
        expect(text).toContain('መስከረም');
    }, 180_000);

    it('licence card, on one card', async () => {
        const { text, pages } = await pdfOf('licence-card', SAMPLES['licence-card.v1']);
        expect(pages).toBe(1);
        expect(text).toContain('የአሽከርካሪ ብቃት ማረጋገጫ ፈቃድ');
        expect(text).toContain('SER-000456');
        expect(text).toContain('አውቶሞቢል');
    }, 180_000);

    it('medical referral: the facility, the holder and the licence, and no health fact', async () => {
        const data = SAMPLES['licence-medical-referral.v1'];
        const am = await pdfOf('licence-medical-referral', data);
        expect(am.pages).toBe(1);
        expect(am.text).toContain('የአካል ብቃት ምርመራ');
        expect(am.text.replace(/\s/g, '')).toContain('WOL-BODITI/MR/00003/2019');
        expect(am.text).toContain('Sample Health Centre');
        expect(am.text).toContain('ሰላም ታደሰ');
        // the PDF's text may part an Ethiopic letter from what follows it
        expect(am.text.replace(/\s/g, '')).toContain('06-00012');
        expect(am.text.replace(/\s/g, '')).toContain('ሀ-004512');
        // 4 November 2026 is Tikimt 25, 2019 E.C.
        expect(am.text).toContain('ጥቅምት');
        // a second referral says which it is, never why: no earlier outcome is printed
        const en = await pdfOf('licence-medical-referral', { ...data, attempt: 2 }, 'en');
        expect(en.pages).toBe(1);
        expect(en.text).toContain('Drivers physical examination report');
        expect(en.text.replace(/\s+/g, ' ')).toContain('Referral: 2 of 3');
        expect(en.text).not.toMatch(/refus|did not recommend/i);
        expect(en.text).toContain('Automobile');
    }, 180_000);

    it('temporary driving permit: the holder, the licence, its grades and its last day, in either language', async () => {
        const data = SAMPLES['licence-driving-permit.v1'];
        const am = await pdfOf('licence-driving-permit', data);
        expect(am.pages).toBe(1);
        expect(am.text).toContain('ጊዜያዊ የማሽከርከሪያ ፈቃድ');
        expect(am.text.replace(/\s/g, '')).toContain('WOL-BODITI/TP/00007/2019');
        expect(am.text).toContain('ሰላም ታደሰ');
        expect(am.text.replace(/\s/g, '')).toContain('06-00012');
        // 1 February 2027 is Tir 24, 2019 E.C.: its last day is printed in the Ethiopian calendar
        expect(am.text).toContain('ጥር');
        const en = await pdfOf('licence-driving-permit', data, 'en');
        expect(en.pages).toBe(1);
        expect(en.text).toContain('Temporary driving permit');
        expect(en.text).toContain('Automobile');
        expect(en.text.replace(/\s+/g, ' ')).toContain('It is cancelled when the card is handed over');
    }, 180_000);

    it('registration certificate: the temporary libre until the booklet, then the booklet\x27s serial', async () => {
        const temporary = await pdfOf(
            'vehicle-registration-certificate',
            SAMPLES['vehicle-registration-certificate.v1']
        );
        expect(temporary.pages).toBe(1);
        expect(temporary.text).toContain('ጊዜያዊ የባለቤትነት ሊብሬ');
        expect(temporary.text).toContain('WOL-BODITI/RC/000012');
        expect(temporary.text).toContain('JTDKB20U093051234');
        expect(temporary.text).toContain('የሊብሬ ደብተር አይደለም');
        const issued = await pdfOf(
            'vehicle-registration-certificate',
            { ...SAMPLES['vehicle-registration-certificate.v1'], bookletSerial: 'LB0000123' },
            'en'
        );
        expect(issued.text).toContain('Vehicle registration certificate');
        expect(issued.text).toContain('LB0000123');
        expect(issued.text).not.toContain('not the libre booklet');
    });

    it('bolo: the sticker number, the fiscal year and its last day; a temporary bolo says so, with its own last day', async () => {
        const bolo = await pdfOf('vehicle-bolo', SAMPLES['vehicle-bolo.v1']);
        expect(bolo.pages).toBe(1);
        expect(bolo.text).toContain('ቦሎ');
        expect(bolo.text).toContain('P0001301');
        expect(bolo.text).toContain('LV-004512');
        // 7 July 2027 is Sene 30, 2019 E.C.: the fiscal year's last day
        expect(bolo.text).toContain('ሰኔ');
        expect(bolo.text).not.toContain('ጊዜያዊ ቦሎ');
        const temporary = await pdfOf(
            'vehicle-temporary-bolo',
            { ...SAMPLES['vehicle-bolo.v1'], number: 'WOL-BODITI/TB/00001', temporaryUntil: '2026-12-04' },
            'en'
        );
        expect(temporary.text).toContain('Temporary bolo');
        expect(temporary.text.replace(/\s/g, '')).toContain('WOL-BODITI/TB/00001');
        expect(temporary.text).toContain('stands only to the day shown');
    }, 180_000);

    it('transfer letters: the justice office is asked to authenticate and told the vehicle has no hold', async () => {
        const data = { ...SAMPLES['vehicle-transfer-letter.v1'], kind: 'justice', valuation: null };
        const am = await pdfOf('vehicle-transfer-justice-letter', data);
        expect(am.pages).toBe(1);
        expect(am.text).toContain('ዕዳ ዕገዳ');
        expect(am.text.replace(/\s/g, '')).toContain('ETHABC1234');
        expect(am.text).toContain('JTDKB20U093051234');
        expect(am.text).toContain('ሰላም ታደሰ');
        // 4 November 2026 is Tikimt 25, 2019 E.C.
        expect(am.text).toContain('ጥቅምት');
        const en = await pdfOf('vehicle-transfer-justice-letter', data, 'en');
        expect(en.pages).toBe(1);
        expect(en.text).toContain('no debt or encumbrance');
        expect(en.text).toContain('authenticate the contract');
    }, 180_000);

    it('transfer letters: the revenue office gets the value the committee set, and no duty or percentage', async () => {
        const data = SAMPLES['vehicle-transfer-letter.v1'];
        for (const language of ['am', 'en']) {
            const revenue = await pdfOf('vehicle-transfer-revenue-letter', data, language);
            expect(revenue.pages).toBe(1);
            expect(revenue.text).toContain('350,000.00');
            expect(revenue.text).toContain('300,000.00');
            expect(revenue.text).toContain('320,000.00');
            expect(revenue.text).toContain('360,000.00');
            // the duty is the revenue office's to determine: neither a rate nor an amount of it is printed
            expect(revenue.text).not.toContain('%');
            expect(revenue.text).not.toContain('12.5');
        }
        const en = await pdfOf('vehicle-transfer-revenue-letter', data, 'en');
        expect(en.text).toContain("the duty is the revenue office's to determine");
        const am = await pdfOf('vehicle-transfer-revenue-letter', data);
        expect(am.text).toContain('የቴምብር ቀረጥ');
    }, 180_000);

    it('transfer letters: the tax office is asked to register the new owners as business taxpayers', async () => {
        const data = { ...SAMPLES['vehicle-transfer-letter.v1'], kind: 'tax', valuation: null };
        const am = await pdfOf('vehicle-transfer-tax-letter', data);
        expect(am.pages).toBe(1);
        expect(am.text).toContain('ግብር ከፋይ');
        const en = await pdfOf('vehicle-transfer-tax-letter', data, 'en');
        expect(en.pages).toBe(1);
        expect(en.text).toContain('business taxpayers');
    }, 180_000);

    it('transfer document: the number, the last day, the destination, the plates, the value and the rules', async () => {
        const data = SAMPLES['vehicle-transfer-document.v1'];
        for (const language of ['am', 'en'] as const) {
            const { text, pages } = await pdfOf('vehicle-transfer-document', data, language);
            expect(pages).toBe(1);
            expect(text.replace(/\s/g, '')).toContain('WOL-BODITI/VT/00001/2019');
            // 19 November 2026 is Hidar 10, 2019 E.C.: the last day
            expect(text).toContain(language === 'am' ? 'ኅዳር' : 'Hidar');
            expect(text).toContain('Sample Transport Bureau');
            expect(text.replace(/\s/g, '')).toContain('ETHABC1234');
            expect(text.replace(/\s/g, '')).toContain('AA2-12345');
            expect(text).toContain('350,000.00');
            expect(text).toContain('TR-77');
            expect(text).toContain('P0001301');
            // no customs number was given: a dash, never a blank
            expect(text).toContain('—');
            expect(text).toContain(language === 'am' ? 'የለም' : 'none');
        }
        const en = await pdfOf('vehicle-transfer-document', data, 'en');
        expect(en.text).toContain('Any erasure or overwriting');
        expect(en.text).toContain('If the service is not given within that time');
    }, 180_000);

    it('transfer document: a hold still on the vehicle is a row with its amount, and the none marker is gone', async () => {
        const data = {
            ...SAMPLES['vehicle-transfer-document.v1'],
            holds: [
                {
                    kind: { am: 'የባንክ ብድር', en: 'Bank loan' },
                    holder: 'Sample Bank S.C.',
                    letterReference: 'BK-2026-9',
                    letterDate: '2026-10-01',
                    amountSantim: '12000000'
                }
            ]
        };
        const en = await pdfOf('vehicle-transfer-document', data, 'en');
        expect(en.text).toContain('Bank loan');
        expect(en.text).toContain('Sample Bank S.C.');
        expect(en.text).toContain('BK-2026-9');
        expect(en.text).toContain('120,000.00');
        const html = await renderHtml({
            template: template('vehicle-transfer-document'),
            data,
            language: 'en',
            office: OFFICE,
            header: {},
            issuedAt: ISSUED_AT
        });
        expect(html).not.toContain('data-holds-none');
    }, 180_000);

    it('transfer covering letter: it names the document it goes with', async () => {
        const data = SAMPLES['vehicle-transfer-covering-letter.v1'];
        for (const language of ['am', 'en'] as const) {
            const { text, pages } = await pdfOf('vehicle-transfer-covering-letter', data, language);
            expect(pages).toBe(1);
            expect(text.replace(/\s/g, '')).toContain('WOL-BODITI/VT/00001/2019');
            expect(text.replace(/\s/g, '')).toContain('WOL-BODITI/VT/00002/2019');
            expect(text).toContain('Sample Transport Bureau');
        }
    }, 180_000);

    it('registration certificate: the new owners of a transferred vehicle', async () => {
        const { text, pages } = await pdfOf('vehicle-registration-certificate', {
            ...SAMPLES['vehicle-registration-certificate.v1'],
            owners: [
                { name: 'ሰላም ታደሰ', address: null },
                { name: 'ታደሰ ወልደ', address: null }
            ]
        });
        expect(pages).toBe(1);
        expect(text).toContain('ሰላም ታደሰ');
        expect(text).toContain('ታደሰ ወልደ');
    }, 180_000);

    it('exam result sheet', async () => {
        const { text } = await pdfOf('exam-result', SAMPLES['exam-result.v1']);
        expect(text).toContain('የፈተና ውጤት ማሳወቂያ');
        expect(text).toContain('አልፏል');
        expect(text).toContain('85');
    }, 180_000);

    it("shows an applicant's script as text, and runs nothing", async () => {
        const { text } = await pdfOf('application-copy', {
            ...SAMPLES['application-copy.v1'],
            fields: [{ label: 'ስም', value: '<script>document.title="x"</script>' }]
        });
        expect(text).toContain('<script>');
    }, 180_000);

    it('fetches nothing, even a page that asks', async () => {
        blocked.length = 0;
        const html = await renderHtml({
            template: { body: '<p>ok</p>', strings: {}, paper: 'A4' },
            data: {},
            language: 'am',
            office: OFFICE,
            header: {},
            issuedAt: ISSUED_AT
        });
        // past the template's escaping, as if a bug let it through: its policy and the interception still hold
        const hostile = html.replace(
            '<p>ok</p>',
            '<p>ok</p><img src="http://127.0.0.1:9/track.png"><link rel="stylesheet" href="http://127.0.0.1:9/a.css"><script>document.body.append("ran-script")</script>'
        );
        const pdf = await renderer?.render(hostile, 'A4');
        if (!pdf) throw new Error('no Chrome');
        const { text } = await textOf(pdf);
        expect(text).toContain('ok');
        expect(text).not.toContain('ran-script');
    }, 180_000);

    it('starts another browser after one dies, and retires one that has rendered enough', async () => {
        const local = new PdfRenderer({
            executablePath: chrome ?? '',
            noSandbox: process.env.CHROME_NO_SANDBOX === '1',
            recycleAfter: 2
        });
        const html = await renderHtml({
            template: { body: '<p>ok</p>', strings: {}, paper: 'A4' },
            data: {},
            language: 'am',
            office: OFFICE,
            header: {},
            issuedAt: ISSUED_AT
        });
        try {
            // past its limit: a new browser, and the old one closed once its pages are done
            for (let i = 0; i < 5; i += 1) expect((await local.render(html, 'A4')).byteLength).toBeGreaterThan(500);
            // killed under it: the next render fails or not, but the one after it works
            const inner = local as unknown as {
                current?: { browser: Promise<{ process(): { kill(s: string): void } | null }> };
            };
            const running = await inner.current?.browser;
            running?.process()?.kill('SIGKILL');
            await new Promise((resolve) => setTimeout(resolve, 500));
            expect((await local.render(html, 'A4')).byteLength).toBeGreaterThan(500);
        } finally {
            await local.close();
        }
        // one that can't start fails that render, and is not kept
        const broken = new PdfRenderer({ executablePath: 'no-such-chrome' });
        await expect(broken.render(html, 'A4')).rejects.toThrow();
        await expect(broken.render(html, 'A4')).rejects.toThrow();
        await broken.close();
    }, 120_000);

    it('renders at most two at a time, and all of them', async () => {
        const version = template('receipt');
        const html = await renderHtml({
            template: version,
            data: SAMPLES['receipt.v1'],
            language: 'am',
            office: OFFICE,
            header: {},
            issuedAt: ISSUED_AT
        });
        const pdfs = await Promise.all(Array.from({ length: 5 }, async () => renderer?.render(html, version.paper)));
        expect(pdfs.every((p) => p && p.byteLength > 1000)).toBe(true);
    }, 120_000);
});
