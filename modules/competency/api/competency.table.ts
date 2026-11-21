/**
 * The driver licence register and what it is made from (architecture.md §6, task 0.24a).
 *
 *   licence_grade_types    the catalogue of grades (Art. 12 of Proclamation 1074/2018): class C at the region's root.
 *   driver_licences        a person's licence, class R: the region reads it, the handling unit's subtree writes it.
 *   licence_grades         the grades a licence carries, class R, with the licence's handling unit.
 *   licence_health         a licence's blood group (task 1.6, ADR-0052), class R, field-encrypted; read only through reveal.
 *   licence_restrictions   a suspension or cancellation recorded from the deciding authority (DVC-21, task 1.6c), class R.
 *   medical_certificates   the medical examination a case relied on, class T; a renewal's reports (task 1.6a) with their
 *                          recommendation and the conditions, field-encrypted.
 *   licence_number_flags   a printed number a paper licence's capture could not keep (task 1.6b), class T, for the bureau.
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
 *   migration_paper_counts the zone's count of paper files for an office and plate code (task 1.13h), class T at the office.
 *   ownership_transfers    an ownership transfer's valuation, letters, papers and result (task 1.4b), class T at the handling office.
 *   replacements           a replacement of a lost, stolen or damaged libre, bolo sticker or plate (task 1.5), class T at the handling office.
 *   campaigns              a unit's campaign over a span of days (task 1.13i), class C: the running unit and the units above it
 *                          write it and the offices below it read it, as they must to see what targets them.
 *   campaign_targets       an office's target in a campaign, class T at the office; set by a unit above it.
 *
 * A licence's number is null until the national platform accepts it: `pending_national` is not yet anyone's licence.
 * The foreign keys to the register of people are in the migration: this file is read by drizzle-kit, which can't load another slice's
 * NestJS entry.
 */
import { sql } from 'drizzle-orm';
import {
    bigint,
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    numeric,
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
    CAMPAIGN_KINDS,
    ENROLMENT_STATUSES,
    GRADE_FAMILIES,
    IMPORT_FAILURES,
    IMPORT_FORMATS,
    IMPORT_ROW_STATES,
    IMPORT_STATES,
    LICENCE_KINDS,
    LICENCE_STATUSES,
    PAPER_PLATE_CODES,
    REPLACEMENT_ITEMS,
    REPLACEMENT_REASONS,
    RESTRICTION_AUTHORITIES,
    RESTRICTION_KINDS,
    SAMPLE_FIELDS,
    SAMPLE_OUTCOMES,
    SAMPLE_SOURCES,
    SAMPLE_STATES,
    TRANSFER_ACQUIRED_BY,
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
                /** the serial printed on its card (task 1.6): set when a printed batch comes back, unique in the region */
                cardSerial: text('card_serial'),
                /** the case that made it */
                caseId: uuid('case_id'),
                voidReason: text('void_reason'),
                /**
                 * A licence captured from its paper file (MIG-02, ADR-0054, task 1.6b): how it came, the paper file's reference,
                 * who issued it on paper, the capture's case and the second person who verified it.
                 */
                migrationSource: text('migration_source', { enum: ['back_capture'] }),
                paperReference: text('paper_reference'),
                issuedBy: text('issued_by'),
                migrationCaseId: uuid('migration_case_id'),
                migrationVerifiedBy: uuid('migration_verified_by'),
                migrationVerifiedAt: timestamp('migration_verified_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('driver_licences_number_uq')
                    .on(t.regionId, t.number)
                    .where(sql`number IS NOT NULL`),
                // a case makes one licence at a time; one the national platform refused leaves room for the next attempt
                uniqueIndex('driver_licences_card_serial_uq')
                    .on(t.regionId, t.cardSerial)
                    .where(sql`card_serial IS NOT NULL`),
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
                ),
                // one capture makes one licence, and a migrated licence says where it came from and who verified it
                uniqueIndex('driver_licences_migration_case_uq')
                    .on(t.migrationCaseId)
                    .where(sql`migration_case_id IS NOT NULL`),
                check(
                    'driver_licences_migration_check',
                    sql`migration_source IS NULL OR (paper_reference IS NOT NULL AND migration_case_id IS NOT NULL AND migration_verified_by IS NOT NULL AND migration_verified_at IS NOT NULL)`
                )
            ]
        )
    ),
    'registry'
);

