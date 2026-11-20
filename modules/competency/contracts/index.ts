/**
 * Public contracts of @itrms/competency (task 0.24a): driver licences, what they are made from, and what goes to the national
 * platform. A licence is `pending_national` until that platform accepts it: nothing competes with a national record.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

import { BOLO_EVENTS, BOLO_REMINDER_DAYS_SETTING, TEMPORARY_BOLO_DAYS_SETTING } from './bolo';
import { MIGRATION_SAMPLE_SETTING, sampleShareSchema } from './migration-sample';
import {
    CARD_SHOWS_BLOOD_GROUP_SETTING,
    cardSerialQuery,
    LICENCE_NUMBER_SETTING,
    licenceNumberingSchema
} from './licence-family';
import { LIBRE_NOTICE_DAYS_SETTING } from './replacement';
import { MEDICAL_MONTHS_SETTING, RENEWAL_WINDOW_SETTING } from './rules';
import { TRANSFER_LETTER_ENFORCED_SETTING, TRANSFER_LETTER_VALID_DAYS_SETTING } from './transfer';
import { VEHICLE_TRANSFER_PLATE_EXCHANGE_SETTING } from './vehicle-arrival';
import {
    VEHICLE_RELEASE_CANCEL_UNRETURNED_SETTING,
    VEHICLE_TRANSFER_COVERING_LETTER_SETTING,
    VEHICLE_TRANSFER_REINSPECT_SETTING,
    VEHICLE_TRANSFER_VALID_DAYS_SETTING
} from './vehicle-transfer';
import { VEHICLE_IMPORT_EVENTS } from './vehicle-import';

export * from './back-capture';
export * from './bolo';
export * from './campaign';
export * from './exchange';
export * from './licence-family';
export * from './licence-medical';
export * from './migration-report';
export * from './migration-sample';
export * from './registration';
export * from './replacement';
export * from './rules';
export * from './transfer';
export * from './vehicle-arrival';
export * from './vehicle-import';
export * from './vehicle-transfer';

export const LICENCE_STATUSES = ['pending_national', 'active', 'voided'] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];
export const LICENCE_KINDS = ['temporary', 'permanent'] as const;
export const ENROLMENT_STATUSES = ['enrolled', 'completed'] as const;
export const BATCH_STATUSES = ['open', 'requested', 'sent', 'returned', 'distributed'] as const;
export const GRADE_FAMILIES = ['motorcycle', 'automobile', 'truck', 'public', 'tanker', 'machinery', 'taxi'] as const;

/** The regional counter a licence number comes from, until the national platform issues numbers (architecture.md §15). */
export const LICENCE_COUNTER = 'competency.licence';
export const LICENCE_PATTERN = '{unit}/DL/{seq:06}';

const monthsSetting = z.number().int().min(1).max(60);
export const COMPETENCY_SETTINGS = {
    [MEDICAL_MONTHS_SETTING]: monthsSetting,
    [RENEWAL_WINDOW_SETTING]: monthsSetting,
    [TEMPORARY_BOLO_DAYS_SETTING]: z.number().int().min(1).max(90),
    [BOLO_REMINDER_DAYS_SETTING]: z.number().int().min(1).max(120),
    [MIGRATION_SAMPLE_SETTING]: sampleShareSchema,
    [TRANSFER_LETTER_VALID_DAYS_SETTING]: z.number().int().min(1).max(180),
    [TRANSFER_LETTER_ENFORCED_SETTING]: z.boolean(),
    [VEHICLE_TRANSFER_VALID_DAYS_SETTING]: z.number().int().min(1).max(60),
    [VEHICLE_TRANSFER_REINSPECT_SETTING]: z.boolean(),
    [VEHICLE_TRANSFER_COVERING_LETTER_SETTING]: z.boolean(),
    [VEHICLE_RELEASE_CANCEL_UNRETURNED_SETTING]: z.boolean(),
    [VEHICLE_TRANSFER_PLATE_EXCHANGE_SETTING]: z.boolean(),
    [LIBRE_NOTICE_DAYS_SETTING]: z.number().int().min(1).max(365),
    [LICENCE_NUMBER_SETTING]: licenceNumberingSchema,
    [CARD_SHOWS_BLOOD_GROUP_SETTING]: z.boolean()
} as const;

/** The document a licence prints as. */
export const LICENCE_CARD_TEMPLATE = 'licence-card';

export const COMPETENCY_EFFECTS = {
    checkApplication: 'competency.checkApplication',
    recordExam: 'competency.recordExam',
    createPendingLicence: 'competency.createPendingLicence',
    activateLicence: 'competency.activateLicence',
    voidPendingLicence: 'competency.voidPendingLicence',
    checkRenewal: 'competency.checkRenewal',
    requestRenewal: 'competency.requestRenewal',
    renewLicence: 'competency.renewLicence',
    issueLicenceCard: 'competency.issueLicenceCard',
    addToPrintBatch: 'competency.addToPrintBatch'
} as const;

/** The system actor the national platform's answers come as, and the events a workflow waits on. */
export const NATIONAL_ACTOR = 'system:national-driver-platform';
export const NATIONAL_ACCEPTED = 'event:national.licence.accepted';
export const NATIONAL_REJECTED = 'event:national.licence.rejected';

export const COMPETENCY_EVENTS = {
    /** the worker asks the national platform (external calls never run in a request) */
    'licence.national-requested.v1': z.object({
        caseId: z.uuid(),
        licenceId: z.uuid(),
        kind: z.enum(['new', 'renewal']),
        /** a new decision after a refusal, which the platform must take afresh; a retry keeps its number and gets the same answer */
        attempt: z.number().int().min(0).default(0)
    }),
    'licence-batch.print-requested.v1': z.object({ batchId: z.uuid() }),
    ...BOLO_EVENTS,
    ...VEHICLE_IMPORT_EVENTS
} as const;

