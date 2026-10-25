/**
 * Uploaded files (architecture §14, task 0.15). A row is made when an upload is asked for (`pending`, its object under
 * `quarantine/`); the uploader confirms it (size, SHA-256 and first bytes checked), it is moved to `files/` and becomes
 * `stored`; a record links it with a document type. An upload never confirmed, or refused, is `expired` by the purge after
 * 24 hours and its object removed. Class T: the uploading unit's subtree reads and downloads it. A file the server
 * generates (an export, task 0.16e) is stored at once, with a time it is kept until.
 */
import { sql } from 'drizzle-orm';
import { bigint, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { audited } from '../db/audit-policy';
import { kernelSchema } from '../db/audit-log.table';
import { baseColumns, ltree } from '../db/columns';
import { withRls } from '../db/rls';
import { orgUnits } from '../org/org.table';

/** `checking`: one confirmation holds the upload while it copies and checks it (a second one waits its turn) */
export const FILE_STATUSES = ['pending', 'checking', 'stored', 'rejected', 'expired'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const files = withRls(
    audited(
        kernelSchema.table(
            'files',
            {
                ...baseColumns(),
                regionId: uuid('region_id').notNull(),
                unitId: uuid('unit_id')
                    .notNull()
                    .references(() => orgUnits.id),
                /** set by trigger from the unit */
                orgPath: ltree('org_path').notNull().default(''),
                status: text('status', { enum: FILE_STATUSES }).notNull().default('pending'),
                /** the name the person gave it: shown and offered on download, never part of a key (SEC-IN-9) */
                filename: text('filename').notNull(),
                contentType: text('content_type').notNull(),
                /** bytes, as declared at the start (and checked on confirmation) */
                size: bigint('size', { mode: 'number' }).notNull(),
                /** hex, as declared by the uploader's browser (and checked on confirmation) */
                sha256: text('sha256').notNull(),
                objectKey: text('object_key').notNull(),
                /** a multipart upload's id, while it is open */
                uploadId: text('upload_id'),
                /** the kind of document (`id_card`, `medical_certificate` …), set at upload or when linked */
                documentType: text('document_type'),
                /** the record it belongs to (`parties.persons`), once linked */
                linkedTable: text('linked_table'),
                linkedId: uuid('linked_id'),
                /** a pending or refused upload is purged after this */
                expiresAt: timestamp('expires_at', { withTimezone: true }),
                confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
                /** why a confirmation was refused (size, type, checksum) */
                rejectReason: text('reject_reason'),
                /** upload: a person's (checked by its bytes); generated: made by the server (an export, a document) */
                origin: text('origin', { enum: ['upload', 'generated'] })
                    .notNull()
                    .default('upload')
            },
            (t) => [
                index('files_org_path_gist').using('gist', t.orgPath),
                index('files_linked_idx').on(t.linkedTable, t.linkedId),
                // exactly what the purge selects (jobs/files-purge.ts), stored files waiting for a link included: the
                // linked ones, which are most of the table, stay out of it
                index('files_purge_idx')
                    .on(t.expiresAt)
                    .where(
                        sql`${t.status} in ('pending', 'checking', 'rejected') or (${t.status} = 'stored' and ${t.linkedId} is null)`
                    ),
                index('files_created_by_idx').on(t.createdBy, t.status)
            ]
        )
    ),
    'transaction'
);
