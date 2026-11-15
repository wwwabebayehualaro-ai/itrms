/**
 * The reconciliation report of the paper-record migration (ADR-0054 §4, task 1.13h): per office and per plate-code group of the
 * old regional plate, the paper files the zone counted on the shelves against the vehicles verified onto the register, and the
 * share migrated. The zone sets the paper counts; an office never sets its own target.
 */
import { z } from 'zod';

/** The old regional plate's use code that paper files are shelved by; `other` is a national or special plate, none, or another code. */
export const PAPER_PLATE_CODES = ['1', '2', '3', '4', '5', '35', 'other'] as const;
export type PaperPlateCode = (typeof PAPER_PLATE_CODES)[number];

export const MAX_PAPER_COUNT = 10_000_000;

const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const reconciliationCodeSchema = z.object({
    plateCode: z.enum(PAPER_PLATE_CODES),
    /** the zone's count of paper files for the office and code; null when none is entered */
    paper: z.object({ count: z.number().int(), countedOn: z.string(), version: z.number().int() }).nullable(),
    verified: z.number().int(),
    /** paper minus verified, never below 0; null without a paper count */
    missing: z.number().int().nullable()
});
export type ReconciliationCode = z.infer<typeof reconciliationCodeSchema>;

/** Captured and not yet verified: only per office (a capture's plate is in typed tables once it is verified). */
export const reconciliationAwaitingSchema = z.object({
    captures: z.number().int(),
    importRows: z.number().int()
});

const sumsShape = {
    awaiting: reconciliationAwaitingSchema,
    verified: z.number().int(),
    /** the sum of the counted codes; null when no code has a paper count */
    paper: z.number().int().nullable(),
    missing: z.number().int().nullable(),
    /** verified over paper across the codes that have a paper count (0..1); null when none has */
    share: z.number().nullable()
};

export const reconciliationOfficeSchema = z.object({
    unit: unitRefSchema,
    codes: z.array(reconciliationCodeSchema),
    ...sumsShape
});
export type ReconciliationOffice = z.infer<typeof reconciliationOfficeSchema>;

export const migrationReportSchema = z.object({
    offices: z.array(reconciliationOfficeSchema),
    total: z.object(sumsShape),
    /** whether the caller may count paper files (they still may not for their own office) */
    mayCount: z.boolean(),
    /** the caller's active office: it is never offered a paper count of its own */
    ownUnitId: z.uuid().nullable()
});
export type MigrationReport = z.infer<typeof migrationReportSchema>;

export const paperCountSchema = z.strictObject({
    unitId: z.uuid(),
    plateCode: z.enum(PAPER_PLATE_CODES),
    count: z.number().int().min(0).max(MAX_PAPER_COUNT),
    countedOn: z.iso.date()
});
export type PaperCountInput = z.infer<typeof paperCountSchema>;
