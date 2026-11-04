/**
 * Document templates and the documents issued (architecture.md §10, ADR-0006, ADR-0044; task 0.23a).
 *
 *   document_templates          a template by key, owned at the region's root (class C: every unit reads the bureau's).
 *   document_template_versions  its versions: body, words, paper, data shape. Stored once by content, never changed.
 *   issued_documents            what was issued (class T at the handling unit): the template version, the data it was given and
 *                               the header it had then, frozen; the stored PDF once the PDF worker has made it. A reprint
 *                               serves that file, so what was printed never changes.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgSchema, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { audited, baseColumns, ltree, withRls } from '@itrms/kernel/db';
import { files, orgUnits } from '@itrms/kernel/tables';
import type { I18nText } from '@itrms/schemas';

import type { DocumentDataSchema, DocumentHeader, Paper } from '../contracts';

export const documentsSchema = pgSchema('documents');

const owned = () => ({
    regionId: uuid('region_id').notNull(),
    ownerUnitId: uuid('owner_unit_id')
        .notNull()
        .references(() => orgUnits.id),
    /** set by trigger from the owner unit */
    orgPath: ltree('org_path').notNull().default('')
});

export const documentTemplates = withRls(
    audited(
        documentsSchema.table(
            'document_templates',
            {
                ...baseColumns(),
                ...owned(),
                key: text('key').notNull(),
                name: jsonb('name').$type<I18nText>().notNull(),
                /** the newest version */
                latestVersionId: uuid('latest_version_id').references((): AnyPgColumn => documentTemplateVersions.id)
            },
            (t) => [
                uniqueIndex('document_templates_key_uq').on(t.regionId, t.key),
                index('document_templates_org_path_gist').using('gist', t.orgPath)
            ]
        )
    ),
    'config'
);

export const documentTemplateVersions = withRls(
    audited(
        documentsSchema.table(
            'document_template_versions',
            {
                ...baseColumns(),
                ...owned(),
                templateId: uuid('template_id')
                    .notNull()
                    .references(() => documentTemplates.id),
                number: integer('number').notNull(),
                contentHash: text('content_hash').notNull(),
                body: text('body').notNull(),
                strings: jsonb('strings').$type<Record<string, I18nText>>().notNull(),
                paper: text('paper').$type<Paper>().notNull(),
                dataSchema: text('data_schema').$type<DocumentDataSchema>().notNull()
            },
            (t) => [
                uniqueIndex('document_template_versions_content_uq').on(t.templateId, t.contentHash),
                uniqueIndex('document_template_versions_number_uq').on(t.templateId, t.number),
                index('document_template_versions_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['body', 'strings'] }
    ),
    'config'
);

export const issuedDocuments = withRls(
    audited(
        documentsSchema.table(
            'issued_documents',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                handlingUnitId: uuid('handling_unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the handling unit */
                orgPath: ltree('org_path').notNull().default(''),
                templateId: uuid('template_id')
                    .notNull()
                    .references(() => documentTemplates.id),
                templateVersionId: uuid('template_version_id')
                    .notNull()
                    .references(() => documentTemplateVersions.id),
                /** the case it belongs to (the key is in the migration) */
                caseId: uuid('case_id'),
                /** the record it is the document of (a receipt): one per template */
                subjectTable: text('subject_table'),
                subjectId: uuid('subject_id'),
                /** the number it carries, from the record it documents; many documents carry none */
                number: text('number'),
                language: text('language').notNull(),
                /** what it printed, checked against the template's data shape: may hold personal data, so out of the log */
                data: jsonb('data').$type<Record<string, unknown>>().notNull(),
                header: jsonb('header').$type<DocumentHeader>().notNull(),
                officeName: jsonb('office_name').$type<I18nText>().notNull(),
                state: text('state').$type<'requested' | 'rendered' | 'failed'>().notNull().default('requested'),
                failure: text('failure'),
                fileId: uuid('file_id').references(() => files.id),
                sha256: text('sha256')
            },
            (t) => [
                uniqueIndex('issued_documents_subject_uq')
                    .on(t.templateId, t.subjectId)
                    .where(sql`subject_id IS NOT NULL`),
                index('issued_documents_case_idx')
                    .on(t.caseId)
                    .where(sql`case_id IS NOT NULL`),
                index('issued_documents_subject_idx')
                    .on(t.subjectId)
                    .where(sql`subject_id IS NOT NULL`),
                index('issued_documents_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['data', 'header'] }
    ),
    'transaction'
);
