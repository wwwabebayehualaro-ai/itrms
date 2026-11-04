/**
 * Document templates and the documents issued (architecture.md §10, ADR-0006, ADR-0044; task 0.23a).
 *
 *   document_templates          a template by key, owned at the region's root (class C: every unit reads the bureau's).
 *   document_template_versions  its versions: body, words, paper, data shape. Stored once by content, never changed.
 *   issued_documents            what was issued (class T at the handling unit): the template version, the data it was given and
 *                               the header it had then, frozen; the stored PDF once the PDF worker has made it. A reprint
 *                               serves that file, so what was printed never changes.
 *   signing_keys                a region's Ed25519 keys (class C at its root): the public half for anyone in the region, the
 *                               private half wrapped outside the database's reach, and for the PDF worker alone (ADR-0045).
 */
import { sql } from 'drizzle-orm';
import {
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgSchema,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { bytea } from '@itrms/kernel/crypto';
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

export const signingKeys = withRls(
    audited(
        documentsSchema.table(
            'signing_keys',
            {
                ...baseColumns(),
                ...owned(),
                /** short: every QR names it */
                keyId: text('key_id').notNull(),
                /** the raw 32 bytes, base64url */
                publicKey: text('public_key').notNull(),
                /** sealed by the key-encryption key (FIELD_KEYS) */
                privateKey: bytea('private_key').notNull(),
                active: boolean('active').notNull().default(true),
                retiredAt: timestamp('retired_at', { withTimezone: true })
            },
            (t) => [
                uniqueIndex('signing_keys_key_id_uq').on(t.regionId, t.keyId),
                uniqueIndex('signing_keys_active_uq')
                    .on(t.regionId)
                    .where(sql`active`),
                index('signing_keys_org_path_gist').using('gist', t.orgPath)
            ]
        ),
        { omit: ['privateKey'] }
    ),
    'config'
);

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
                sha256: text('sha256'),
                /** of the token in its QR; the token itself is never stored */
                verificationTokenHash: text('verification_token_hash'),
                signingKeyId: uuid('signing_key_id').references(() => signingKeys.id),
                /** what the public page shows of whose it is */
                holderMask: text('holder_mask'),
                validUntil: date('valid_until'),
                revokedAt: timestamp('revoked_at', { withTimezone: true }),
                revokeReason: text('revoke_reason'),
                /** the document that corrects this one (the key, deferred, is in the migration: both change together) */
                supersededBy: uuid('superseded_by')
            },
            (t) => [
                // a correction supersedes: one document of a record stands at a time
                uniqueIndex('issued_documents_subject_uq')
                    .on(t.templateId, t.subjectId)
                    .where(sql`subject_id IS NOT NULL AND superseded_by IS NULL`),
                uniqueIndex('issued_documents_token_uq')
                    .on(t.verificationTokenHash)
                    .where(sql`verification_token_hash IS NOT NULL`),
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
