/**
 * The driver licence register and what it is made from (architecture.md §6, task 0.24a).
 *
 *   licence_grade_types    the catalogue of grades (Art. 12 of Proclamation 1074/2018): class C at the region's root.
 *   driver_licences        a person's licence, class R: the region reads it, the handling unit's subtree writes it.
 *   licence_grades         the grades a licence carries, class R, with the licence's handling unit.
 *   medical_certificates   the medical examination a case relied on, class T.
 *   training_enrolments    a school's list of who finished training, entered by the handling unit, class T.
 *   exam_sessions, exam_results   what an examiner recorded, class T.
 *   licence_print_batches  what goes to the region's printer, class T, with its licences.
 *   bolos                  a vehicle's bolo from its passed inspection (task 1.3a), class R like a licence.
 *   bolo_inspections       the inspection register (task 1.3b): every inspection of a case, passed or failed, and the garage
 *                          that repaired the vehicle before it, class T.
 *
 * A licence's number is null until the national platform accepts it: `pending_national` is not yet anyone's licence.
 * The foreign keys to the register of people are in the migration: this file is read by drizzle-kit, which can't load another slice's
 * NestJS entry.
 */
import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    timestamp,
    uniqueIndex,
    uuid
} from 'drizzle-orm/pg-core';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import { orgUnits } from '@itrms/kernel/tables';
import type { I18nText } from '@itrms/schemas';

import {
    BATCH_STATUSES,
    BOLO_STATUSES,
    ENROLMENT_STATUSES,
    GRADE_FAMILIES,
    LICENCE_KINDS,
    LICENCE_STATUSES
} from '../contracts';

export const competencySchema = pgSchema('competency');

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

const handled = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    orgPath: ltree('org_path').notNull().default('')
});

