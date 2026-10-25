/**
 * A query's rows as a file people read (task 0.16d; ported from the legacy submission_export.py): labels instead of
 * option values, names instead of ids, yes/no, file names, row counts, in the caller's language. Every cell is
 * neutralised (SEC-IN-8, OWASP CSV injection):
 *   - CSV: every cell is quoted, so no separator (a comma, a semicolon, a tab) ever splits one, and a cell that starts as
 *     a formula (= + - @, a tab or a carriage return) gets a leading apostrophe;
 *   - Excel: every cell is a string (never a formula, so nothing is evaluated when the file opens), and one that starts
 *     as a formula has the text format, so it stays text when someone edits it; it shows exactly as typed (a phone
 *     number +251… is not altered by an apostrophe).
 */
import { PassThrough } from 'node:stream';

import ExcelJS from 'exceljs';
import { InvalidRequestError, RateLimitedError } from '@itrms/kernel/errors';
import { MAX_GENERATED_BYTES } from '@itrms/kernel/files';

import type { ExportFailure } from '../contracts';

import am from '../messages/am.json';
import en from '../messages/en.json';
import type { ViewField } from './view-fields';

const FORMULA_START = /^[=+\-@\t\r]/;
/** The longest text an Excel cell holds (longer opens with a "repair" prompt). */
const MAX_XLSX_CELL = 32_767;

export const neutralise = (cell: string): string => (FORMULA_START.test(cell) ? `'${cell}` : cell);

const CATALOGUES: Record<string, Record<string, string>> = { am, en };
/** A message of the export in the caller's language (English when it lacks the key, as the other optional ones do). */
export const word = (language: string, key: string, vars: Record<string, string | number> = {}): string =>
    (
        CATALOGUES[language]?.[`forms.export.${key}`] ??
        (en as Record<string, string>)[`forms.export.${key}`] ??
        key
    ).replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m));

/** A text of a value as stored: a string or a number as written, anything else as JSON. */
const text = (v: unknown): string =>
    typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v);

/** The name of an uploaded file as the engine records it. */
function fileName(v: unknown): string {
    if (!v || typeof v !== 'object') return text(v);
    const { name, filename } = v as { name?: unknown; filename?: unknown };
    return typeof name === 'string' ? name : typeof filename === 'string' ? filename : '';
}

/** One stored value as the text a person would write down. */
export function formatValue(field: ViewField, value: unknown, language: string): string {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
        return '';
    const labels = new Map(field.options.map((o) => [JSON.stringify(o.value), o.label]));
    const one = (v: unknown) => labels.get(JSON.stringify(v)) ?? text(v);
    switch (field.kind) {
        case 'boolean':
            return value === true ? word(language, 'yes') : value === false ? word(language, 'no') : text(value);
        case 'files':
            return (Array.isArray(value) ? value : [value]).map(fileName).filter(Boolean).join(', ');
        case 'rows':
            return Array.isArray(value)
                ? word(language, value.length === 1 ? 'row' : 'rows', { count: value.length })
                : '';
        default:
            return Array.isArray(value) ? value.map(one).join(', ') : one(value);
    }
}

export interface ExportTable {
    format: 'csv' | 'xlsx';
    filename: string;
    sheetName: string;
    headers: string[];
    rows: string[][];
    /** the keys of the columns, in order (the audit records them) */
    keys: string[];
}

/** An export the person can act on refused (too many rows, too large, a field not there), with its reason's code. */
export class ExportRefused extends InvalidRequestError {
    constructor(
        readonly reason: ExportFailure,
        detail: string
    ) {
        super('invalid_query', { detail });
    }
}

const tooLarge = (maxBytes: number) =>
    new ExportRefused(
        'too_large',
        `The file would be larger than ${Math.round(maxBytes / 1024 / 1024)} MB: narrow the filter or choose fewer fields.`
    );

const csvCell = (cell: string) => `"${neutralise(cell).replace(/"/g, '""')}"`;

/**
 * RFC 4180, every cell quoted, CRLF, with a byte-order mark so a spreadsheet reads the UTF-8 (Ethiopic) correctly. Built
 * line by line, and refused once it passes `maxBytes` (never one string of the whole file).
 */
export function renderCsv(headers: string[], rows: string[][], maxBytes = MAX_GENERATED_BYTES): Buffer {
    const chunks: Buffer[] = [Buffer.from([0xef, 0xbb, 0xbf])];
    let size = 3;
    for (const r of [headers, ...rows]) {
        const line = Buffer.from(`${r.map(csvCell).join(',')}\r\n`, 'utf8');
        size += line.byteLength;
        if (size > maxBytes) throw tooLarge(maxBytes);
        chunks.push(line);
    }
    return Buffer.concat(chunks, size);
}

/** A name Excel accepts for a sheet: at most 31 characters, none of : \ / ? * [ ], no quote at either end, not "History". */
export function sheetNameOf(name: string): string {
    const cleaned = name
        .replace(/[:\\/?*[\]]/g, ' ')
        .slice(0, 31)
        .replace(/^'+|'+$/g, '')
        .trim();
    return cleaned && cleaned.toLowerCase() !== 'history' ? cleaned : 'Export';
}

/** One sheet, written as a stream (rows are committed as they go); every cell a string, the header bold and frozen. */
export async function renderXlsx(sheetName: string, headers: string[], rows: string[][]): Promise<Buffer> {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (chunk: Buffer) => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useSharedStrings: false, useStyles: true });
    workbook.creator = 'ITRMS';
    const sheet = workbook.addWorksheet(sheetNameOf(sheetName), { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = headers.map((h, i) => ({
        width: Math.min(60, Math.max(10, h.length + 2, ...rows.slice(0, 200).map((r) => (r[i]?.length ?? 0) + 2)))
    }));
    const add = (values: string[], bold = false) => {
        const row = sheet.addRow(values.map((v) => v.slice(0, MAX_XLSX_CELL)));
        row.eachCell((cell) => {
            // text, kept as typed: a string cell is never evaluated, and the text format keeps it so when edited
            if (typeof cell.value === 'string' && FORMULA_START.test(cell.value)) cell.numFmt = '@';
            if (bold) cell.font = { bold: true };
        });
        row.commit();
    };
    add(headers, true);
    for (const r of rows) add(r);
    sheet.commit();
    await workbook.commit();
    return Buffer.concat(chunks);
}

/**
 * At most a few exports render at once in a process (memory and the event loop are shared by every office); one more
 * waits a few seconds and asks again (429). Rate limits per person come with the platform's limits (task 0.26).
 */
const MAX_CONCURRENT_EXPORTS = 2;
let running = 0;

export async function rendering<T>(work: () => Promise<T>): Promise<T> {
    if (running >= MAX_CONCURRENT_EXPORTS)
        throw new RateLimitedError(5, { detail: 'Other exports are being prepared: try again in a few seconds.' });
    running += 1;
    try {
        return await work();
    } finally {
        running -= 1;
    }
}

export async function render(
    table: ExportTable,
    maxBytes = MAX_GENERATED_BYTES
): Promise<{ body: Buffer; contentType: string }> {
    if (table.format === 'csv')
        return { body: renderCsv(table.headers, table.rows, maxBytes), contentType: 'text/csv; charset=utf-8' };
    const body = await renderXlsx(table.sheetName, table.headers, table.rows);
    if (body.byteLength > maxBytes) throw tooLarge(maxBytes);
    return { body, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}