/** What an answer of the national platform gives a licence, as an event's input to the case's effects. */
export const nationalAnswerSchema = z.object({
    reference: z.string().min(1).optional(),
    licenceNumber: z.string().min(1).nullable().optional(),
    reason: z.string().optional()
});

export const licenceGradeSchema = z.object({
    key: z.string(),
    name: i18nTextSchema,
    family: z.enum(GRADE_FAMILIES),
    minAge: z.number().int().nullable(),
    minEducation: z.number().int(),
    prerequisites: z.array(z.string()),
    prerequisiteMonths: z.number().int(),
    active: z.boolean()
});
export type LicenceGrade = z.infer<typeof licenceGradeSchema>;

const personName = z.object({ given: z.string(), father: z.string(), grandfather: z.string().nullable() }).nullable();

export const licenceSchema = z.object({
    id: z.uuid(),
    number: z.string().nullable(),
    status: z.enum(LICENCE_STATUSES),
    kind: z.enum(LICENCE_KINDS),
    personId: z.uuid(),
    holder: z.object({ am: personName, en: personName }),
    grades: z.array(z.object({ key: z.string(), name: i18nTextSchema, permanentSince: z.iso.date().nullable() })),
    handlingUnit: z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) }),
    issuedOn: z.iso.date().nullable(),
    validUntil: z.iso.date().nullable(),
    nationalReference: z.string().nullable(),
    /** the serial printed on the card, once a printed batch came back (task 1.6) */
    cardSerial: z.string().nullable(),
    /** whether a blood group is on record: never the value, which only the audited reveal reads (ADR-0052) */
    bloodGroupOnRecord: z.boolean(),
    /** whether the region collects the blood group (`competency.card_shows_blood_group`) */
    bloodGroupCollected: z.boolean(),
    caseId: z.uuid().nullable(),
    version: z.number().int()
});
export type Licence = z.infer<typeof licenceSchema>;
export const licenceListSchema = z.object({ items: z.array(licenceSchema) });

export const licenceQuerySchema = z.strictObject({
    personId: z.uuid().optional(),
    status: z.enum(LICENCE_STATUSES).optional(),
    /** the start of a licence number */
    number: z.string().trim().min(1).max(60).optional(),
    /** the start of the serial printed on the card (task 1.6) */
    cardSerial: cardSerialQuery.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const enrolmentCreateSchema = z.strictObject({
    personId: z.uuid(),
    schoolId: z.uuid(),
    grade: z.string().min(1).max(40)
});
export const enrolmentCompleteSchema = z.strictObject({ completedOn: z.iso.date() });
export const enrolmentQuerySchema = z.strictObject({
    personId: z.uuid().optional(),
    schoolId: z.uuid().optional(),
    status: z.enum(ENROLMENT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});
export const enrolmentSchema = z.object({
    id: z.uuid(),
    personId: z.uuid(),
    schoolId: z.uuid(),
    grade: z.string(),
    /** for the office's list: the register's names, as they are now */
    personName: z.object({ am: z.string(), en: z.string().nullable() }),
    schoolName: i18nTextSchema,
    gradeName: i18nTextSchema,
    status: z.enum(ENROLMENT_STATUSES),
    completedOn: z.iso.date().nullable(),
    version: z.number().int()
});
export type Enrolment = z.infer<typeof enrolmentSchema>;
export const enrolmentListSchema = z.object({ items: z.array(enrolmentSchema) });

export const printBatchSchema = z.object({
    id: z.uuid(),
    status: z.enum(BATCH_STATUSES),
    handlingUnitId: z.uuid(),
    nationalReference: z.string().nullable(),
    licences: z.number().int(),
    createdAt: z.string(),
    version: z.number().int()
});
export type PrintBatch = z.infer<typeof printBatchSchema>;

/**
 * `POST /competency/print-batches/:id/printing` (task 1.12a): a sent batch came back printed. Each licence names the card
 * blank it was printed on (or the first card is named, and the batch's licences follow it in order, the spoiled blanks
 * skipped: how a printer is loaded), and each blank spoiled in the printing is recorded with why; every one is taken from
 * the printing office's controlled stationery, once.
 */
const cardKey = z.string().trim().min(1).max(20);
export const printBatchPrintedSchema = z
    .strictObject({
        cards: z
            .array(z.strictObject({ licenceId: z.uuid(), cardKey }))
            .min(1)
            .max(500)
            .refine(
                (cards) => new Set(cards.map((c) => c.licenceId)).size === cards.length,
                'a licence is listed twice'
            )
            .optional(),
        firstCardKey: cardKey.optional(),
        spoiled: z
            .array(z.strictObject({ cardKey, reason: z.string().trim().min(3).max(200) }))
            .max(100)
            .optional()
    })
    .refine((v) => (v.cards === undefined) !== (v.firstCardKey === undefined), {
        path: ['firstCardKey'],
        message: 'name the cards, or the first card'
    });
export type PrintBatchPrinted = z.infer<typeof printBatchPrintedSchema>;
export const printBatchListSchema = z.object({ items: z.array(printBatchSchema) });

/** A step's answers when an examiner records a result. */
export const examAnswersSchema = z.object({
    heldOn: z.iso.date(),
    /** none: not part of this exam, as a late renewal has only the practical */
    theory: z.number().int().min(0).max(100).nullable().optional(),
    practical: z.number().int().min(0).max(100).nullable().optional(),
    /** a box left unticked may not be sent at all */
    passed: z.boolean().default(false)
});
