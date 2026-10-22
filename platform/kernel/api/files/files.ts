/**
 * The life of an uploaded file (architecture §14, task 0.15):
 *   1. begin     the person asks to upload (name, type, size, SHA-256): a `pending` row and a presigned POST (or part
 *                URLs) for exactly that size and type, under `quarantine/`; S3 itself refuses anything larger or of
 *                another type. A per-person quota bounds what is waiting.
 *   2. confirm   the uploader says it is done: the object's size, first bytes (its real type) and SHA-256 are checked; a
 *                mismatch is refused and the object removed; a good file moves to `files/` and is `stored`.
 *   3. link      the owning record's service ties it to the record, with a document type.
 *   4. download  a short presigned URL, after the scope check (RLS: the uploading unit's subtree).
 *   5. purge     the worker expires what was never confirmed, or refused, after 24 hours, and removes its object
 *                (jobs/files-purge.ts).
 */
import { and, count, eq, sum } from 'drizzle-orm';

import {
    PART_SIZE,
    SINGLE_UPLOAD_LIMIT,
    type FileUploadRequest,
    type StoredFile,
    type UploadTicket
} from '../../contracts';
import { insertAudited, recordEvent, updateAudited } from '../db/audit';
import { newId } from '../db/columns';
import type { Database } from '../db/database';
import type { DbContext, Tx } from '../db/types';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../errors/app-error';
import { detectType, MAGIC_LENGTH } from './file-types';
import { files } from './files.table';
import type { ObjectStore } from './object-store';

/** How long an upload URL, and a pending upload, live. */
export const UPLOAD_URL_SECONDS = 15 * 60;
export const PENDING_HOURS = 24;
export const DOWNLOAD_URL_SECONDS = 5 * 60;
/** What one person may have waiting for confirmation at a time. */
export const PENDING_QUOTA = { files: 20, bytes: 200 * 1024 * 1024 };

type FileRow = typeof files.$inferSelect;

export function fileOut(row: FileRow): StoredFile {
    return {
        id: row.id,
        status: row.status,
        filename: row.filename,
        contentType: row.contentType,
        size: row.size,
        sha256: row.sha256,
        documentType: row.documentType,
        linked: row.linkedId !== null,
        createdAt: row.createdAt.toISOString(),
        confirmedAt: row.confirmedAt?.toISOString() ?? null
    };
}

const quarantineKey = (regionId: string, id: string) => `quarantine/${regionId}/${id}`;
const storedKey = (regionId: string, id: string) => `files/${regionId}/${id}`;

/** The parts of a multipart upload: PART_SIZE each, the last one what remains. */
export function partsOf(size: number): { partNumber: number; size: number }[] {
    const n = Math.ceil(size / PART_SIZE);
    return Array.from({ length: n }, (_, i) => ({
        partNumber: i + 1,
        size: i === n - 1 ? size - PART_SIZE * (n - 1) : PART_SIZE
    }));
}

export async function beginUpload(
    tx: Tx,
    store: ObjectStore,
    ctx: DbContext,
    input: FileUploadRequest
): Promise<UploadTicket> {
    if (!ctx.userId || !ctx.unitId || !ctx.regionId)
        throw new ForbiddenError({ detail: 'Choose the office you act for.' });
    const [waiting] = await tx
        .select({ files: count(), bytes: sum(files.size) })
        .from(files)
        .where(and(eq(files.createdBy, ctx.userId), eq(files.status, 'pending')));
    if ((waiting?.files ?? 0) >= PENDING_QUOTA.files || Number(waiting?.bytes ?? 0) + input.size > PENDING_QUOTA.bytes)
        throw new RateLimitedError(PENDING_HOURS * 3600, {
            detail: 'Too many uploads are waiting to be confirmed: finish or cancel them first.'
        });

    const id = newId();
    const key = quarantineKey(ctx.regionId, id);
    const multipart = input.size > SINGLE_UPLOAD_LIMIT;
    const uploadId = multipart ? await store.createMultipart({ key, contentType: input.contentType }) : null;
    const row = await insertAudited(tx, files, {
        id,
        regionId: ctx.regionId,
        unitId: ctx.unitId,
        filename: input.filename,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        objectKey: key,
        uploadId,
        documentType: input.documentType ?? null,
        expiresAt: new Date(Date.now() + PENDING_HOURS * 3_600_000)
    });
    const expiresAt = new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString();
    if (!uploadId) {
        const post = await store.presignPost({
            key,
            contentType: input.contentType,
            size: input.size,
            expiresIn: UPLOAD_URL_SECONDS
        });
        return { file: fileOut(row), upload: { kind: 'post', ...post }, expiresAt };
    }
    const parts = await Promise.all(
        partsOf(input.size).map(async (p) => ({
            ...p,
            url: await store.presignPart({ key, uploadId, ...p, expiresIn: UPLOAD_URL_SECONDS })
        }))
    );
    return { file: fileOut(row), upload: { kind: 'parts', parts }, expiresAt };
}

