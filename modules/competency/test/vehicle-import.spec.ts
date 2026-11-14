/**
 * The bulk import's reading of a sheet (task 1.13b): a CSV file or a workbook read into records with their spreadsheet lines, a
 * workbook that would unpack to too much refused before it is opened, and each row read into the answers of a back-capture with
 * every error of its cells at once. The register's own rules are the integration test's (vehicle-imports.int.spec.ts).
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { IMPORT_COLUMN_KEYS, importTemplateCsv, MAX_IMPORT_ROWS } from '../contracts';
import { columnOfPath, ownerKeyOf, readDate, readRow } from '../api/import-rows';
import { csvRecords, DATE_CELL, readSheet, zipWithinBounds } from '../api/import-sheet';

/** A row of a paper file as a clerk types it: a car of 2001 E.C., its owner a person. */
const cells = (over: Record<string, string | undefined> = {}): Record<string, string> => {
    const row: Record<string, string | undefined> = {
        paper_reference: 'BOD/VEH/000123',
        first_registered_on: '04/09/2001',
        plate: 'AA 2-12345',
        chassis_number: '1HGCM82633A004352',
        make: 'Toyota',
        model: 'Corolla',
        model_year: '2008',
        category: 'automobile',
        use: 'private',
        owner_name_am: 'ባለቤት ወረቀት ታደሰ',
        owner_sex: 'female',
        ...over
    };
    return Object.fromEntries(Object.entries(row).filter((e): e is [string, string] => e[1] !== undefined));
};

const csv = (lines: string[][]) =>
    lines.map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
const HEADER = Object.keys(cells());

async function workbook(rows: (string | number | Date)[][]): Promise<string> {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('files');
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
}

describe('reading a sheet', () => {
    it('keys a CSV file by the template columns, in any order and case, with the lines a spreadsheet shows', async () => {
        const text = `${String.fromCharCode(0xfeff)}${csv([
            [
                'MAKE',
                'Paper_Reference',
                'unknown_column',
                ...HEADER.filter((h) => h !== 'make' && h !== 'paper_reference')
            ],
            [
                'Isuzu',
                'A/1',
                'x',
                ...HEADER.filter((h) => h !== 'make' && h !== 'paper_reference').map((h) => cells()[h] ?? '')
            ],
            [],
            [
                'Nissan, Ltd',
                'A/2',
                '',
                ...HEADER.filter((h) => h !== 'make' && h !== 'paper_reference').map((h) => cells()[h] ?? '')
            ]
        ])}`;
        const sheet = await readSheet('csv', text);
        expect(sheet.ok).toBe(true);
        if (!sheet.ok) return;
        expect(sheet.records.map((r) => r.line)).toEqual([2, 4]);
        expect(sheet.records[0]?.cells).toMatchObject({ make: 'Isuzu', paper_reference: 'A/1' });
        expect(sheet.records[0]?.cells).not.toHaveProperty('unknown_column');
        expect(sheet.records[1]?.cells.make).toBe('Nissan, Ltd');
    });

    it('fails a sheet without the required columns, naming them, and one with no rows or too many', async () => {
        expect(await readSheet('csv', 'paper_reference,make\r\nA/1,Toyota')).toEqual({
            ok: false,
            code: 'missing_columns',
            columns: ['first_registered_on', 'plate', 'chassis_number', 'model', 'model_year', 'category', 'use']
        });
        expect(await readSheet('csv', HEADER.join(','))).toEqual({ ok: false, code: 'no_rows' });
        const many = [HEADER.join(','), ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `R/${i},x`)].join(
            '\n'
        );
        expect(await readSheet('csv', many)).toEqual({ ok: false, code: 'too_many_rows' });
    });

    it('reads the first worksheet of a workbook, a number as its digits and a date cell as a date to refuse', async () => {
        const values = cells();
        const sheet = await readSheet(
            'xlsx',
            await workbook([
                HEADER,
                HEADER.map((h) =>
                    h === 'model_year' ? 2008 : h === 'first_registered_on' ? new Date('2009-05-12') : (values[h] ?? '')
                )
            ])
        );
        expect(sheet.ok).toBe(true);
        if (!sheet.ok) return;
        expect(sheet.records[0]?.line).toBe(2);
        expect(sheet.records[0]?.cells.model_year).toBe('2008');
        expect(sheet.records[0]?.cells.first_registered_on).toBe(DATE_CELL);
        const read = readRow(sheet.records[0]?.cells ?? {});
        expect(read.ok).toBe(false);
        if (!read.ok) expect(read.errors).toEqual([{ column: 'first_registered_on', code: 'date_cell' }]);
    });

    it('refuses a file that is not a workbook, and a workbook whose parts would unpack to more than the bound', async () => {
        expect(await readSheet('xlsx', Buffer.from('not a zip at all, just text').toString('base64'))).toEqual({
            ok: false,
            code: 'unreadable'
        });
        const data = Buffer.from(await workbook([HEADER]), 'base64');
        expect(zipWithinBounds(data)).toBe(true);
        expect(zipWithinBounds(data, 100)).toBe(false);
        // the central directory's first entry claims 3 GB unpacked: a bomb is refused before ExcelJS opens it
        const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        const bomb = Buffer.from(data);
        bomb.writeUInt32LE(3_000_000_000, data.readUInt32LE(end + 16) + 24);
        expect(zipWithinBounds(bomb)).toBe(false);
        expect(await readSheet('xlsx', bomb.toString('base64'))).toEqual({ ok: false, code: 'too_large' });
    });

    it('keeps quoted commas, quotes and line breaks in a CSV field', () => {
        expect(csvRecords('a,"b, ""c""\nd",e\r\n\r\nf')).toEqual([['a', 'b, "c"\nd', 'e'], [''], ['f']]);
    });

    it('offers a template whose header is every column', () => {
        expect(importTemplateCsv().trim().split(',')).toEqual(IMPORT_COLUMN_KEYS);
    });
});

