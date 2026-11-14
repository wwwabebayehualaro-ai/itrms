/**
 * The bulk import of paper vehicle files (ADR-0054, task 1.13b): a sheet of files, one per row, read in back-capture mode as MIG-01
 * reads one file. The worker checks every row (the dry run) and reports each row's errors; a second person commits the batch, and
 * its valid rows join the register as migrated by import, with their scans. A file already imported is reported as such, so a sheet
 * run again changes nothing.
 */
import { z } from 'zod';

/** A sheet's column: its header (the key), whether a row must give it, and how its text is read. */
export interface ImportColumn {
    key: string;
    required?: boolean;
    kind?: 'text' | 'date' | 'integer';
}

/**
 * The columns of the template, in its order. Dates are typed as the paper gives them, in the Ethiopian calendar (`dd/mm/yyyy`), or
 * as a Gregorian ISO date (`yyyy-mm-dd`). An owner is a person (`owner_name_am` with `owner_sex`) or an organisation already on
 * the register (`owner_tin`).
 */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
    { key: 'paper_reference', required: true },
    { key: 'scan_file' },
    { key: 'first_registered_on', required: true, kind: 'date' },
    { key: 'owners_since', kind: 'date' },
    { key: 'plate', required: true },
    { key: 'plate_since', kind: 'date' },
    { key: 'libre_number' },
    { key: 'libre_issued_on', kind: 'date' },
    { key: 'federal_vehicle_id' },
    { key: 'chassis_number', required: true },
    { key: 'chassis_kind' },
    { key: 'engine_number' },
    { key: 'make', required: true },
    { key: 'model', required: true },
    { key: 'model_year', required: true, kind: 'integer' },
    { key: 'category', required: true },
    { key: 'use', required: true },
    { key: 'seats', kind: 'integer' },
    { key: 'load_capacity_kg', kind: 'integer' },
    { key: 'gross_weight_kg', kind: 'integer' },
    { key: 'engine_cc', kind: 'integer' },
    { key: 'axles', kind: 'integer' },
    { key: 'colour' },
    { key: 'fuel' },
    { key: 'owner_name_am' },
    { key: 'owner_name_en' },
    { key: 'owner_sex' },
    { key: 'owner_phone' },
    { key: 'owner_fin' },
    { key: 'owner_tin' }
];
export const IMPORT_COLUMN_KEYS = IMPORT_COLUMNS.map((c) => c.key);

export const IMPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/**
 * A batch's life: `checking` until the worker has read and checked every row (the dry run), `checked` with its report, or `failed`
 * when the file cannot be read as a sheet; `committing` once a second person commits it, `committed` when the worker has put its
 * valid rows on the register; `discarded` when it is given up before that.
 */
export const IMPORT_STATES = ['checking', 'checked', 'failed', 'committing', 'committed', 'discarded'] as const;
export type ImportState = (typeof IMPORT_STATES)[number];

/**
 * A row's: `valid` (it would join the register), `invalid` (its errors say why not), `already_imported` (the same paper file is on
 * the register from an import: nothing to do), `imported` (it joined the register at the commit).
 */
export const IMPORT_ROW_STATES = ['valid', 'invalid', 'already_imported', 'imported'] as const;
export type ImportRowState = (typeof IMPORT_ROW_STATES)[number];

/** Why a file could not be read as a sheet at all. */
export const IMPORT_FAILURES = [
    'unreadable',
    'too_large',
    'no_rows',
    'too_many_rows',
    'missing_columns',
    /** its maker no longer holds the right to import in the office when the worker reads it */
    'not_permitted'
] as const;
export type ImportFailure = (typeof IMPORT_FAILURES)[number];

/** A batch's bounds: what one request carries (the API's body limit is 1 MB) and what one dry run reads. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_CONTENT = 900_000;
export const MAX_IMPORT_SCANS = 2000;
/** The rows checked or committed in one transaction: a retried job carries on from the chunk it was in. */
export const IMPORT_CHUNK = 50;

export const VEHICLE_IMPORT_EVENTS = {
    /** the worker reads and checks the sheet (imports never run in a request) */
    'vehicle-import.check-requested.v1': z.object({ importId: z.uuid() }),
    /** the worker puts the batch's valid rows on the register, as the person who committed it */
    'vehicle-import.commit-requested.v1': z.object({ importId: z.uuid() })
} as const;

export const vehicleImportCreateSchema = z.strictObject({
    /** the name the person gave the file: shown, never used as a key */
    filename: z.string().trim().min(1).max(200),
    format: z.enum(IMPORT_FORMATS),
    /** CSV as text; a workbook in base64 */
    content: z.string().min(1).max(MAX_IMPORT_CONTENT),
    /** the scans the person uploaded for the batch (stored, not yet linked): a row names its scan by the file's name */
    scanFileIds: z.array(z.uuid()).max(MAX_IMPORT_SCANS).default([])
});
export type VehicleImportCreate = z.infer<typeof vehicleImportCreateSchema>;

const personRefSchema = z.object({ id: z.uuid(), name: z.string() });
const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const importCountsSchema = z.object({
    total: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
    alreadyImported: z.number().int(),
    imported: z.number().int()
});

export const vehicleImportSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    filename: z.string(),
    format: z.enum(IMPORT_FORMATS),
    state: z.enum(IMPORT_STATES),
    failure: z.object({ code: z.enum(IMPORT_FAILURES), columns: z.array(z.string()) }).nullable(),
    counts: importCountsSchema,
    /** the scans sent with the batch, and how many a row uses */
    scans: z.object({ given: z.number().int(), used: z.number().int() }),
    unit: unitRefSchema,
    createdBy: personRefSchema,
    createdAt: z.string(),
    committedBy: personRefSchema.nullable(),
    committedAt: z.string().nullable(),
    /** whether the caller may commit it now: it is checked, has a valid row, and the caller did not make it (SEC-AC-6) */
    mayCommit: z.boolean()
});
export type VehicleImport = z.infer<typeof vehicleImportSchema>;

export const importRowErrorSchema = z.object({
    /** the sheet's column the error is at, or null for the row as a whole */
    column: z.string().nullable(),
    code: z.string(),
    message: z.string()
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const vehicleImportRowSchema = z.object({
    id: z.uuid(),
    /** the line of the sheet, as a spreadsheet numbers it (the header is line 1) */
    line: z.number().int(),
    state: z.enum(IMPORT_ROW_STATES),
    paperReference: z.string().nullable(),
    plate: z.string().nullable(),
    chassisNumber: z.string().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    owner: z.string().nullable(),
    errors: z.array(importRowErrorSchema),
    scan: z.object({ id: z.uuid(), filename: z.string() }).nullable(),
    vehicleId: z.uuid().nullable()
});
export type VehicleImportRow = z.infer<typeof vehicleImportRowSchema>;

export const vehicleImportListSchema = z.object({ items: z.array(vehicleImportSchema) });
export const vehicleImportRowsSchema = z.object({
    items: z.array(vehicleImportRowSchema),
    total: z.number().int()
});

export const vehicleImportQuerySchema = z.strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(25)
});
export const vehicleImportRowQuerySchema = z.strictObject({
    state: z.enum(IMPORT_ROW_STATES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(MAX_IMPORT_ROWS).default(0)
});

/** The template's first line: the columns' keys, which a sheet's header must use (in any order, any case). */
export const importTemplateCsv = (): string => `${IMPORT_COLUMN_KEYS.join(',')}\r\n`;
