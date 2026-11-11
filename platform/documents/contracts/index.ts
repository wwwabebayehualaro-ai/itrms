/**
 * Documents (architecture.md §10, ADR-0006, ADR-0044; task 0.23a): templates, their data, and the documents issued. A
 * template names the shape of the data it needs (`dataSchema`), one of the shapes here; what is issued is checked against
 * it and kept with the document, so what was printed can always be explained.
 */
import { i18nTextSchema, santimTextSchema } from '@itrms/schemas';
import { z } from 'zod';

export * from './verification';

export const ISSUE_DOCUMENT_EFFECT = 'documents.issue';
export const TEMPLATE_KEY = /^[a-z][a-z0-9-]{1,62}$/;
/** The largest image a header or a licence photo may inline (the PDF worker never fetches one). */
export const MAX_INLINE_IMAGE = 300 * 1024;

const inlineImage = z
    .string()
    .max(MAX_INLINE_IMAGE)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'an inline PNG, JPEG or WebP image');

/**
 * What heads a unit's documents (class C, inherited down the tree): a unit without its own uses its parent's. Without any,
 * its office's name. Real names, logos and stamps only with permission (CLAUDE.md).
 */
export const DOCUMENT_HEADER_SETTING = 'documents.header';
export const documentHeaderSchema = z.strictObject({
    title: i18nTextSchema.optional(),
    subtitle: i18nTextSchema.optional(),
    logo: inlineImage.optional(),
    stamp: inlineImage.optional()
});
export type DocumentHeader = z.infer<typeof documentHeaderSchema>;

export const DOCUMENTS_SETTINGS = { [DOCUMENT_HEADER_SETTING]: documentHeaderSchema } as const;

const dayText = z.iso.date();
const line = z.object({
    label: i18nTextSchema,
    quantity: z.number().int().nullable(),
    amountSantim: santimTextSchema
});

/** The shapes of what templates print. */
export const DOCUMENT_DATA_SCHEMAS = {
    'receipt.v1': z.object({
        number: z.string().min(1),
        issuedOn: dayText,
        caseNumber: z.number().int(),
        serviceName: i18nTextSchema,
        receivedFrom: z.string().min(1),
        method: z.enum(['cash', 'bank_slip']),
        amountSantim: santimTextSchema,
        lines: z.array(line),
        demo: z.boolean()
    }),
    'application-copy.v1': z.object({
        caseNumber: z.number().int(),
        /** in the document's language: a form's labels may be in only one */
        serviceName: z.string(),
        filedOn: dayText,
        fields: z.array(z.object({ label: z.string(), value: z.string() }))
    }),
    'licence-card.v1': z.object({
        number: z.string().min(1),
        holderName: z.string().min(1),
        birthDate: dayText.nullable(),
        grades: z.array(z.object({ grade: z.string().min(1), name: i18nTextSchema })).min(1),
        issuedOn: dayText,
        validUntil: dayText,
        photo: inlineImage.nullable()
    }),
    /** The libre (ownership title booklet) as ITRMS issues it (ADR-0049): the vehicle's particulars and its owners at issue. */
    'vehicle-libre.v1': z.object({
        number: z.string().min(1),
        issuedOn: dayText,
        firstRegisteredOn: dayText,
        plate: z.string().min(1),
        federalVehicleId: z.string().min(1).nullable(),
        chassisNumber: z.string().min(1),
        engineNumber: z.string().min(1).nullable(),
        make: z.string().min(1),
        model: z.string().min(1),
        modelYear: z.number().int(),
        category: i18nTextSchema,
        use: i18nTextSchema,
        fuel: i18nTextSchema.nullable(),
        colour: z.string().min(1).nullable(),
        seats: z.number().int().nullable(),
        loadCapacityKg: z.number().int().nullable(),
        owners: z.array(z.object({ name: z.string().min(1) })).min(1)
    }),
    'exam-result.v1': z.object({
        sessionOn: dayText,
        serviceName: i18nTextSchema,
        candidates: z.array(
            z.object({
                name: z.string().min(1),
                grade: z.string().min(1),
                theory: z.number().int().nullable(),
                practical: z.number().int().nullable(),
                passed: z.boolean()
            })
        )
    })
} as const;
export type DocumentDataSchema = keyof typeof DOCUMENT_DATA_SCHEMAS;
export const DOCUMENT_DATA_SCHEMA_KEYS = Object.keys(DOCUMENT_DATA_SCHEMAS) as [
    DocumentDataSchema,
    ...DocumentDataSchema[]
];

export const PAPERS = ['A4', 'A5', 'card'] as const;
export type Paper = (typeof PAPERS)[number];

/** A template's version: its LiquidJS body, its own words, its paper and the shape of its data. */
export const documentTemplateVersionSchema = z.strictObject({
    body: z.string().min(1).max(200_000),
    strings: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), i18nTextSchema),
    paper: z.enum(PAPERS),
    dataSchema: z.enum(DOCUMENT_DATA_SCHEMA_KEYS)
});
export type DocumentTemplateVersion = z.infer<typeof documentTemplateVersionSchema>;

export const ISSUED_STATES = ['requested', 'rendered', 'failed'] as const;
export const issuedDocumentQuerySchema = z.object({
    caseId: z.uuid().optional(),
    subjectId: z.uuid().optional()
});
export const issuedDocumentOutSchema = z.object({
    id: z.uuid(),
    templateKey: z.string(),
    templateName: i18nTextSchema,
    number: z.string().nullable(),
    caseId: z.uuid().nullable(),
    language: z.string(),
    state: z.enum(ISSUED_STATES),
    failure: z.string().nullable(),
    /** no longer valid: its QR says so */
    revoked: z.boolean(),
    superseded: z.boolean(),
    issuedAt: z.string()
});
export type IssuedDocumentOut = z.infer<typeof issuedDocumentOutSchema>;
export const documentDownloadOutSchema = z.object({ url: z.string(), expiresAt: z.string() });

/** The events of the slice: a document to render, delivered only to the `worker-documents` service. */
export const DOCUMENTS_EVENTS = {
    'document.render.v1': z.object({ documentId: z.uuid() })
} as const;
/** The queue the PDF worker consumes: a Chrome spike never stalls the outbox, SLA timers or notifications. */
export const DOCUMENTS_QUEUE = 'documents';
export const DOCUMENTS_ROUTES = { 'document.render.v1': DOCUMENTS_QUEUE } as const;