/** The file, as the caller may see it (RLS: the uploading unit's subtree). */
export async function getFile(tx: Tx, id: string): Promise<FileRow> {
    const [row] = await tx.select().from(files).where(eq(files.id, id));
    if (!row) throw new NotFoundError();
    return row;
}

/**
 * Checks an upload and stores it. The checks read the object (outside any transaction: a large file takes time); the
 * outcome is written in one. Confirming again answers the file as it is.
 */
export async function confirmUpload(
    db: Database,
    store: ObjectStore,
    ctx: DbContext,
    id: string,
    parts?: { partNumber: number; etag: string }[]
): Promise<StoredFile> {
    const row = await db.scoped(ctx, (tx) => getFile(tx, id));
    if (row.createdBy !== ctx.userId) throw new ForbiddenError({ detail: 'Only who uploaded a file confirms it.' });
    if (row.status === 'stored') return fileOut(row);
    if (row.status !== 'pending')
        throw new ConflictError('invalid_transition', { detail: 'This upload was refused or has expired.' });

    if (row.uploadId) {
        if (!parts?.length)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'parts', code: 'custom', message: 'the parts uploaded, with their ETags' }]
            });
        await store.completeMultipart({ key: row.objectKey, uploadId: row.uploadId, parts });
    }
    const refuse = async (reason: string, detail: string): Promise<never> => {
        await store.delete(row.objectKey);
        await db.scoped(ctx, async (tx) => {
            const current = await getFile(tx, id);
            await updateAudited(tx, files, id, current.rowVersion, {
                status: 'rejected',
                rejectReason: reason,
                uploadId: null
            });
        });
        throw new ValidationError('validation_failed', {
            detail,
            errors: [{ path: 'file', code: reason, message: detail }]
        });
    };

    const object = await store.head(row.objectKey);
    if (!object) throw new ConflictError('invalid_transition', { detail: 'Nothing was uploaded for this file yet.' });
    if (object.size !== row.size) return refuse('size_mismatch', 'The file is not the size that was declared.');
    const first = await store.readRange(row.objectKey, 0, Math.min(MAGIC_LENGTH, object.size) - 1);
    if (detectType(first) !== row.contentType)
        return refuse('type_mismatch', 'The file is not of the type that was declared.');
    if ((await store.sha256(row.objectKey)) !== row.sha256)
        return refuse('checksum_mismatch', 'The file is not the one that was declared (its checksum differs).');

    // checked: out of quarantine (the virus scan of Phase 1 goes between, ADR-0022)
    const key = storedKey(row.regionId, row.id);
    await store.copy(row.objectKey, key, row.contentType);
    await store.delete(row.objectKey);
    return db.scoped(ctx, async (tx) => {
        const current = await getFile(tx, id);
        const stored = await updateAudited(tx, files, id, current.rowVersion, {
            status: 'stored',
            objectKey: key,
            uploadId: null,
            expiresAt: null,
            confirmedAt: new Date()
        });
        return fileOut(stored);
    });
}

/** A short download URL for a stored file the caller may see; the download is on record. */
export async function downloadFile(
    tx: Tx,
    store: ObjectStore,
    id: string
): Promise<{ url: string; expiresAt: string }> {
    const row = await getFile(tx, id);
    if (row.status !== 'stored') throw new NotFoundError();
    const url = await store.presignGet({
        key: row.objectKey,
        filename: row.filename,
        contentType: row.contentType,
        expiresIn: DOWNLOAD_URL_SECONDS
    });
    await recordEvent(tx, { type: 'file.downloaded', table: files, rowId: id });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() };
}

/**
 * Ties a stored file to the record it belongs to (called by that record's service, in its transaction). A file belongs
 * to one record; linking it again to the same one only changes the document type.
 */
export async function linkFile(
    tx: Tx,
    id: string,
    to: { table: string; id: string; documentType?: string }
): Promise<StoredFile> {
    const row = await getFile(tx, id);
    if (row.status !== 'stored')
        throw new ConflictError('invalid_transition', { detail: 'Only a confirmed upload can be attached.' });
    if (row.linkedId && (row.linkedId !== to.id || row.linkedTable !== to.table))
        throw new ConflictError('invalid_transition', { detail: 'This file is attached to another record.' });
    const linked = await updateAudited(tx, files, id, row.rowVersion, {
        linkedTable: to.table,
        linkedId: to.id,
        documentType: to.documentType ?? row.documentType
    });
    return fileOut(linked);
}
