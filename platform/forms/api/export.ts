/**
 * A query's rows as a file people read (task 0.16d; ported from the legacy submission_export.py): labels instead of
 * option values, names instead of ids, "Yes"/"No", file names, row counts. Every cell is neutralised (SEC-IN-8): one
 * that starts as a formula (= + - @, a tab or a carriage return) gets a leading apostrophe, in the CSV and in the
 * workbook, so no spreadsheet ever runs what someone typed into a form.
 */
import ExcelJS from 'exceljs';

import type { ViewField } from './view-fields';

const FORMULA_START = /^[=+\-@\t\r]/;

export const neutralise = (cell: string): string => (FORMULA_START.test(cell) ? `'${cell}` : cell);

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
export function formatValue(field: ViewField, value: unknown): string {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
        return '';
    const labels = new Map(field.options.map((o) => [JSON.stringify(o.value), o.label]));
    const one = (v: unknown) => labels.get(JSON.stringify(v)) ?? text(v);
    switch (field.kind) {
        case 'boolean':
            return value === true ? 'Yes' : value === false ? 'No' : text(value);
        case 'files':
            return (Array.isArray(value) ? value : [value]).map(fileName).filter(Boolean).join(', ');
        case 'rows':
            return Array.isArray(value) ? `${value.length} row${value.length === 1 ? '' : 's'}` : '';
        default:
            return Array.isArray(value) ? value.map(one).join(', ') : one(value);
    }
}

const csvCell = (cell: string) => {
    const safe = neutralise(cell);
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** RFC 4180, CRLF, with a byte-order mark so a spreadsheet reads the UTF-8 (Ethiopic) correctly. */
export function renderCsv(headers: string[], rows: string[][]): Buffer {
    const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8')]);
}

/** One sheet; every cell a string (never a formula), the header row bold and frozen. */
export async function renderXlsx(sheetName: string, headers: string[], rows: string[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ITRMS';
    // a sheet name is at most 31 characters, without : \ / ? * [ ]
    const sheet = workbook.addWorksheet(sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Export', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });
    sheet.addRow(headers.map(neutralise)).font = { bold: true };
    for (const row of rows) sheet.addRow(row.map(neutralise));
    sheet.columns.forEach((column, i) => {
        const widest = Math.max(headers[i]?.length ?? 0, ...rows.slice(0, 200).map((r) => r[i]?.length ?? 0));
        column.width = Math.min(60, Math.max(10, widest + 2));
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
