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
 *   vehicle_imports        a sheet of paper vehicle files brought in by a clerk (task 1.13b, ADR-0054), class T at the importing
 *                          office: the file (field-encrypted, cleared once read), its scans and its state.
 *   vehicle_import_rows    each row of it: its facts, its errors, its scan and, once committed, the vehicle it made, class T.
 *   migration_sample_counters   where each clerk's draw of sampling QA stands at an office (task 1.13g), class T.
 *   migration_samples      a migrated vehicle drawn for a re-check against its scan, and the re-check, class T at the capturing
 *                          office.
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
import { bytea, orgUnits } from '@itrms/kernel/tables';
import type { I18nText } from '@itrms/schemas';

import {
    BATCH_STATUSES,
    BOLO_STATUSES,
    ENROLMENT_STATUSES,
    GRADE_FAMILIES,
    IMPORT_FAILURES,
    IMPORT_FORMATS,
    IMPORT_ROW_STATES,
    IMPORT_STATES,
    LICENCE_KINDS,
    LICENCE_STATUSES,
    SAMPLE_FIELDS,
    SAMPLE_OUTCOMES,
    SAMPLE_SOURCES,
    SAMPLE_STATES,
    type ImportRowError
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

/**
 * A sheet of paper vehicle files (task 1.13b, ADR-0054). The file itself is kept field-encrypted only until the worker has read it
 * into rows (owners' phones and FINs are in it), then cleared. The roles are the ones its maker and its committer held when they
 * asked: the worker acts with those it still finds them holding.
 */
export const vehicleImports = withRls(
    audited(
        competencySchema.table(
            'vehicle_imports',
            {
                ...baseColumns(),
                ...handled(),
                /** the name the person gave the file: shown, never a key (SEC-IN-9) */
                filename: text('filename').notNull(),
                format: text('format', { enum: IMPORT_FORMATS }).notNull(),
                state: text('state', { enum: IMPORT_STATES }).notNull().default('checking'),
                failureCode: text('failure_code', { enum: IMPORT_FAILURES }),
                /** the template's columns a sheet lacked (failure `missing_columns`) */
                failureColumns: jsonb('failure_columns').$type<string[]>().notNull().default([]),
                /** the file as sent (CSV text, a workbook in base64), encrypted with the region's data key; null once read */
                contentCt: bytea('content_ct'),
                /** the scans sent with it, linked to it so they are kept */
                scanFileIds: jsonb('scan_file_ids').$type<string[]>().notNull().default([]),
                /** the language its maker used: the rows' error messages are in it */
                language: text('language').notNull(),
                roles: text('roles').array().notNull(),
                committedBy: uuid('committed_by'),
                /** the office the committer acted from: the importing office or one above it */
                commitUnitId: uuid('commit_unit_id').references(() => orgUnits.id),
                commitRoles: text('commit_roles').array(),
                committedAt: timestamp('committed_at', { withTimezone: true }),
                checkedAt: timestamp('checked_at', { withTimezone: true }),
                /**
                 * kernel.outbox_events: the commit's job (task 1.13g). A commit whose job is dead may be given back to checked;
                 * one whose job is still alive may not.
                 */
                commitEventId: uuid('commit_event_id')
            },
            (t) => [
                index('vehicle_imports_unit_idx').on(t.handlingUnitId, t.createdAt),
                index('vehicle_imports_org_path_gist').using('gist', t.orgPath),
                check(
                    'vehicle_imports_state_check',
                    sql`(state = 'failed') = (failure_code IS NOT NULL)
                        AND (state IN ('committing', 'committed')) = (committed_by IS NOT NULL)
                        AND (committed_by IS NULL) = (committed_at IS NULL)
                        AND (committed_by IS NULL) = (commit_unit_id IS NULL)
                        AND (committed_by IS NULL OR committed_by IS DISTINCT FROM created_by)
                        AND jsonb_array_length(scan_file_ids) <= 2000`
                ),
                check(
                    'vehicle_imports_commit_event_check',
                    sql`commit_event_id IS NULL OR state IN ('committing', 'committed')`
                )
            ]
        ),
        { omit: ['contentCt'] }
    ),
    'transaction'
);

/**
 * A row of a sheet. Its facts (`values`) are the capture's answers as MIG-01 takes them; the owner's phone and FIN are apart,
 * field-encrypted (`sensitive_ct`). `owner_key` (a blind index) makes the rows of one owner one person. The vehicle a committed row
 * made points back at it (vehicles.migration_import_row_id).
 */
export const vehicleImportRows = withRls(
    audited(
        competencySchema.table(
            'vehicle_import_rows',
            {
                ...baseColumns(),
                ...handled(),
                importId: uuid('import_id')
                    .notNull()
                    .references(() => vehicleImports.id),
                line: integer('line').notNull(),
                state: text('state', { enum: IMPORT_ROW_STATES }).notNull(),
                paperReference: text('paper_reference'),
                values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
                sensitiveCt: bytea('sensitive_ct'),
                errors: jsonb('errors').$type<ImportRowError[]>().notNull().default([]),
                vinKey: text('vin_key'),
                plateKey: text('plate_key'),
                ownerKey: bytea('owner_key'),
                scanFileId: uuid('scan_file_id'),
                /** the person the commit made or found for the owner */
                ownerPersonId: uuid('owner_person_id'),
                vehicleId: uuid('vehicle_id')
            },
            (t) => [
                uniqueIndex('vehicle_import_rows_line_uq').on(t.importId, t.line),
                index('vehicle_import_rows_state_idx').on(t.importId, t.state, t.line),
                index('vehicle_import_rows_owner_idx')
                    .on(t.importId, t.ownerKey)
                    .where(sql`owner_key IS NOT NULL`),
                index('vehicle_import_rows_org_path_gist').using('gist', t.orgPath),
                check(
                    'vehicle_import_rows_state_check',
                    sql`line >= 2 AND (state IN ('imported', 'already_imported')) = (vehicle_id IS NOT NULL)
                        AND (state <> 'invalid' OR jsonb_array_length(errors) > 0)
                        AND (state = 'invalid' OR jsonb_array_length(errors) = 0)`
                )
            ]
        ),
        { omit: ['sensitiveCt', 'ownerKey'] }
    ),
    'transaction'
);

/**
 * Where a clerk's draw stands at an office (task 1.13g): their migrated records so far, those drawn, and the block the next is
 * drawn from (sampling.ts). The block's drawn places and where in it the clerk stands never enter the audit log, so the draw cannot
 * be read ahead.
 */
export const migrationSampleCounters = withRls(
    audited(
        competencySchema.table(
            'migration_sample_counters',
            {
                ...baseColumns(),
                ...handled(),
                clerkId: uuid('clerk_id').notNull(),
                records: integer('records').notNull().default(0),
                drawn: integer('drawn').notNull().default(0),
                share: integer('share').notNull(),
                blockSize: integer('block_size').notNull(),
                blockPosition: integer('block_position').notNull().default(0),
                blockPicks: integer('block_picks')
                    .array()
                    .notNull()
                    .default(sql`'{}'::integer[]`)
            },
            (t) => [
                uniqueIndex('migration_sample_counters_clerk_uq').on(t.handlingUnitId, t.clerkId),
                index('migration_sample_counters_org_path_gist').using('gist', t.orgPath),
                check(
                    'migration_sample_counters_check',
                    sql`share BETWEEN 0 AND 100 AND block_size BETWEEN 1 AND 100
                        AND block_position BETWEEN 0 AND block_size AND cardinality(block_picks) <= block_size
                        AND drawn BETWEEN 0 AND records`
                )
            ]
        ),
        { omit: ['blockPicks', 'blockPosition'] }
    ),
    'transaction'
);

/**
 * A migrated vehicle drawn for a re-check (task 1.13g): who captured it (the clerk), who verified it, its scan, and the re-check
 * by a third person: correct, or the facts found wrong. The foreign keys to the vehicle, the case and the scan are in the
 * migration.
 */
export const migrationSamples = withRls(
    audited(
        competencySchema.table(
            'migration_samples',
            {
                ...baseColumns(),
                ...handled(),
                vehicleId: uuid('vehicle_id').notNull(),
                source: text('source', { enum: SAMPLE_SOURCES }).notNull(),
                caseId: uuid('case_id'),
                importRowId: uuid('import_row_id').references(() => vehicleImportRows.id),
                clerkId: uuid('clerk_id').notNull(),
                verifierId: uuid('verifier_id').notNull(),
                scanFileId: uuid('scan_file_id'),
                /** the share in force when it was drawn */
                share: integer('share').notNull(),
                state: text('state', { enum: SAMPLE_STATES }).notNull().default('drawn'),
                outcome: text('outcome', { enum: SAMPLE_OUTCOMES }),
                errorFields: text('error_fields', { enum: SAMPLE_FIELDS })
                    .array()
                    .notNull()
                    .default(sql`'{}'::text[]`),
                note: text('note'),
                recheckedBy: uuid('rechecked_by'),
                recheckedAt: timestamp('rechecked_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('migration_samples_vehicle_uq').on(t.vehicleId),
                index('migration_samples_queue_idx').on(t.handlingUnitId, t.state, t.createdAt),
                index('migration_samples_clerk_idx').on(t.clerkId, t.handlingUnitId),
                index('migration_samples_org_path_gist').using('gist', t.orgPath),
                check(
                    'migration_samples_check',
                    sql`(source = 'back_capture') = (case_id IS NOT NULL) AND (source = 'import') = (import_row_id IS NOT NULL)
                        AND clerk_id <> verifier_id AND share BETWEEN 1 AND 100
                        AND (state = 'rechecked') = (rechecked_by IS NOT NULL)
                        AND (rechecked_by IS NULL) = (rechecked_at IS NULL)
                        AND (rechecked_by IS NULL) = (outcome IS NULL)
                        AND rechecked_by IS DISTINCT FROM clerk_id AND rechecked_by IS DISTINCT FROM verifier_id
                        AND (outcome IS NOT DISTINCT FROM 'errors') = (cardinality(error_fields) > 0)
                        AND cardinality(error_fields) <= 40
                        AND coalesce(length(note), 1) BETWEEN 1 AND 500 AND (note IS NULL OR state = 'rechecked')`
                )
            ]
        )
    ),
    'transaction'
);
