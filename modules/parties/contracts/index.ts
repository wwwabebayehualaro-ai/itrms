/**
 * Public entry of @itrms/parties (code-structure.md §4): the register's DTOs and events. One source per fact: these schemas
 * validate the API's input and output, write the OpenAPI document and check the screens' forms.
 *
 * A person's sensitive fields (full birth date, phone, Fayda FIN) go in with a create or an update and never come out of
 * the register's ordinary reads: those say only whether each is on record. They are read in clear only through reveal,
 * which needs `pii:reveal`, a reason and a recent second factor.
 */
import { z } from 'zod';

const ETHIOPIC = /^[\p{Script=Ethiopic}][\p{Script=Ethiopic}\s.'’-]*$/u;
const LATIN = /^[\p{Script=Latin}][\p{Script=Latin}\s.'’-]*$/u;

const ethiopicPart = z.string().trim().min(1).max(60).regex(ETHIOPIC, 'expected Ethiopic script');
const latinPart = z.string().trim().min(1).max(60).regex(LATIN, 'expected Latin script');

/** A name as Ethiopian names are given: own name, father's name, grandfather's name. */
export const ethiopicNameSchema = z.strictObject({
    given: ethiopicPart,
    father: ethiopicPart,
    grandfather: ethiopicPart.optional()
});
export const latinNameSchema = z.strictObject({
    given: latinPart,
    father: latinPart,
    grandfather: latinPart.optional()
});
export type PersonName = z.infer<typeof ethiopicNameSchema>;

export const SEXES = ['female', 'male'] as const;

/** A date as stored (Gregorian, `YYYY-MM-DD`; entered and shown Ethiopian), and one that exists. */
export const isoDateSchema = z.iso.date();

/**
 * An Ethiopian mobile number in any usual writing (`0911 23 45 67`, `+251 911234567`, `911234567`, `07…` too), always
 * kept as `+2519XXXXXXXX` / `+2517XXXXXXXX`.
 */
export function normalisePhone(value: string): string | undefined {
    const digits = value.replace(/[\s()-]/g, '');
    const match = /^(?:\+?251|0)?([79]\d{8})$/.exec(digits);
    return match ? `+251${match[1]}` : undefined;
}
export const phoneSchema = z
    .string()
    .max(20)
    .transform((v, ctx) => {
        const phone = normalisePhone(v);
        if (!phone) ctx.addIssue({ code: 'custom', message: 'expected an Ethiopian mobile number' });
        return phone ?? v;
    });

/** The Fayda number (FIN): 12 digits, written with or without spaces. */
export function normaliseFin(value: string): string | undefined {
    const digits = value.replace(/[\s-]/g, '');
    return /^\d{12}$/.test(digits) ? digits : undefined;
}
export const finSchema = z
    .string()
    .max(20)
    .transform((v, ctx) => {
        const fin = normaliseFin(v);
        if (!fin) ctx.addIssue({ code: 'custom', message: 'expected a Fayda number of 12 digits' });
        return fin ?? v;
    });

export const addressSchema = z.strictObject({
    /** the woreda or town (an org unit of the region) the person lives in */
    unitId: z.uuid(),
    kebele: z.string().trim().min(1).max(60).optional(),
    houseNumber: z.string().trim().min(1).max(30).optional()
});

export const SENSITIVE_FIELDS = ['birthDate', 'phone', 'fin'] as const;
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

/** The sensitive fields written: a value sets one; on an update, null removes it and a missing key leaves it. */
export const sensitiveInputSchema = z.strictObject({
    birthDate: isoDateSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    fin: finSchema.nullable().optional()
});

const yearSchema = z.number().int().min(1900).max(2100);

export const personCreateSchema = z.strictObject({
    nameAm: ethiopicNameSchema,
    nameEn: latinNameSchema.optional(),
    sex: z.enum(SEXES),
    /** Gregorian; set from the birth date when that is given */
    birthYear: yearSchema.optional(),
    address: addressSchema.optional(),
    sensitive: sensitiveInputSchema.optional(),
    /** the possible duplicates the person saw and decided are other people (from POST /persons/duplicates) */
    acknowledgedDuplicates: z.array(z.uuid()).max(20).optional()
});
export type PersonCreate = z.infer<typeof personCreateSchema>;

/** A correction: the keys sent change, the others stay (If-Match: the version read). */
export const personUpdateSchema = z.strictObject({
    nameAm: ethiopicNameSchema.optional(),
    nameEn: latinNameSchema.nullable().optional(),
    sex: z.enum(SEXES).optional(),
    birthYear: yearSchema.nullable().optional(),
    address: addressSchema.nullable().optional(),
    sensitive: sensitiveInputSchema.optional()
});
export type PersonUpdate = z.infer<typeof personUpdateSchema>;

const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const PERSON_STATUSES = ['active', 'merged'] as const;

export const personSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    nameAm: ethiopicNameSchema,
    nameEn: latinNameSchema.nullable(),
    sex: z.enum(SEXES),
    birthYear: z.number().int().nullable(),
    address: z
        .object({ unit: unitRefSchema, kebele: z.string().nullable(), houseNumber: z.string().nullable() })
        .nullable(),
    handlingUnit: unitRefSchema,
    status: z.enum(PERSON_STATUSES),
    mergedIntoId: z.uuid().nullable(),
    /** whether each sensitive field is on record: never its value */
    sensitive: z.object({ birthDate: z.boolean(), phone: z.boolean(), fin: z.boolean() }),
    createdAt: z.string(),
    updatedAt: z.string()
});
export type Person = z.infer<typeof personSchema>;