const registry = () => ({
    regionId: uuid('region_id').notNull(),
    handlingUnitId: uuid('handling_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the handling unit */
    handlingOrgPath: ltree('handling_org_path').notNull().default('')
});

export const licenceGradeTypes = withRls(
    audited(
        competencySchema.table(
            'licence_grade_types',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                name: jsonb('name').$type<I18nText>().notNull(),
                family: text('family', { enum: GRADE_FAMILIES }).notNull(),
                minAge: integer('min_age'),
                minEducation: integer('min_education').notNull(),
                /** any one of these keys, held permanently for `prerequisite_months` */
                prerequisites: jsonb('prerequisites').$type<string[]>().notNull().default([]),
                prerequisiteMonths: integer('prerequisite_months').notNull().default(0),
                active: boolean('active').notNull().default(true)
            },
            (t) => [
                uniqueIndex('licence_grade_types_key_uq').on(t.regionId, t.key),
                index('licence_grade_types_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const driverLicences = withRls(
    audited(
        competencySchema.table(
            'driver_licences',
            {
                ...baseColumns(),
                ...registry(),
                personId: uuid('person_id').notNull(),
                /** the national platform's number once it issues them; the region's counter until then */
                number: text('number'),
                status: text('status', { enum: LICENCE_STATUSES }).notNull().default('pending_national'),
                kind: text('kind', { enum: LICENCE_KINDS }).notNull().default('temporary'),
                issuedOn: date('issued_on'),
                validUntil: date('valid_until'),
                /** the national platform's reference: its record, never a competing copy */
                nationalReference: text('national_reference'),
                /** the case that made it */
                caseId: uuid('case_id'),
                voidReason: text('void_reason')
            },
            (t) => [
                uniqueIndex('driver_licences_number_uq')
                    .on(t.regionId, t.number)
                    .where(sql`number IS NOT NULL`),
                // a case makes one licence at a time; one the national platform refused leaves room for the next attempt
                uniqueIndex('driver_licences_case_uq')
                    .on(t.caseId)
                    .where(sql`case_id IS NOT NULL AND status <> 'voided'`),
                index('driver_licences_person_idx').on(t.personId),
                index('driver_licences_valid_until_idx')
                    .on(t.validUntil)
                    .where(sql`status = 'active'`),
                index('driver_licences_handling_org_path_gist').using('gist', t.handlingOrgPath),
                check(
                    'driver_licences_active_check',
                    sql`status <> 'active' OR (number IS NOT NULL AND issued_on IS NOT NULL AND valid_until IS NOT NULL)`
                )
            ]
        )
    ),
    'registry'
);

export const licenceGrades = withRls(
    audited(
        competencySchema.table(
            'licence_grades',
            {
                ...baseColumns(),
                ...registry(),
                licenceId: uuid('licence_id')
                    .notNull()
                    .references(() => driverLicences.id),
                gradeTypeId: uuid('grade_type_id')
                    .notNull()
                    .references(() => licenceGradeTypes.id),
                /** none while the licence is temporary */
                permanentSince: date('permanent_since')
            },
            (t) => [
                uniqueIndex('licence_grades_uq').on(t.licenceId, t.gradeTypeId),
                index('licence_grades_handling_org_path_gist').using('gist', t.handlingOrgPath)
            ]
        )
    ),
    'registry'
);

export const medicalCertificates = withRls(
    audited(
        competencySchema.table(
            'medical_certificates',
            {
                ...baseColumns(),
                ...handled(),
                personId: uuid('person_id').notNull(),
                caseId: uuid('case_id').notNull(),
                facility: text('facility').notNull(),
                examinedOn: date('examined_on').notNull()
            },
            (t) => [
                // a corrected request changes the certificate it relied on
                uniqueIndex('medical_certificates_case_uq').on(t.caseId),
                index('medical_certificates_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        // what a person's health was checked for is theirs: the log says that it changed, not to what
        { omit: ['facility'] }
    ),
    'transaction'
);

export const trainingEnrolments = withRls(
    audited(
        competencySchema.table(
            'training_enrolments',
            {
                ...baseColumns(),
                ...handled(),
                personId: uuid('person_id').notNull(),
                schoolId: uuid('school_id').notNull(),
                gradeTypeId: uuid('grade_type_id')
                    .notNull()
                    .references(() => licenceGradeTypes.id),
                status: text('status', { enum: ENROLMENT_STATUSES }).notNull().default('enrolled'),
                completedOn: date('completed_on')
            },
            (t) => [
                uniqueIndex('training_enrolments_uq').on(t.personId, t.schoolId, t.gradeTypeId),
                index('training_enrolments_school_idx').on(t.schoolId),
                index('training_enrolments_org_path_gist').using('gist', t.orgPath),
                check('training_enrolments_completed_check', sql`(status = 'completed') = (completed_on IS NOT NULL)`)
            ]
        )
    ),
    'transaction'
);

export const examSessions = withRls(
    audited(
        competencySchema.table(
            'exam_sessions',
            {
                ...baseColumns(),
                ...handled(),
                heldOn: date('held_on').notNull()
            },
            (t) => [
                uniqueIndex('exam_sessions_uq').on(t.handlingUnitId, t.heldOn),
                index('exam_sessions_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const examResults = withRls(
    audited(
        competencySchema.table(
            'exam_results',
            {
                ...baseColumns(),
                ...handled(),
                sessionId: uuid('session_id')
                    .notNull()
                    .references(() => examSessions.id),
                caseId: uuid('case_id').notNull(),
                personId: uuid('person_id').notNull(),
                attempt: integer('attempt').notNull(),
                theory: integer('theory'),
                practical: integer('practical'),
                passed: boolean('passed').notNull()
            },
            (t) => [
                uniqueIndex('exam_results_attempt_uq').on(t.caseId, t.attempt),
                index('exam_results_session_idx').on(t.sessionId),
                index('exam_results_org_path_gist').using('gist', t.orgPath),
                check(
                    'exam_results_scores_check',
                    sql`coalesce(theory, 0) BETWEEN 0 AND 100 AND coalesce(practical, 0) BETWEEN 0 AND 100`
                )
            ]
        )
    ),
    'transaction'
);

export const licencePrintBatches = withRls(
    audited(
        competencySchema.table(
            'licence_print_batches',
            {
                ...baseColumns(),
                ...handled(),
                status: text('status', { enum: BATCH_STATUSES }).notNull().default('open'),
                nationalReference: text('national_reference')
            },
            (t) => [
                // one being filled per office
                uniqueIndex('licence_print_batches_open_uq')
                    .on(t.handlingUnitId)
                    .where(sql`status = 'open'`),
                index('licence_print_batches_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const licencePrintBatchItems = withRls(
    audited(
        competencySchema.table(
            'licence_print_batch_items',
            {
                ...baseColumns(),
                ...handled(),
                batchId: uuid('batch_id')
                    .notNull()
                    .references(() => licencePrintBatches.id),
                licenceId: uuid('licence_id')
                    .notNull()
                    .references(() => driverLicences.id),
                /** the card blank it was printed on (task 1.12a): its serial and the stationery item it used */
                cardKey: text('card_key'),
                stationeryItemId: uuid('stationery_item_id')
            },
            (t) => [
                uniqueIndex('licence_print_batch_items_uq').on(t.batchId, t.licenceId),
                index('licence_print_batch_items_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

/**
 * A vehicle's bolo (task 1.3a, DVC-02), class R like a licence: any office of the region reads it (a checkpoint, a transfer),
 * the handling office's subtree writes it. One per case: the passed inspection makes it; its sticker or temporary
 * certificate follows. The vehicle's foreign key is in the migration (another slice's table).
 */
export const bolos = withRls(
    audited(
        competencySchema.table(
            'bolos',
            {
                ...baseColumns(),
                ...registry(),
                vehicleId: uuid('vehicle_id').notNull(),
                caseId: uuid('case_id').notNull(),
                status: text('status', { enum: BOLO_STATUSES }).notNull().default('awaiting_sticker'),
                /** the vehicle's use when inspected: its sticker is of this kind */
                use: text('use').notNull(),
                /** the serial printed on the bureau's checklist sheet */
                checklistSerial: text('checklist_serial').notNull(),
                inspectedOn: date('inspected_on').notNull(),
                /** the Ethiopian fiscal year it stands for, and its last day */
                fiscalYear: integer('fiscal_year').notNull(),
                validUntil: date('valid_until').notNull(),
                /** the third-party insurance certificate it was given on (Proclamation 799/2013) */
                insuranceCertificate: text('insurance_certificate').notNull(),
                insurer: text('insurer').notNull(),
                insuredFrom: date('insured_from').notNull(),
                insuredUntil: date('insured_until').notNull(),
                /** the sticker's serial from the office's stationery, once given */
                stickerKey: text('sticker_key'),
                /** the last day a temporary bolo stands */
                temporaryUntil: date('temporary_until'),
                voidReason: text('void_reason'),
                /** when its owners were reminded of its last day (task 1.3b): once */
                remindedAt: timestamp('reminded_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('bolos_case_uq')
                    .on(t.caseId)
                    .where(sql`status <> 'void'`),
                uniqueIndex('bolos_sticker_uq')
                    .on(t.regionId, t.stickerKey)
                    .where(sql`sticker_key IS NOT NULL`),
                index('bolos_vehicle_idx').on(t.vehicleId, t.validUntil),
                index('bolos_handling_org_path_gist').using('gist', t.handlingOrgPath),
                check(
                    'bolos_status_check',
                    sql`(status <> 'valid' OR sticker_key IS NOT NULL) AND (status <> 'temporary' OR temporary_until IS NOT NULL) AND (status <> 'void' OR void_reason IS NOT NULL)`
                ),
                check('bolos_dates_check', sql`valid_until >= inspected_on AND insured_until >= insured_from`)
            ]
        )
    ),
    'registry'
);

/** A failed item of an inspection: its key, as the checklist names it, and the inspector's remark. */
export type FailedItem = { key: string; remark?: string };

/**
 * The inspection register (task 1.3b): one row per inspection of a case, the first and each one after a garage repair. Written
 * once by the inspection's step; the bolo a pass makes is in `bolos`. The garage and the vehicle's foreign keys are in the
 * migration (another slice's tables).
 */
export const boloInspections = withRls(
    audited(
        competencySchema.table(
            'bolo_inspections',
            {
                ...baseColumns(),
                ...handled(),
                caseId: uuid('case_id').notNull(),
                vehicleId: uuid('vehicle_id').notNull(),
                /** 1 for the first inspection, then one more for each after a repair */
                attempt: integer('attempt').notNull(),
                checklistSerial: text('checklist_serial').notNull(),
                inspectedOn: date('inspected_on').notNull(),
                passed: boolean('passed').notNull(),
                failedItems: jsonb('failed_items').$type<FailedItem[]>().notNull().default([]),
                /** the garage that repaired the vehicle before this inspection (none for the first) */
                garageId: uuid('garage_id'),
                repairedOn: date('repaired_on'),
                repairNote: text('repair_note')
            },
            (t) => [
                uniqueIndex('bolo_inspections_attempt_uq').on(t.caseId, t.attempt),
                index('bolo_inspections_vehicle_idx').on(t.vehicleId, t.inspectedOn),
                index('bolo_inspections_garage_idx')
                    .on(t.garageId)
                    .where(sql`garage_id IS NOT NULL`),
                index('bolo_inspections_org_path_gist').using('gist', t.orgPath),
                check('bolo_inspections_attempt_check', sql`attempt >= 1 AND (attempt = 1) = (garage_id IS NULL)`)
            ]
        )
    ),
    'transaction'
);