describe('reading a row', () => {
    it('gives a back-capture: Ethiopian dates in Gregorian, numbers, a use by its Amharic label, the owner apart', () => {
        const read = readRow(
            cells({
                use: 'የግል',
                owners_since: '2015-03-01',
                seats: '5',
                fuel: 'Diesel',
                owner_name_en: 'Sample Paper Person',
                owner_phone: '0911223344'
            })
        );
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.values).toMatchObject({
            paperReference: 'BOD/VEH/000123',
            firstRegisteredOn: '2009-05-12',
            ownersSince: '2015-03-01',
            modelYear: 2008,
            seats: 5,
            use: 'private',
            fuel: 'diesel',
            category: 'automobile'
        });
        expect(read.owner).toEqual({
            kind: 'person',
            nameAm: { given: 'ባለቤት', father: 'ወረቀት', grandfather: 'ታደሰ' },
            nameEn: { given: 'Sample', father: 'Paper', grandfather: 'Person' },
            sex: 'female'
        });
        // the phone is kept apart from the facts (it is encrypted in the row)
        expect(JSON.stringify(read.values)).not.toContain('0911223344');
        expect(read.sensitive.phone).toBeDefined();
    });

    it('reports every error of its cells at once', () => {
        const read = readRow(
            cells({
                first_registered_on: '31/02/2001',
                model_year: '20O8',
                use: 'flying',
                make: undefined,
                owner_sex: 'unknown',
                owner_phone: '12',
                colour: 'x'.repeat(31)
            })
        );
        expect(read.ok).toBe(false);
        if (read.ok) return;
        expect(read.paperReference).toBe('BOD/VEH/000123');
        expect(read.errors).toEqual(
            expect.arrayContaining([
                { column: 'make', code: 'required' },
                { column: 'first_registered_on', code: 'invalid_date' },
                { column: 'model_year', code: 'invalid_number' },
                { column: 'use', code: 'not_in_list' },
                { column: 'owner_sex', code: 'not_in_list' },
                { column: 'owner_phone', code: 'invalid_phone' },
                { column: 'colour', code: 'too_long', params: { max: '30' } }
            ])
        );
        expect(read.errors).toHaveLength(7);
    });

    it('takes an organisation by its TIN, never a person and an organisation together', () => {
        const organisation = readRow(
            cells({ owner_name_am: undefined, owner_sex: undefined, owner_tin: '0012345678' })
        );
        expect(organisation.ok && organisation.owner).toEqual({ kind: 'organisation', tin: '0012345678' });
        const both = readRow(cells({ owner_tin: '0012345678' }));
        expect(!both.ok && both.errors).toEqual([{ column: 'owner_tin', code: 'owner_one_of' }]);
        const none = readRow(cells({ owner_name_am: undefined, owner_sex: undefined }));
        expect(!none.ok && none.errors).toEqual([{ column: 'owner_name_am', code: 'owner_required' }]);
        const oneName = readRow(cells({ owner_name_am: 'ባለቤት' }));
        expect(!oneName.ok && oneName.errors).toEqual([{ column: 'owner_name_am', code: 'invalid_name' }]);
    });

    it('reads a date as the paper gives it, Ethiopian or Gregorian, and nothing else', () => {
        expect(readDate('04/09/2001')).toBe('2009-05-12');
        expect(readDate('4.9.2001')).toBe('2009-05-12');
        expect(readDate('06/13/2015')).toBe('2023-09-11');
        expect(readDate('07/13/2015')).toBeUndefined();
        expect(readDate('2009-05-12')).toBe('2009-05-12');
        expect(readDate('2009-02-30')).toBeUndefined();
        expect(readDate('May 12, 2009')).toBeUndefined();
    });
});

describe('an owner across rows', () => {
    const person = { kind: 'person', nameAm: { given: 'ባለቤት', father: 'ወረቀት' }, sex: 'male' } as const;

    it('is one person by FIN, else by the Amharic name with the phone; a name alone is not enough', () => {
        expect(ownerKeyOf(person, { fin: '123456789012' })).toBe('fin:123456789012');
        expect(ownerKeyOf(person, { phone: '+251911223344' })).toBe('name:ባለቤት ወረቀት|phone:+251911223344');
        expect(ownerKeyOf(person, {})).toBeUndefined();
        expect(ownerKeyOf({ kind: 'organisation', tin: '0012345678' }, {})).toBeUndefined();
    });

    it('is reported at the sheet’s columns when the register refuses it', () => {
        expect(columnOfPath('owners.0.id')).toBe('owner_name_am');
        expect(columnOfPath('sensitive.fin')).toBe('owner_fin');
        expect(columnOfPath('acknowledgedDuplicates')).toBe('owner_name_am');
        expect(columnOfPath('chassisNumber')).toBe('chassis_number');
        expect(columnOfPath('since')).toBe('owners_since');
        expect(columnOfPath(undefined)).toBeNull();
    });
});
