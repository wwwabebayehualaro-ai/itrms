/**
 * Reading a sheet of paper vehicle files (task 1.13b): a CSV file or the first worksheet of an Excel workbook, as records keyed by
 * the template's columns, each with the line a spreadsheet shows it on (the header is line 1). Nothing here knows a vehicle: the
 * rows are checked in import-rows.ts and by the register.
 *
 * A workbook is a ZIP archive: before ExcelJS opens it, every part is unpacked against a budget (the sizes an archive declares are
 * not trusted: JSZip inflates a part whole before it compares) and an archive that would unpack to more than the bound (a "zip
 * bomb") is refused, so a small upload cannot take the worker's memory (SEC-IN-2).
 *
 * Every cell is made storable text: control characters and lone surrogates (which PostgreSQL refuses in text and jsonb) are
 * dropped, so no cell can fail the transaction its row is stored in.
 */
import { inflateRawSync } from 'node:zlib';

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

/** What a workbook may unpack to (a sheet of 2,000 rows is a few MB), and how many parts it may hold. */
export const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;
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
 * Whether a ZIP archive keeps within the bounds: the number of its parts, and what they unpack to, measured by unpacking each one
 * (stored as is, or deflated) against what is left of the budget. An archive that cannot be read this way (a ZIP64 one, which a
 * sheet of this size never needs, or another compression) is not accepted.
 */
export function zipWithinBounds(data: Buffer, maxBytes = MAX_UNPACKED_BYTES): boolean {
    const END = 0x06054b50;
    const ENTRY = 0x02014b50;
    const LOCAL = 0x04034b50;
    if (data.length < 22) return false;
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
    let left = maxBytes;
    for (let n = 0; n < entries; n++) {
        if (at + 46 > data.length || data.readUInt32LE(at) !== ENTRY) return false;
        const method = data.readUInt16LE(at + 10);
        const packed = data.readUInt32LE(at + 20);
        const unpacked = data.readUInt32LE(at + 24);
        const local = data.readUInt32LE(at + 42);
        if (unpacked === 0xffffffff || packed === 0xffffffff || unpacked > left) return false;
        if (local + 30 > data.length || data.readUInt32LE(local) !== LOCAL) return false;
        const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        if (start + packed > data.length) return false;
        let size: number;
        if (method === 0) size = packed;
        else if (method === 8) {
            try {
                // one byte over what is left: a part that unpacks to more stops there, never unpacked whole
                size = inflateRawSync(data.subarray(start, start + packed), { maxOutputLength: left + 1 }).length;
            } catch {
                return false;
            }
        } else return false;
        if (size > left) return false;
        left -= size;
        at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
    }
    return true;
}

/**
 * A cell as text PostgreSQL stores: control characters (but tab and line breaks) and lone surrogates dropped. The date mark is
 * kept as it is: it never reaches a stored value (the row reports the cell instead).
 */
export function storable(text: string): string {
    if (text === DATE_CELL) return text;
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                out += text.slice(i, i + 2);
                i++;
            }
            continue;
        }
        if (c >= 0xdc00 && c <= 0xdfff) continue;
        if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) continue;
        out += text.charAt(i);
    }
    return out;
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
            const value = storable(row.cells[i] ?? '').trim();
            if (known.has(key) && value !== '' && cells[key] === undefined) cells[key] = value;
        });
        if (Object.keys(cells).length > 0) records.push({ line: row.line, cells });
    }
    if (records.length === 0) return { ok: false, code: 'no_rows' };
    if (records.length > MAX_IMPORT_ROWS) return { ok: false, code: 'too_many_rows' };
    return { ok: true, records };
}