export const personSummarySchema = personSchema.pick({
    id: true,
    nameAm: true,
    nameEn: true,
    sex: true,
    birthYear: true,
    handlingUnit: true,
    status: true
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

/** `GET /persons?q=`: a name in either script, folded (homophones, apostrophes, case). */
export const personSearchQuerySchema = z.strictObject({
    q: z.string().trim().min(2).max(100),
    limit: z.coerce.number().int().min(1).max(50).default(20)
});

/** `POST /persons/lookup`: an exact sensitive value (never in a URL), matched by its blind index. */
export const personLookupSchema = z
    .strictObject({ fin: finSchema.optional(), phone: phoneSchema.optional() })
    .refine((v) => v.fin !== undefined || v.phone !== undefined, 'send a fin or a phone');

export const personListSchema = z.object({ items: z.array(personSummarySchema) });

/** `POST /persons/duplicates`: the people a new record may be the same as, and why. */
export const duplicateCheckSchema = z.strictObject({
    nameAm: ethiopicNameSchema,
    nameEn: latinNameSchema.optional(),
    sensitive: sensitiveInputSchema.optional()
});
export const DUPLICATE_REASONS = ['fin', 'name_birth_date_phone', 'name_phone', 'name_birth_date'] as const;
export const duplicateListSchema = z.object({
    items: z.array(z.object({ person: personSummarySchema, reasons: z.array(z.enum(DUPLICATE_REASONS)) }))
});
export type DuplicateList = z.infer<typeof duplicateListSchema>;

export const revealRequestSchema = z.strictObject({
    fields: z
        .array(z.enum(SENSITIVE_FIELDS))
        .min(1)
        .max(SENSITIVE_FIELDS.length)
        .refine((f) => new Set(f).size === f.length, 'a field is listed twice'),
    /** why the person needs to see them (kept in the audit log) */
    reason: z.string().trim().min(10).max(500)
});
export const revealedSchema = z.object({
    birthDate: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    fin: z.string().nullable().optional()
});

export const MERGE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const mergeRequestSchema = z
    .strictObject({
        /** the record that stays */
        survivorId: z.uuid(),
        /** the record found to be the same person: it is closed and points to the survivor */
        duplicateId: z.uuid(),
        reason: z.string().trim().min(10).max(500)
    })
    .refine((m) => m.survivorId !== m.duplicateId, 'a record cannot be merged into itself');
export const mergeDecisionSchema = z.strictObject({ note: z.string().trim().max(500).optional() });
export const mergeSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    survivor: personSummarySchema,
    duplicate: personSummarySchema,
    reason: z.string(),
    status: z.enum(MERGE_STATUSES),
    requestedBy: z.uuid().nullable(),
    decidedBy: z.uuid().nullable(),
    decidedAt: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: z.string()
});
export const mergeListSchema = z.object({ items: z.array(mergeSchema) });

export const ORGANISATION_KINDS = [
    'association',
    'training_school',
    'contractor',
    'consultant',
    'garage',
    'insurer',
    'health_facility',
    'government_office',
    'other'
] as const;
export const MEMBER_ROLES = ['chair', 'secretary', 'treasurer', 'manager', 'owner', 'member'] as const;

const orgName = z.strictObject({
    am: z.string().trim().min(1).max(200),
    en: z.string().trim().min(1).max(200)
});

export const organisationCreateSchema = z.strictObject({
    kind: z.enum(ORGANISATION_KINDS),
    name: orgName,
    /** the tax number (TIN): 10 digits */
    tin: z
        .string()
        .trim()
        .regex(/^\d{10}$/, 'expected a TIN of 10 digits')
        .optional(),
    licenceNumber: z.string().trim().min(1).max(60).optional(),
    address: addressSchema.optional()
});
export const organisationUpdateSchema = z.strictObject({
    kind: z.enum(ORGANISATION_KINDS).optional(),
    name: orgName.optional(),
    tin: z
        .string()
        .trim()
        .regex(/^\d{10}$/, 'expected a TIN of 10 digits')
        .nullable()
        .optional(),
    licenceNumber: z.string().trim().min(1).max(60).nullable().optional(),
    address: addressSchema.nullable().optional()
});
export const memberSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    person: personSummarySchema,
    role: z.enum(MEMBER_ROLES),
    since: z.string().nullable(),
    until: z.string().nullable()
});
export const organisationSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    kind: z.enum(ORGANISATION_KINDS),
    name: orgName,
    tin: z.string().nullable(),
    licenceNumber: z.string().nullable(),
    address: z
        .object({ unit: unitRefSchema, kebele: z.string().nullable(), houseNumber: z.string().nullable() })
        .nullable(),
    handlingUnit: unitRefSchema,
    members: z.array(memberSchema),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const organisationListSchema = z.object({
    items: z.array(organisationSchema.omit({ members: true }))
});
export const organisationSearchQuerySchema = z.strictObject({
    q: z.string().trim().min(2).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
});
export const memberAddSchema = z.strictObject({
    personId: z.uuid(),
    role: z.enum(MEMBER_ROLES),
    since: isoDateSchema.optional()
});
export const memberEndSchema = z.strictObject({ until: isoDateSchema });

/** A duplicate record was merged into the one that stays: holders of person ids (licences, cases) follow it. */
export const personMergedV1 = z.strictObject({
    survivorId: z.uuid(),
    duplicateId: z.uuid(),
    mergeId: z.uuid()
});

export const PARTIES_EVENTS = { 'person.merged.v1': personMergedV1 } as const;
