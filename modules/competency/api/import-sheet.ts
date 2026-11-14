/**
 * Reading a sheet of paper vehicle files (task 1.13b): a CSV file or the first worksheet of an Excel workbook, as records keyed by
 * the template's columns, each with the line a spreadsheet shows it on (the header is line 1). Nothing here knows a vehicle: the
 * rows are checked in import-rows.ts and by the register.
 *
 * A workbook is a ZIP archive: before ExcelJS opens it, its central directory is read and an archive that would unpack to more than
 * the bound (a "zip bomb") is refused, so a small upload cannot take the worker's memory (SEC-IN-2).
 */
import ExcelJS from 'exceljs';

import {
    IMPORT_COLUMN_KEYS,
    IMPORT_COLUMNS,
    MAX_IMPORT_ROWS,
    type ImportFailure,
    type ImportFormat
} from '../contracts';

/** A cell Excel holds as a date: never read as one (its digits are the Ethiopian date the clerk typed, in a Gregorian cell). */
export const DATE_CELL = '\u0000date';

export interface SheetRecord {
    line: number;
    cells: Record<string, string>;
}

export type Sheet = { ok: true; records: SheetRecord[] } | { ok: false; code: ImportFailure; columns?: string[] };

/** What a workbook may unpack to, and how many parts it may hold. */
export const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;

/** RFC 4180 records, blank ones kept (a spreadsheet numbers them too); a byte order mark is not part of the first header. */
export function csvRecords(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
            if (c === '"' && source[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && source[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else field += c;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/**
 * Whether a ZIP archive's central directory keeps within the bounds: its entries' unpacked sizes summed, and their number. An
 * archive that cannot be read this way (or a ZIP64 one, which a sheet of this size never needs) is not accepted.
 */
export function zipWithinBounds(data: Buffer, maxBytes = MAX_UNPACKED_BYTES): boolean {
    const END = 0x06054b50;
    const ENTRY = 0x02014b50;
    // the end record is in the last 22 bytes plus a comment of at most 65535
    let end = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--)
        if (data.readUInt32LE(i) === END) {
            end = i;
            break;
        }
    if (end < 0) return false;
    const entries = data.readUInt16LE(end + 10);
    const offset = data.readUInt32LE(end + 16);
    if (entries > MAX_ZIP_ENTRIES || offset === 0xffffffff || offset >= data.length) return false;
    let at = offset;
    let total = 0;
    for (let n = 0; n < entries; n++) {
        if (at + 46 > data.length || data.readUInt32LE(at) !== ENTRY) return false;
        const unpacked = data.readUInt32LE(at + 24);
        if (unpacked === 0xffffffff) return false;
        total += unpacked;
        if (total > maxBytes) return false;
        at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
    }
    return true;
}

/** A workbook cell as text: rich text joined, a formula's result, a hyperlink's text; a date marked; an error as empty. */
function cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return DATE_CELL;
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result);
    return '';
}

async function workbookRows(base64: string): Promise<{ line: number; cells: string[] }[] | ImportFailure> {
    const data = Buffer.from(base64, 'base64');
    if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50) return 'unreadable';
    if (!zipWithinBounds(data)) return 'too_large';
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(data as unknown as ArrayBuffer);
    } catch {
        return 'unreadable';
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return 'no_rows';
    const rows: { line: number; cells: string[] }[] = [];
    let tooMany = false;
    sheet.eachRow({ includeEmpty: false }, (row, line) => {
        if (rows.length > MAX_IMPORT_ROWS) {
            tooMany = true;
            return;
        }
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push({ line, cells: values.map((v) => cellText(v)) });
    });
    return tooMany ? 'too_many_rows' : rows;
}

/** The sheet's records, keyed by the template's columns (headers matched in any case; columns it does not know left out). */
export async function readSheet(format: ImportFormat, content: string): Promise<Sheet> {
    let rows: { line: number; cells: string[] }[];
    if (format === 'xlsx') {
        const read = await workbookRows(content);
        if (typeof read === 'string') return { ok: false, code: read };
        rows = read;
    } else rows = csvRecords(content).map((cells, i) => ({ line: i + 1, cells }));
    const [header, ...body] = rows;
    if (!header) return { ok: false, code: 'no_rows' };
    const keys = header.cells.map((h) => h.trim().toLowerCase());
    const known = new Set(IMPORT_COLUMN_KEYS);
    const missing = IMPORT_COLUMNS.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.key);
    if (missing.length > 0) return { ok: false, code: 'missing_columns', columns: missing };
    const records: SheetRecord[] = [];
    for (const row of body) {
        const cells: Record<string, string> = {};
        keys.forEach((key, i) => {
            const value = (row.cells[i] ?? '').trim();
            if (known.has(key) && value !== '' && cells[key] === undefined) cells[key] = value;
        });
        if (Object.keys(cells).length > 0) records.push({ line: row.line, cells });
    }
    if (records.length === 0) return { ok: false, code: 'no_rows' };
    if (records.length > MAX_IMPORT_ROWS) return { ok: false, code: 'too_many_rows' };
    return { ok: true, records };
}