/**
 * A licence's health facts (task 1.6, ADR-0052), class R like its licence: one row per licence, the blood group encrypted with
 * the region's data key and bound to its row. Read in clear only through the audited reveal; the audit log never holds it.
 */
export const licenceHealth = withRls(
    audited(
        competencySchema.table(
            'licence_health',
            {
                ...baseColumns(),
                ...registry(),
                licenceId: uuid('licence_id')
                    .notNull()
                    .references(() => driverLicences.id),
                bloodGroupCt: bytea('blood_group_ct').notNull()
            },
            (t) => [
                uniqueIndex('licence_health_licence_uq').on(t.licenceId),
                index('licence_health_handling_org_path_gist').using('gist', t.handlingOrgPath)
            ]
        ),
        { omit: ['bloodGroupCt'] }
    ),
    'registry'
);

/**
 * A suspension or cancellation recorded on a licence from the deciding authority's decision (DVC-21, task 1.6c, ADR-0064 §6), class R
 * like its licence and with its handling unit: the region reads it (it blocks the licence's services anywhere), the licence office's
 * subtree records it. Inserted once, by the step a second person takes; never changed or deleted by the API.
 */
export const licenceRestrictions = withRls(
    audited(
        competencySchema.table(
            'licence_restrictions',
            {
                ...baseColumns(),
                ...registry(),
                licenceId: uuid('licence_id')
                    .notNull()
                    .references(() => driverLicences.id),
                /** the DVC-21 case that recorded it */
                caseId: uuid('case_id').notNull(),
                kind: text('kind', { enum: RESTRICTION_KINDS }).notNull(),
                authority: text('authority', { enum: RESTRICTION_AUTHORITIES }).notNull(),
                authorityReference: text('authority_reference').notNull(),
                decidedOn: date('decided_on').notNull(),
                startsOn: date('starts_on').notNull(),
                /** a suspension's last day; a cancellation has none */
                endsOn: date('ends_on'),
                /** the second person, who approved the record against the decision */
                approvedBy: uuid('approved_by').notNull(),
                approvedAt: timestamp('approved_at', { withTimezone: true }).notNull()
            },
            (t) => [
                uniqueIndex('licence_restrictions_case_uq').on(t.caseId),
                index('licence_restrictions_licence_idx').on(t.licenceId, t.startsOn),
                index('licence_restrictions_handling_org_path_gist').using('gist', t.handlingOrgPath),
                check('licence_restrictions_kind_check', sql`kind in ('suspension', 'cancellation')`),
                check(
                    'licence_restrictions_authority_check',
                    sql`authority in ('court', 'traffic_police', 'penalty_system', 'licensing_body')`
                ),
                // a suspension runs to a last day on or after its first; a cancellation does not end
                check(
                    'licence_restrictions_period_check',
                    sql`(kind = 'suspension') = (ends_on IS NOT NULL) AND (ends_on IS NULL OR ends_on >= starts_on) AND starts_on >= decided_on`
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
                examinedOn: date('examined_on').notNull(),
                // a renewal's report from the health bureau's form (task 1.6a): the first, second or third institution (Art. 13)
                sequence: integer('sequence').notNull().default(1),
                reportNumber: text('report_number'),
                // null on a certificate filed with the request (DVC-03, DVC-04 v1): no recommendation was typed
                recommendation: text('recommendation'),
                // a health fact (ADR-0064 §4): field-encrypted, recorded by a command, read only through the audited reveal
                conditionsCt: bytea('conditions_ct')
            },
            (t) => [
                // a corrected request changes the certificate it relied on; a refused report is followed by the next institution's
                uniqueIndex('medical_certificates_case_sequence_uq').on(t.caseId, t.sequence),
                index('medical_certificates_org_path_gist').using('gist', t.orgPath),
                // three reports (Art. 13), after the certificate a request may have carried (a version 1 form under version 2)
                check('medical_certificates_sequence_check', sql`sequence between 1 and 4`),
                check(
                    'medical_certificates_recommendation_check',
                    sql`recommendation is null or recommendation in ('grant', 'grant_with_conditions', 'refuse')`
                ),
                check(
                    'medical_certificates_conditions_check',
                    sql`conditions_ct is null or (recommendation = 'grant_with_conditions' and octet_length(conditions_ct) > 16)`
                )
            ]
        ),
        // what a person's health was checked for, and what the facility found, are theirs: the log says that they changed, not
        // to what (SEC-PD-2)
        { omit: ['facility', 'recommendation', 'conditionsCt'] }
    ),
    'transaction'
);

/**
 * A printed number a paper licence's capture could not keep (MIG-02, ADR-0051 §4, task 1.6b): inside the range the region reserved
 * for ITRMS, or carried by another licence of the region. Flagged to the bureau, never renumbered; class T at the capturing office,
 * so the offices above it read it.
 */
export const licenceNumberFlags = withRls(
    audited(
        competencySchema.table(
            'licence_number_flags',
            {
                ...baseColumns(),
                ...handled(),
                caseId: uuid('case_id').notNull(),
                number: text('number').notNull(),
                reason: text('reason', { enum: ['in_regional_range', 'number_taken'] }).notNull(),
                paperReference: text('paper_reference').notNull(),
                note: text('note')
            },
            (t) => [
                uniqueIndex('licence_number_flags_case_uq').on(t.caseId),
                index('licence_number_flags_org_path_gist').using('gist', t.orgPath),
                index('licence_number_flags_number_idx').on(t.regionId, t.number)
            ]
        )
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
                // the campaign counters' day predicate (task 1.13i)
                index('bolos_inspected_on_idx').on(t.inspectedOn),
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

/**
 * An ownership transfer of a case (task 1.4b, DVC-13), one row a case: the committee's valuation, the day the letters went out,
 * the papers that came back and, once the owners changed in the register, what that made. Class T at the handling office: the
 * region reads the vehicle and its owners (the registry's), not the case's working. Money is whole santim, kept as the committee
 * set it; ITRMS works out no duty from it. The foreign keys to the case and to the register's tables are in the migration.
 */
export const ownershipTransfers = withRls(
    audited(
        competencySchema.table(
            'ownership_transfers',
            {
                ...baseColumns(),
                ...registry(),
                caseId: uuid('case_id').notNull(),
                vehicleId: uuid('vehicle_id').notNull(),
                /** the period the request saw as open: the sellers' */
                sellerOwnershipId: uuid('seller_ownership_id').notNull(),
                acquiredBy: text('acquired_by', { enum: TRANSFER_ACQUIRED_BY }).notNull(),
                /** a code-3 vehicle (commercial service): its buyers register with the tax office */
                code3: boolean('code3').notNull().default(false),
                valuedOn: date('valued_on'),
                valuedBy: uuid('valued_by'),
                inspectionNote: text('inspection_note'),
                purchasePriceSantim: bigint('purchase_price_santim', { mode: 'bigint' }),
                depreciationPercent: numeric('depreciation_percent', { precision: 5, scale: 2 }),
                marketValueSantim: bigint('market_value_santim', { mode: 'bigint' }),
                committeeValueSantim: bigint('committee_value_santim', { mode: 'bigint' }),
                contractValueSantim: bigint('contract_value_santim', { mode: 'bigint' }),
                valuers: text('valuers'),
                lettersIssuedOn: date('letters_issued_on'),
                contractReference: text('contract_reference'),
                contractAuthenticatedOn: date('contract_authenticated_on'),
                stampDutyReceipt: text('stamp_duty_receipt'),
                stampDutyPaidOn: date('stamp_duty_paid_on'),
                taxRegistrationReference: text('tax_registration_reference'),
                courtReference: text('court_reference'),
                evidenceRecordedBy: uuid('evidence_recorded_by'),
                evidenceRecordedAt: timestamp('evidence_recorded_at', { withTimezone: true }),
                /** what the transfer made: the buyers' ownership period, the libre it cancelled and the one it issued */
                buyerOwnershipId: uuid('buyer_ownership_id'),
                cancelledLibreId: uuid('cancelled_libre_id'),
                newLibreId: uuid('new_libre_id'),
                transferredOn: date('transferred_on'),
                transferredBy: uuid('transferred_by')
            },
            (t) => [
                uniqueIndex('ownership_transfers_case_uq').on(t.caseId),
                index('ownership_transfers_vehicle_idx').on(t.vehicleId),
                index('ownership_transfers_handling_org_path_gist').using('gist', t.handlingOrgPath),
                check(
                    'ownership_transfers_amounts_check',
                    sql`coalesce(purchase_price_santim, 1) > 0 and coalesce(market_value_santim, 1) > 0
                        and coalesce(committee_value_santim, 1) > 0 and coalesce(contract_value_santim, 1) > 0
                        and coalesce(depreciation_percent, 0) between 0 and 100`
                ),
                check(
                    'ownership_transfers_text_check',
                    sql`coalesce(length(inspection_note), 1) between 1 and 500 and coalesce(length(valuers), 1) between 1 and 200
                        and coalesce(length(contract_reference), 1) between 1 and 60
                        and coalesce(length(stamp_duty_receipt), 1) between 1 and 60
                        and coalesce(length(tax_registration_reference), 1) between 1 and 60
                        and coalesce(length(court_reference), 1) between 1 and 60`
                ),
                check(
                    'ownership_transfers_result_check',
                    sql`(buyer_ownership_id is null) = (transferred_on is null) and (transferred_on is null) = (transferred_by is null)`
                ),
                check(
                    'ownership_transfers_evidence_check',
                    sql`(evidence_recorded_by is null) = (evidence_recorded_at is null)`
                )
            ]
        )
    ),
    'transaction',
    'handling_org_path'
);

/**
 * A replacement of a lost, stolen or damaged libre, bolo sticker or plate (task 1.5, DVC-06, ADR-0062), one row a case: the police
 * letter and newspaper notice the request relied on and, once the register changed, what it made. Class T at the handling office.
 * The bolo and plate columns are for tasks 1.5b and 1.5c. The foreign keys to the case and to the register's tables are in the
 * migration.
 */
export const replacements = withRls(
    audited(
        competencySchema.table(
            'replacements',
            {
                ...baseColumns(),
                ...registry(),
                caseId: uuid('case_id').notNull(),
                vehicleId: uuid('vehicle_id').notNull(),
                item: text('item', { enum: REPLACEMENT_ITEMS }).notNull(),
                reason: text('reason', { enum: REPLACEMENT_REASONS }).notNull(),
                policeReportReference: text('police_report_reference'),
                policeReportOn: date('police_report_on'),
                noticeNewspaper: text('notice_newspaper'),
                noticePublishedOn: date('notice_published_on'),
                /** the first day the libre may be replaced, as the setting stood when the case moved on */
                noticeEndsOn: date('notice_ends_on'),
                oldLibreId: uuid('old_libre_id'),
                newLibreId: uuid('new_libre_id'),
                boloId: uuid('bolo_id'),
                oldStickerKey: text('old_sticker_key'),
                newStickerKey: text('new_sticker_key'),
                oldPlateAssignmentId: uuid('old_plate_assignment_id'),
                newPlateAssignmentId: uuid('new_plate_assignment_id'),
                replacedOn: date('replaced_on'),
                replacedBy: uuid('replaced_by')
            },
            (t) => [
                uniqueIndex('replacements_case_uq').on(t.caseId),
                index('replacements_vehicle_idx').on(t.vehicleId),
                index('replacements_handling_org_path_gist').using('gist', t.handlingOrgPath),
                check('replacements_item_check', sql`item in ('libre', 'bolo', 'plate')`),
                check('replacements_reason_check', sql`reason in ('lost', 'stolen', 'damaged')`),
                check(
                    'replacements_police_check',
                    sql`reason = 'damaged' or (police_report_reference is not null and police_report_on is not null)`
                ),
                check(
                    'replacements_notice_check',
                    sql`item <> 'libre' or reason = 'damaged' or notice_published_on is not null`
                ),
                check('replacements_result_check', sql`(replaced_on is null) = (replaced_by is null)`)
            ]
        )
    ),
    'transaction',
    'handling_org_path'
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
                /** every page of the scan, in order; the first is `scan_file_id` */
                scanFileIds: uuid('scan_file_ids')
                    .array()
                    .notNull()
                    .default(sql`'{}'::uuid[]`),
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
                ),
                check(
                    'migration_samples_scans_check',
                    sql`(scan_file_id IS NULL) = (cardinality(scan_file_ids) = 0)
                        AND (scan_file_id IS NULL OR scan_file_ids[1] = scan_file_id) AND cardinality(scan_file_ids) <= 20`
                )
            ]
        )
    ),
    'transaction'
);

