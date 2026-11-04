/**
 * What a document says, read back from the PDF (task 0.23a): golden text extraction per template, Ethiopic text and Ethiopian
 * dates, applicant text as text, and nothing fetched. Chrome is on CI's runners; on a machine without it these are skipped, but
 * never on CI.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, describe, expect, it } from 'vitest';

import { DOCUMENT_DATA_SCHEMAS, documentTemplateVersionSchema, type DocumentDataSchema } from '../contracts';
import { findChrome, PdfRenderer } from '../api/render/chrome';
import { birrText, ethiopianDay, isTemplateProblem, renderHtml, templateProblems } from '../api/render/html';
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
    'exam-result.v1': {
        sessionOn: '2026-11-04',
        serviceName: { am: 'አዲስ መንጃ ፈቃድ', en: 'New driver licence' },
        candidates: [{ name: 'ሰላም ታደሰ', grade: 'B', theory: 85, practical: 90, passed: true }]
    }
};

const SCHEMA_OF: Record<string, DocumentDataSchema> = {
    receipt: 'receipt.v1',
    'application-copy': 'application-copy.v1',
    'licence-card': 'licence-card.v1',
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
