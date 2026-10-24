/**
 * Public entry of @itrms/forms (code-structure.md §4): the DTOs and events of form definitions, their versions and
 * publications, and submissions. One source per fact: these schemas validate the API's input and output and write the
 * OpenAPI document.
 *
 * A definition holds a working copy (`document`). Publishing snapshots it as an immutable, content-hashed version; a second
 * person approves before people fill it in (SEC-AC-6). A submission names the version it was filled on and keeps it.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

/** A stored form is at most this big as JSON (the contract also caps it at 1000 fields). */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
/** A submission's answers are at most this big as JSON. */
export const MAX_ANSWERS_BYTES = 512 * 1024;

// contracts run in the browser too: no Buffer
const utf8 = new TextEncoder();
const jsonBytes = (v: unknown) => utf8.encode(JSON.stringify(v) ?? '').length;

/** The engine's document (`{ schemaVersion?, fields, runtime? }`, or the oldest bare field list); the API checks it. */
export const formDocumentInputSchema = z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .refine((d) => jsonBytes(d) <= MAX_DOCUMENT_BYTES, `a form is at most ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);

/** A definition's key: lower-case words joined by hyphens, unique in the region (`driving-licence-application`). */
export const formKeySchema = z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower-case letters and digits, joined by hyphens');

export const FORM_STATUSES = ['draft', 'pending', 'published'] as const;

export const formCreateSchema = z.strictObject({
    key: formKeySchema,
    name: i18nTextSchema,
    category: z.string().trim().min(1).max(100).optional(),
    document: formDocumentInputSchema
});

export const formUpdateSchema = z
    .strictObject({
        name: i18nTextSchema.optional(),
        category: z.string().trim().min(1).max(100).nullable().optional(),
        active: z.boolean().optional(),
        document: formDocumentInputSchema.optional()
    })
    .refine((u) => Object.keys(u).length > 0, 'nothing to change');

export const formListQuerySchema = z.strictObject({
    q: z.string().trim().max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const formSummarySchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    key: z.string(),
    name: z.record(z.string(), z.string()),
    category: z.string().nullable(),
    active: z.boolean(),
    /** draft: the working copy is not what people fill in; pending: a publication waits for approval */
    status: z.enum(FORM_STATUSES),
    ownerUnit: unitRefSchema,
    publishedVersion: z.object({ id: z.uuid(), number: z.number().int(), publishedAt: z.string() }).nullable(),
    updatedAt: z.string()
});

export const formSchema = formSummarySchema.extend({ document: z.unknown(), documentHash: z.string() });

export const formVersionSchema = z.object({
    id: z.uuid(),
    formId: z.uuid(),
    number: z.number().int(),
    contentHash: z.string(),
    document: z.unknown(),
    createdAt: z.string(),
    createdBy: z.uuid().nullable()
});

export const formVersionSummarySchema = formVersionSchema.omit({ document: true }).extend({ published: z.boolean() });

export const PUBLICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const publicationRequestSchema = z.strictObject({
    /** for the approver: what changed and why */
    note: z.string().trim().min(1).max(500).optional()
});

export const publicationDecisionSchema = z.strictObject({ note: z.string().trim().min(1).max(500).optional() });

export const publicationListQuerySchema = z.strictObject({
    status: z.enum(PUBLICATION_STATUSES).default('pending'),
    formId: z.uuid().optional()
});

export const publicationSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    formId: z.uuid(),
    formName: z.record(z.string(), z.string()),
    formVersion: z.object({ id: z.uuid(), number: z.number().int() }),
    status: z.enum(PUBLICATION_STATUSES),
    note: z.string().nullable(),
    requestedBy: z.uuid().nullable(),
    requestedAt: z.string(),
    decidedBy: z.uuid().nullable(),
    decidedAt: z.string().nullable(),
    decisionNote: z.string().nullable()
});

/** Answers keyed by field id, as the engine writes them; only the form's own fields are kept. */
export const answersSchema = z
    .record(z.string().max(200), z.unknown())
    .refine((a) => jsonBytes(a) <= MAX_ANSWERS_BYTES, `answers are at most ${MAX_ANSWERS_BYTES / 1024} KB`);

export const submissionCreateSchema = z.strictObject({
    formId: z.uuid(),
    /** the version the person filled in: it must still be the published one */
    formVersionId: z.uuid(),
    answers: answersSchema
});

export const submissionUpdateSchema = z.strictObject({ answers: answersSchema });

export const submissionListQuerySchema = z.strictObject({
    formId: z.uuid(),
    /** only what the signed-in person submitted */
    mine: z.enum(['true', 'false']).optional(),
    /** the last id of the previous page: the next page starts after it (newest first) */
    before: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const submissionSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    formId: z.uuid(),
    formVersion: z.object({ id: z.uuid(), number: z.number().int() }),
    caseId: z.uuid().nullable(),
    handlingUnit: unitRefSchema,
    answers: z.record(z.string(), z.unknown()),
    submittedBy: z.uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
});

export type FormSummary = z.infer<typeof formSummarySchema>;
export type Form = z.infer<typeof formSchema>;
export type FormVersion = z.infer<typeof formVersionSchema>;
export type FormVersionSummary = z.infer<typeof formVersionSummarySchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Submission = z.infer<typeof submissionSchema>;

/** A version became the one people fill in (0.16b creates the indexes of its filterable fields). */
export const formPublishedV1 = z.strictObject({
    formId: z.uuid(),
    formVersionId: z.uuid(),
    previousVersionId: z.uuid().nullable(),
    publicationId: z.uuid()
});

export const FORMS_EVENTS = { 'form.published.v1': formPublishedV1 } as const;