/**
 * The zone's count of paper files on an office's shelves for one plate-code group (task 1.13h): the target the reconciliation report
 * measures the migrated vehicles against. The row belongs to the office counted (its subtree and the offices above it see it); the
 * unit that counted it is its own column. The list of codes and the bounds are checked in the migration.
 */
export const migrationPaperCounts = withRls(
    audited(
        competencySchema.table(
            'migration_paper_counts',
            {
                ...baseColumns(),
                ...handled(),
                plateCode: text('plate_code', { enum: PAPER_PLATE_CODES }).notNull(),
                count: integer('count').notNull(),
                countedOn: date('counted_on').notNull(),
                countedByUnitId: uuid('counted_by_unit_id')
                    .notNull()
                    .references(() => orgUnits.id)
            },
            (t) => [
                uniqueIndex('migration_paper_counts_uq').on(t.handlingUnitId, t.plateCode),
                index('migration_paper_counts_org_path_gist').using('gist', t.orgPath),
                check('migration_paper_counts_check', sql`count BETWEEN 0 AND 10000000`)
            ]
        )
    ),
    'transaction'
);

/**
 * A campaign a unit runs over a span of days (task 1.13i, ADR-0054 §2): the plate exchange, the bolo season. Class C (config): the
 * running unit and the units above it write it, and every office below reads it, which is how an office sees the campaign that
 * targets it. The length
 * and the bounds are checked in the migration.
 */
