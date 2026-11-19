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

/** Whether a holder of `issued-document:read-case` only reads the documents of its cases (ADR-0055): false unless the region says. */
export const DOCUMENT_CASE_READERS_SETTING = 'documents.case_readers_office_wide';

export const DOCUMENTS_SETTINGS = {
    [DOCUMENT_HEADER_SETTING]: documentHeaderSchema,
    [DOCUMENT_CASE_READERS_SETTING]: z.boolean()
} as const;

/** The acting office's header as its documents print it (task 1.13e): the title is always there (the office's name at worst). */
export const officialHeaderSchema = z.object({
    title: i18nTextSchema,
    subtitle: i18nTextSchema.nullable(),
    logo: z.string().nullable(),
    stamp: z.string().nullable()
});
export type OfficialHeader = z.infer<typeof officialHeaderSchema>;

const dayText = z.iso.date();
const signedSantim = z.string().regex(/^-?\d+$/);
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
    /** An office's remittance (task 1.12d): grouped by account, with the reversals after the till closed as negative lines. */
    'remittance.v1': z.object({
        number: z.string().min(1),
        preparedOn: dayText,
        periodFrom: dayText,
        periodTo: dayText,
        revenueTotalSantim: signedSantim,
        cashSantim: santimTextSchema,
        bankSlipSantim: santimTextSchema,
        reversalSantim: signedSantim,
        depositDueSantim: santimTextSchema,
        differenceSantim: signedSantim,
        groups: z.array(
            z.object({
                accountCode: z.string(),
                budgetCategory: z.string(),
                accountName: i18nTextSchema,
                mappedByDefault: z.boolean(),
                receiptSantim: signedSantim,
                reversalSantim: signedSantim,
                totalSantim: signedSantim
            })
        ),
        lines: z.array(
            z.object({
                kind: z.enum(['receipt', 'reversal']),
                receiptNumber: z.string(),
                lineKey: z.string(),
                accountCode: z.string(),
                mappedByDefault: z.boolean(),
                amountSantim: signedSantim
            })
        ),
        sessions: z.array(
            z.object({
                businessDay: dayText,
                openingFloatSantim: santimTextSchema,
                expectedCashSantim: santimTextSchema,
                countedSantim: santimTextSchema,
                differenceSantim: signedSantim
            })
        ),
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
    /** The libre as ITRMS issued it under ADR-0049 (superseded by ADR-0050): kept so the documents issued then still verify. */
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
    /**
     * The registration certificate: the zone's temporary libre (ጊዜያዊ የባለቤትነት ሊብሬ, ADR-0050), its fields as the zone prints
     * them. Not the libre: the federal booklet is. Once the booklet is issued, the certificate names its serial.
     */
    'vehicle-registration-certificate.v1': z.object({
        number: z.string().min(1),
        issuedOn: dayText,
        firstRegisteredOn: dayText,
        plate: z.string().min(1),
        federalVehicleId: z.string().min(1).nullable(),
        owners: z.array(z.object({ name: z.string().min(1), address: z.string().min(1).nullable() })).min(1),
        category: i18nTextSchema,
        make: z.string().min(1),
        model: z.string().min(1),
        modelYear: z.number().int(),
        madeIn: z.string().min(1).nullable(),
        chassisNumber: z.string().min(1),
        engineNumber: z.string().min(1).nullable(),
        engineCc: z.number().int().nullable(),
        engineHp: z.number().int().nullable(),
        cylinders: z.number().int().nullable(),
        fuel: i18nTextSchema.nullable(),
        colour: z.string().min(1).nullable(),
        lengthMm: z.number().int().nullable(),
        widthMm: z.number().int().nullable(),
        heightMm: z.number().int().nullable(),
        tyreSize: z.string().min(1).nullable(),
        tyres: z.number().int().nullable(),
        grossWeightKg: z.number().int().nullable(),
        netWeightKg: z.number().int().nullable(),
        seats: z.number().int().nullable(),
        loadCapacityKg: z.number().int().nullable(),
        use: i18nTextSchema,
        /** the bolo of the vehicle when it has one (task 1.3) */
        boloNumber: z.string().min(1).nullable(),
        /** the federal booklet's serial, once issued, and the national reference when given */
        bookletSerial: z.string().min(1).nullable(),
        nationalReference: z.string().min(1).nullable()
    }),
    /**
     * A vehicle's bolo (task 1.3a): the sticker's serial as its number, or the temporary bolo's own number with its last day,
     * the inspection it was given on, the fiscal year it stands for, and the third-party insurance it was given on.
     */
    'vehicle-bolo.v1': z.object({
        number: z.string().min(1),
        plate: z.string(),
        chassisNumber: z.string().min(1),
        make: z.string().min(1),
        model: z.string().min(1),
        category: i18nTextSchema,
        use: i18nTextSchema,
        checklistSerial: z.string().min(1),
        inspectedOn: dayText,
        fiscalYear: z.number().int(),
        validUntil: dayText,
        temporaryUntil: dayText.nullable(),
        insurance: z.object({ certificate: z.string().min(1), insurer: z.string().min(1), until: dayText })
    }),
    /**
     * A letter of an ownership transfer (task 1.4b): the justice office is asked to authenticate the contract and told the vehicle
     * has no hold, the revenue office is given the value the committee set (the duty is its own to determine), the tax office is
     * asked to register the buyers of a code-3 vehicle. One shape for the three; the valuation is on the revenue letter only.
     */
    'vehicle-transfer-letter.v1': z.object({
        number: z.string().min(1),
        issuedOn: dayText,
        validUntil: dayText,
        kind: z.enum(['justice', 'revenue', 'tax']),
        addressee: z.string().min(1),
        caseNumber: z.number().int(),
        acquiredBy: i18nTextSchema,
        vehicle: z.object({
            plate: z.string().min(1),
            chassisNumber: z.string().min(1),
            engineNumber: z.string().min(1).nullable(),
            make: z.string().min(1),
            model: z.string().min(1),
            modelYear: z.number().int(),
            category: i18nTextSchema,
            use: i18nTextSchema
        }),
        sellers: z.array(z.object({ name: z.string().min(1) })).min(1),
        buyers: z.array(z.object({ name: z.string().min(1) })).min(1),
        valuation: z
            .object({
                valuedOn: dayText,
                committeeValueSantim: santimTextSchema,
                purchasePriceSantim: santimTextSchema.nullable(),
                marketValueSantim: santimTextSchema.nullable(),
                contractValueSantim: santimTextSchema.nullable(),
                depreciationPercent: z.string().min(1).nullable(),
                valuers: z.string().min(1).nullable(),
                inspectionNote: z.string().min(1).nullable()
            })
            .nullable()
    }),
    /**
     * The zone's vehicle data transfer document (task 1.4c2, ADR-0058): given to the owner of a vehicle leaving for another region
     * or an office without ITRMS. The vehicle, its owners, its plates over time, the papers the owner brought, its bolo and the
     * holds it still carries; valid for the days the setting gives. Money as santim text; every empty value prints as a dash.
     */
    'vehicle-transfer-document.v1': z.object({
        number: z.string().min(1),
        issuedOn: dayText,
        validUntil: dayText,
        validDays: z.number().int(),
        caseNumber: z.number().int(),
        destination: z.object({ name: z.string().min(1), region: z.string().min(1).nullable() }),
        owners: z.array(z.object({ name: z.string().min(1), address: z.string().min(1).nullable() })).min(1),
        vehicle: z.object({
            plate: z.string().min(1),
            chassisNumber: z.string().min(1),
            engineNumber: z.string().min(1).nullable(),
            make: z.string().min(1),
            model: z.string().min(1),
            modelYear: z.number().int().nullable(),
            category: i18nTextSchema,
            use: i18nTextSchema
        }),
        /** the plates the vehicle carried, the current one first: the register's own, or an earlier one the owner brought */
        plates: z.array(
            z.object({
                plate: z.string().min(1),
                since: dayText.nullable(),
                until: dayText.nullable(),
                year: z.number().int().nullable(),
                place: z.string().min(1).nullable()
            })
        ),
        customsDeclarationNumber: z.string().min(1).nullable(),
        taxReceiptNumber: z.string().min(1).nullable(),
        purchaseValueSantim: santimTextSchema.nullable(),
        excisePaidSantim: santimTextSchema.nullable(),
        bolo: z
            .object({ serial: z.string().min(1).nullable(), validUntil: dayText, temporary: z.boolean() })
            .nullable(),
        holds: z.array(
            z.object({
                kind: i18nTextSchema,
                holder: z.string().min(1),
                letterReference: z.string().min(1),
                letterDate: dayText,
                amountSantim: santimTextSchema.nullable()
            })
        ),
        remarks: z.string().min(1).nullable(),
        preparedBy: z.string().min(1).nullable(),
        approvedBy: z.string().min(1).nullable()
    }),
    /** The letter that goes with the document to the office that receives the vehicle (task 1.4c2): always for another region. */
    'vehicle-transfer-covering-letter.v1': z.object({
        number: z.string().min(1),
        issuedOn: dayText,
        validUntil: dayText,
        caseNumber: z.number().int(),
        addressee: z.string().min(1),
        /** the transfer document it accompanies: none for a vehicle going to an office of the region (its release stands instead) */
        documentNumber: z.string().min(1).nullable(),
        vehicle: z.object({
            plate: z.string().min(1),
            chassisNumber: z.string().min(1),
            make: z.string().min(1),
            model: z.string().min(1)
        }),
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
