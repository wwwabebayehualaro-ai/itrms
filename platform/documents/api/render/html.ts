/**
 * A document's HTML, from its template and data (ADR-0006, ADR-0031 §10). No Chrome here: this is plain and testable.
 * LiquidJS escapes every output (`outputEscape: 'escape'`), and a template cannot opt out (`raw` is overridden), so what an
 * applicant typed can never become markup. Templates are text, not code: no file access, and bounded parse and render.
 * The wrapper's CSP allows nothing to load: fonts and images are inlined.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { addisEthiopianDate, formatEthiopianLong } from '@itrms/ethiopian-calendar';
import { Liquid, LiquidError } from 'liquidjs';

import type { DocumentHeader, DocumentTemplateVersion, Paper } from '../../contracts';
import { birrText, ethiopianDay, pick, printLanguage } from './format';

export { birrText, ethiopianDay } from './format';

function engine(language: string): Liquid {
    const liquid = new Liquid({
        outputEscape: 'escape',
        // no partials from disk: every template stands alone
        templates: {},
        relativeReference: false,
        strictFilters: true,
        ownPropertyOnly: true,
        parseLimit: 400_000,
        // time, so never so tight that a busy machine fails a template that is fine
        renderLimit: 20_000,
        memoryLimit: 32 * 1024 * 1024
    });
    // `raw` would turn the escaping off for a value: here it does nothing. `echo` skips the escaping altogether, in
    // `{% liquid %}` too: a template can't use it
    liquid.registerFilter('raw', (value: unknown) => value);
    liquid.registerTag('echo', {
        parse() {
            throw new Error('echo is not allowed in a document template: use {{ }}, which escapes');
        },
        render() {
            return '';
        }
    });
    liquid.registerFilter('text', (value: unknown) => pick(value, language));
    liquid.registerFilter('ethdate', (value: unknown) => ethiopianDay(value, language));
    liquid.registerFilter('birr', birrText);
    return liquid;
}

/** The template itself is at fault (it can't be read, or can't print this): trying again would fail the same way. */
export const isTemplateProblem = (error: unknown): boolean =>
    error instanceof LiquidError && !/limit exceeded/i.test(error.message);

/** The problems a template's text has, before it is stored: empty when it parses and names only known filters. */
export function templateProblems(body: string): string[] {
    try {
        engine('am').parse(body);
        return [];
    } catch (error) {
        return [error instanceof Error ? error.message : 'the template cannot be read'];
    }
}

const require = createRequire(join(process.cwd(), 'package.json'));

/** The bundled fonts (OFL), inlined once per process. The PDF worker reads them as it starts, so a bad image stops it there. */
const fontFace = (family: string, file: string, weight: number) => {
    const data = readFileSync(require.resolve(file)).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
};
let fonts: string | undefined;
export function fontFaces(): string {
    fonts ??= [
        fontFace('Noto Sans', '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2', 400),
        fontFace('Noto Sans', '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2', 700),
        fontFace(
            'Noto Sans Ethiopic',
            '@fontsource/noto-sans-ethiopic/files/noto-sans-ethiopic-ethiopic-400-normal.woff2',
            400
        ),
        fontFace(
            'Noto Sans Ethiopic',
            '@fontsource/noto-sans-ethiopic/files/noto-sans-ethiopic-ethiopic-700-normal.woff2',
            700
        )
    ].join('');
    return fonts;
}

export const PAGE: Record<Paper, { css: string; width?: string; height?: string; format?: 'A4' | 'A5' }> = {
    A4: { css: 'size:A4;margin:18mm 16mm', format: 'A4' },
    A5: { css: 'size:A5;margin:12mm', format: 'A5' },
    // ISO ID-1, the driving licence's size
    card: { css: 'size:85.6mm 54mm;margin:3mm', width: '85.6mm', height: '54mm' }
};

export interface RenderInput {
    template: Pick<DocumentTemplateVersion, 'body' | 'strings' | 'paper'>;
    data: Record<string, unknown>;
    language: string;
    /** the issuing office: its header, and its name if the header has no title */
    office: { name: unknown };
    header: DocumentHeader;
    /** today's date is never read here: a document says when it was issued */
    issuedAt: Date;
}

/** A whole HTML page for Chrome. */
export async function renderHtml({ template, data, language, office, header, issuedAt }: RenderInput): Promise<string> {
    const liquid = engine(language);
    const strings = Object.fromEntries(Object.entries(template.strings).map(([k, v]) => [k, pick(v, language)]));
    const issued = addisEthiopianDate(issuedAt);
    const body = String(
        await liquid.parseAndRender(template.body, {
            ...data,
            t: strings,
            language,
            office,
            header: { ...header, title: header.title ?? office.name },
            issuedDate: formatEthiopianLong(issued, {
                language: printLanguage(language)
            })
        })
    );
    const lang = language.replace(/[^a-zA-Z-]/g, '');
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${fontFaces()}@page{${PAGE[template.paper].css}}html,body{margin:0;padding:0;font-family:'Noto Sans','Noto Sans Ethiopic',sans-serif;font-size:11pt;color:#111}</style></head><body>${body}</body></html>`;
}
