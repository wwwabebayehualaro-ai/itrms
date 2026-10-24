/**
 * Forms (architecture.md §6.2, form-platform.md, task 0.16a).
 *
 *   form_definitions   a form and its working copy (`document`), owned by a unit: the bureau's forms at the region's
 *                      root, a unit's own forms at the unit (class C: the subtree and its ancestors read, the subtree
 *                      writes; a woreda fills in the bureau's forms and cannot change them).
 *   form_versions      immutable, content-hashed snapshots of a working copy (class C, beside their definition). No UPDATE
 *                      or DELETE: grants and a trigger refuse them; only a unit move rewrites `org_path`.
 *   form_publications  a request to make a version the one people fill in, decided by a second person (class T at the
 *                      owner unit: its subtree asks, its heads and those above decide).
 *   submissions        answers, pinned to the version they were filled on (class T at the handling unit). `case_id` gets
 *                      its foreign key when cases exist (task 0.19).
 *   submission_values  the typed values of filterable fields, for the data viewer's indexes (ADR-0035, task 0.16b).
 *
 * The audit log holds a document's hash, never the document (the versions are the record of what was published), and
 * answers only as an HMAC: they hold personal data and the values of role-restricted fields.
 */
import { sql } from 'drizzle-orm';
import {
    boolean,
    date,
    doublePrecision,
    index,
    integer,
    jsonb,
    pgSchema,
    primaryKey,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { orgUnits } from '@itrms/kernel/tables';
import { audited, baseColumns, ltree, notAudited, withRls } from '@itrms/kernel/db';

export const formsSchema = pgSchema('forms');

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

export const formDefinitions = withRls(
    audited(
        formsSchema.table(
            'form_definitions',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                /** I18nText: Amharic and English required */
                name: jsonb('name').$type<Record<string, string>>().notNull(),
                category: text('category'),
                active: boolean('active').notNull().default(true),
                /** the working copy: what the next publication snapshots */
                document: jsonb('document').notNull(),
                documentHash: text('document_hash').notNull(),
                /** who last changed the working copy: they cannot approve its publication (SEC-AC-6) */
                documentUpdatedBy: uuid('document_updated_by'),
                publishedVersionId: uuid('published_version_id').references((): AnyPgColumn => formVersions.id),
                /** the filterable fields whose values every submission has in submission_values (ADR-0035) */
                indexedKeys: text('indexed_keys')
                    .array()
                    .notNull()
                    .default(sql`'{}'::text[]`),
                publishedAt: timestamp('published_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('form_definitions_key_uq').on(t.regionId, t.key),
                index('form_definitions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['document'] }
    ),
    'config'
);

export const formVersions = withRls(
    audited(
        formsSchema.table(
            'form_versions',
            {
                ...baseColumns(),
                ...owned(),
                formId: uuid('form_id')
                    .notNull()
                    .references(() => formDefinitions.id),
                /** 1, 2, 3 … per form, in the order versions were made */
                number: integer('number').notNull(),
                contentHash: text('content_hash').notNull(),
                document: jsonb('document').notNull()
            },
            (t) => [
                uniqueIndex('form_versions_content_uq').on(t.formId, t.contentHash),
                uniqueIndex('form_versions_number_uq').on(t.formId, t.number),
                index('form_versions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['document'] }
    ),
    'config'
);

export const formPublications = withRls(
    audited(
        formsSchema.table(
            'form_publications',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                /** the form's owner unit */
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                formId: uuid('form_id')
                    .notNull()
                    .references(() => formDefinitions.id),
                formVersionId: uuid('form_version_id')
                    .notNull()
                    .references(() => formVersions.id),
                /** who last changed the content asked for: neither they nor the requester decide */
                contentBy: uuid('content_by'),
                status: text('status', { enum: ['pending', 'approved', 'rejected', 'withdrawn'] })
                    .notNull()
                    .default('pending'),
                note: text('note'),
                decidedBy: uuid('decided_by'),
                decidedAt: timestamp('decided_at', { withTimezone: true }),
                decisionNote: text('decision_note')
            },
            (t) => [
                // one open request per form
                uniqueIndex('form_publications_pending_uq')
                    .on(t.formId)
                    .where(sql`${t.status} = 'pending'`),
                index('form_publications_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'transaction'
);

export const submissions = withRls(
    audited(
        formsSchema.table(
            'submissions',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                handlingUnitId: uuid('handling_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the handling unit */
                orgPath: ltree('org_path').notNull().default(''),
                formId: uuid('form_id')
                    .notNull()
                    .references(() => formDefinitions.id),
                formVersionId: uuid('form_version_id')
                    .notNull()
                    .references(() => formVersions.id),
                /** the case the answers belong to (no foreign key until cases exist, task 0.19) */
                caseId: uuid('case_id'),
                answers: jsonb('answers').$type<Record<string, unknown>>().notNull()
            },
            (t) => [
                // a form's submissions newest first (ids are UUIDv7: time-ordered), and one person's
                index('submissions_form_idx').on(t.formId, t.id.desc()),
                index('submissions_form_creator_idx').on(t.formId, t.createdBy, t.id.desc()),
                index('submissions_version_idx').on(t.formVersionId),
                index('submissions_case_idx')
                    .on(t.caseId)
                    .where(sql`${t.caseId} is not null`),
                index('submissions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { mask: ['answers'] }
    ),
    'transaction'
);

/**
 * The typed values of filterable fields (ADR-0035): what the data viewer filters on with ordinary indexes. Written with
 * the submission in its transaction, filled by the worker when a version makes a field filterable; never edited apart.
 * A multiple choice has one row per choice (`ordinal`).
 */
export const submissionValues = withRls(
    notAudited(
        formsSchema.table(
            'submission_values',
            {
                submissionId: uuid('submission_id')
                    .notNull()
                    .references(() => submissions.id),
                ordinal: smallint('ordinal').notNull().default(0),
                formId: uuid('form_id').notNull(),
                fieldKey: text('field_key').notNull(),
                regionId: uuid('region_id').notNull(),
                handlingUnitId: uuid('handling_unit_id').notNull(),
                /** set by trigger from the handling unit */
                orgPath: ltree('org_path').notNull().default(''),
                valueText: text('value_text'),
                /**
                 * a JSON number is a double wherever it was read: stored as one, its comparison is leakproof, so under RLS the
                 * index serves a range (numeric's is not: the filter would run after the scan, ADR-0035)
                 */
                valueNum: doublePrecision('value_num'),
                valueDate: date('value_date'),
                valueTs: timestamp('value_ts', { withTimezone: true }),
                valueBool: boolean('value_bool')
            },
            (t) => [
                primaryKey({ columns: [t.submissionId, t.fieldKey, t.ordinal] }),
                index('submission_values_text_idx')
                    .on(t.formId, t.fieldKey, t.valueText, t.submissionId)
                    .where(sql`${t.valueText} is not null`),
                index('submission_values_num_idx')
                    .on(t.formId, t.fieldKey, t.valueNum, t.submissionId)
                    .where(sql`${t.valueNum} is not null`),
                index('submission_values_date_idx')
                    .on(t.formId, t.fieldKey, t.valueDate, t.submissionId)
                    .where(sql`${t.valueDate} is not null`),
                index('submission_values_ts_idx')
                    .on(t.formId, t.fieldKey, t.valueTs, t.submissionId)
                    .where(sql`${t.valueTs} is not null`),
                index('submission_values_bool_idx')
                    .on(t.formId, t.fieldKey, t.valueBool, t.submissionId)
                    .where(sql`${t.valueBool} is not null`),
                index('submission_values_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        'derived from its submission, whose insert is audited in the same transaction (ADR-0035)'
    ),
    'transaction'
);