export const campaigns = withRls(
    audited(
        competencySchema.table(
            'campaigns',
            {
                ...baseColumns(),
                ...handled(),
                kind: text('kind', { enum: CAMPAIGN_KINDS }).notNull(),
                name: jsonb('name').$type<I18nText>().notNull(),
                startsOn: date('starts_on').notNull(),
                endsOn: date('ends_on').notNull(),
                closedAt: timestamp('closed_at', { withTimezone: true })
            },
            (t) => [
                index('campaigns_unit_kind_idx').on(t.handlingUnitId, t.kind),
                index('campaigns_org_path_gist').using('gist', t.orgPath),
                check('campaigns_dates_check', sql`ends_on >= starts_on AND ends_on - starts_on < 366`)
            ]
        )
    ),
    'config'
);

/**
 * An office's target in a campaign (task 1.13i): the row belongs to the office (its subtree and the units above it see it), and the
 * unit that set it is its own column: an office never sets its own.
 */
export const campaignTargets = withRls(
    audited(
        competencySchema.table(
            'campaign_targets',
            {
                ...baseColumns(),
                ...handled(),
                campaignId: uuid('campaign_id')
                    .notNull()
                    .references(() => campaigns.id),
                target: integer('target').notNull(),
                setByUnitId: uuid('set_by_unit_id')
                    .notNull()
                    .references(() => orgUnits.id)
            },
            (t) => [
                uniqueIndex('campaign_targets_uq').on(t.campaignId, t.handlingUnitId),
                index('campaign_targets_org_path_gist').using('gist', t.orgPath),
                check('campaign_targets_check', sql`target BETWEEN 1 AND 10000000`)
            ]
        )
    ),
    'transaction'
);
