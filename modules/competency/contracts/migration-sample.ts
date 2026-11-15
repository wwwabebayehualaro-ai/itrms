/**
 * Sampling QA of migrated vehicles (ADR-0054 §3, task 1.13g). When a paper file joins the register (back-captured and verified,
 * or imported and committed), a set share of each clerk's records is drawn for a re-check against the scan by someone who is
 * neither the clerk nor the second person who verified it; the facts they find wrong are counted per clerk. A re-check measures:
 * it never changes the record (a correction is a service of its own).
 */
import { z } from 'zod';

/**
 * The share of each clerk's migrated records drawn for a re-check, in percent: the bureau's, or one for a kind of office, never an
 * office's own (the office measured does not set its own measure).
 */
export const MIGRATION_SAMPLE_SETTING = 'competency.migration_sample_percent';
export const DEFAULT_SAMPLE_PERCENT = 5;
export const sampleShareSchema = z.number().int().min(0).max(100);

export const SAMPLE_SOURCES = ['back_capture', 'import'] as const;
export type SampleSource = (typeof SAMPLE_SOURCES)[number];

/** `drawn` until someone re-checks it against the scan, then `rechecked` (final). */
export const SAMPLE_STATES = ['drawn', 'rechecked'] as const;
export type SampleState = (typeof SAMPLE_STATES)[number];

export const SAMPLE_OUTCOMES = ['correct', 'errors'] as const;
export type SampleOutcome = (typeof SAMPLE_OUTCOMES)[number];

/** The facts a re-check compares with the scan; `scan` when the scan itself is not the vehicle's file or cannot be read. */
export const SAMPLE_FIELDS = [
    'paper_reference',
    'first_registered_on',
    'owners_since',
    'plate',
    'libre',
    'federal_vehicle_id',
    'chassis_number',
    'engine_number',
    'make',
    'model',
    'model_year',
    'category',
    'use',
    'capacity',
    'colour',
    'fuel',
    'owners',
    'scan'
] as const;
export type SampleField = (typeof SAMPLE_FIELDS)[number];

const personRefSchema = z.object({ id: z.uuid(), name: z.string() });
const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const migrationSampleSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    source: z.enum(SAMPLE_SOURCES),
    vehicle: z.object({
        id: z.uuid(),
        plate: z.string().nullable(),
        chassisNumber: z.string(),
        paperReference: z.string().nullable()
    }),
    /** the capture's case, or the sheet's row and its batch */
    caseId: z.uuid().nullable(),
    importRowId: z.uuid().nullable(),
    importId: z.uuid().nullable(),
    clerk: personRefSchema,
    verifier: personRefSchema,
    hasScan: z.boolean(),
    /** the share in force when it was drawn */
    share: z.number().int(),
    state: z.enum(SAMPLE_STATES),
    outcome: z.enum(SAMPLE_OUTCOMES).nullable(),
    errorFields: z.array(z.enum(SAMPLE_FIELDS)),
    note: z.string().nullable(),
    recheckedBy: personRefSchema.nullable(),
    recheckedAt: z.string().nullable(),
    drawnAt: z.string(),
    unit: unitRefSchema,
    /** whether the caller may re-check it now: drawn, and they are neither its clerk nor its verifier */
    mayRecheck: z.boolean()
});
export type MigrationSample = z.infer<typeof migrationSampleSchema>;

export const migrationSampleListSchema = z.object({ items: z.array(migrationSampleSchema), total: z.number().int() });

export const migrationSampleQuerySchema = z.strictObject({
    state: z.enum(SAMPLE_STATES).optional(),
    /** the drawn record of one vehicle, as its record links to it */
    vehicleId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0)
});

/** The re-check: correct, or the facts found wrong (at least one, each once). */
export const migrationSampleRecheckSchema = z
    .strictObject({
        outcome: z.enum(SAMPLE_OUTCOMES),
        fields: z.array(z.enum(SAMPLE_FIELDS)).max(SAMPLE_FIELDS.length).default([]),
        note: z.string().trim().min(1).max(500).optional()
    })
    .refine((r) => (r.outcome === 'errors') === r.fields.length > 0, {
        path: ['fields'],
        message: 'name the facts found wrong, and only with errors'
    })
    .refine((r) => new Set(r.fields).size === r.fields.length, { path: ['fields'], message: 'a fact named twice' });
export type MigrationSampleRecheck = z.infer<typeof migrationSampleRecheckSchema>;

/** A clerk's migration at an office: their records, those drawn, re-checked, re-checked with errors, and the errors found. */
export const clerkCountsSchema = z.object({
    unit: unitRefSchema,
    clerk: personRefSchema,
    records: z.number().int(),
    drawn: z.number().int(),
    rechecked: z.number().int(),
    withErrors: z.number().int(),
    errors: z.number().int()
});
export type ClerkCounts = z.infer<typeof clerkCountsSchema>;
export const clerkCountsListSchema = z.object({ items: z.array(clerkCountsSchema) });
