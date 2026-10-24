/**
 * The life of an uploaded file (architecture §14, task 0.15):
 *   1. begin     the person asks to upload (name, type, size, SHA-256): a `pending` row and a presigned POST (or part
 *                URLs) for exactly that size and type, under `quarantine/`; S3 itself refuses anything larger or of
 *                another type. Quotas bound what one person has waiting and uploads in a day.
 *   2. confirm   the uploader says it is done: the object is first copied out of quarantine, and the copy (which no
 *                presigned URL can reach) is checked: size, first bytes (its real type) and SHA-256. A mismatch is
 *                refused and both objects removed; a good file is `stored`. Re-posting to the quarantine key during or
 *                after the checks changes nothing that was checked.
 *   3. link      the owning record's service ties it to the record, with a document type; a stored file never linked
 *                expires after a week.
 *   4. download  a short presigned URL, after the scope check (RLS: the uploading unit's subtree), under a name whose
 *                extension is the type its bytes showed.
 *   5. purge     the worker removes what expired, and quarantine leftovers (jobs/files-purge.ts).
 */
import { and, count, eq, gte, inArray, sql, sum } from 'drizzle-orm';

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
import { detectType, FILE_TYPES, MAGIC_LENGTH, type FileType } from './file-types';
import { files } from './files.table';
import { ObjectStoreRefusal, type ObjectStore } from './object-store';

/** How long an upload URL, and a pending upload, live. */
export const UPLOAD_URL_SECONDS = 15 * 60;
export const PENDING_HOURS = 24;
/** A stored file no record has linked is removed after this. */
export const UNLINKED_DAYS = 7;
export const DOWNLOAD_URL_SECONDS = 5 * 60;
/** What one person may have waiting for confirmation at a time, and upload in a day. */
export const PENDING_QUOTA = { files: 20, bytes: 200 * 1024 * 1024 };
export const DAILY_QUOTA_BYTES = 1024 * 1024 * 1024;
/** The first key of the per-person quota locks (no other advisory lock shares it). */
const QUOTA_LOCK = 0x1f11;

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

export const quarantineKey = (regionId: string, id: string) => `quarantine/${regionId}/${id}`;
const storedKey = (regionId: string, id: string) => `files/${regionId}/${id}`;

/** The parts of a multipart upload: PART_SIZE each, the last one what remains. */
export function partsOf(size: number): { partNumber: number; size: number }[] {
    const n = Math.ceil(size / PART_SIZE);
    return Array.from({ length: n }, (_, i) => ({
        partNumber: i + 1,
        size: i === n - 1 ? size - PART_SIZE * (n - 1) : PART_SIZE
    }));
}

/** The name a download is offered under: the person's name, with the extension of the type the bytes showed. */
export function downloadName(filename: string, contentType: FileType): string {
    const extension = FILE_TYPES[contentType].extension;
    const base = filename.replace(/\.[^.]{1,10}$/, '') || 'file';
    return `${base}.${extension}`;
}

export async function beginUpload(
    tx: Tx,
    store: ObjectStore,
    ctx: DbContext,
    input: FileUploadRequest
): Promise<UploadTicket> {
    if (!ctx.userId || !ctx.unitId || !ctx.regionId)
        throw new ForbiddenError({ detail: 'Choose the office you act for.' });
    // one person's begins one at a time: two at once cannot both pass the quota
    await tx.execute(sql`select pg_advisory_xact_lock(${QUOTA_LOCK}, hashtext(${ctx.userId}))`);
    const [waiting] = await tx
        .select({ files: count(), bytes: sum(files.size) })
        .from(files)
        .where(and(eq(files.createdBy, ctx.userId), inArray(files.status, ['pending', 'checking'] as const)));
    const [today] = await tx
        .select({ bytes: sum(files.size) })
        .from(files)
        .where(and(eq(files.createdBy, ctx.userId), gte(files.createdAt, sql`now() - interval '1 day'`)));
    if (
        (waiting?.files ?? 0) >= PENDING_QUOTA.files ||
        Number(waiting?.bytes ?? 0) + input.size > PENDING_QUOTA.bytes ||
        Number(today?.bytes ?? 0) + input.size > DAILY_QUOTA_BYTES
    )
        throw new RateLimitedError(PENDING_HOURS * 3600, {
            detail: 'Too many uploads are waiting, or too much was uploaded today: finish the ones waiting first.'
        });

    const id = newId();
    const key = quarantineKey(ctx.regionId, id);
    const row = await insertAudited(tx, files, {
        id,
        regionId: ctx.regionId,
        unitId: ctx.unitId,
        filename: input.filename,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        objectKey: key,
        documentType: input.documentType ?? null,
        expiresAt: new Date(Date.now() + PENDING_HOURS * 3_600_000)
    });
    const expiresAt = new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString();
    if (input.size <= SINGLE_UPLOAD_LIMIT) {
        const post = await store.presignPost({
            key,
            contentType: input.contentType,
            size: input.size,
            expiresIn: UPLOAD_URL_SECONDS
        });
        return { file: fileOut(row), upload: { kind: 'post', ...post }, expiresAt };
    }
    // the upload is opened only once its row exists: a refused row leaves no open upload behind
    const uploadId = await store.createMultipart({ key, contentType: input.contentType });
    const opened = await updateAudited(tx, files, id, row.rowVersion, { uploadId });
    const parts = await Promise.all(
        partsOf(input.size).map(async (p) => ({
            ...p,
            url: await store.presignPart({ key, uploadId, ...p, expiresIn: UPLOAD_URL_SECONDS })
        }))
    );
    return { file: fileOut(opened), upload: { kind: 'parts', parts }, expiresAt };
}

/** The file, as the caller may see it (RLS: the uploading unit's subtree). */
export async function getFile(tx: Tx, id: string): Promise<FileRow> {
    const [row] = await tx.select().from(files).where(eq(files.id, id));
    if (!row) throw new NotFoundError();
    return row;
}

const still = (row: FileRow) =>
    new ConflictError('stale_version', { detail: `The upload ${row.id} changed meanwhile: confirm it again.` });

/**
 * Checks an upload and stores it. The confirmation first claims the upload (`checking`, on the version read), so a
 * second one at the same time is refused instead of copying over what this one checks. The checks read objects (outside
 * any transaction: a large file takes time); the outcome is written on the claimed version, so a purge meanwhile is not
 * overwritten. Whatever fails before an outcome hands the upload back (`pending`). Confirming a stored file again
 * answers it as it is.
 */
export async function confirmUpload(
    db: Database,
    store: ObjectStore,
    ctx: DbContext,
    id: string,
    parts?: { partNumber: number; etag: string }[]
): Promise<StoredFile> {
    const read = await db.scoped(ctx, (tx) => getFile(tx, id));
    if (read.createdBy !== ctx.userId) throw new ForbiddenError({ detail: 'Only who uploaded a file confirms it.' });
    if (read.status === 'stored') return fileOut(read);
    if (read.status === 'checking')
        throw new ConflictError('invalid_transition', { detail: 'This upload is being checked: ask again shortly.' });
    if (read.status !== 'pending' || (read.expiresAt && read.expiresAt.getTime() <= Date.now()))
        throw new ConflictError('invalid_transition', { detail: 'This upload was refused or has expired.' });
    const row = await db.scoped(ctx, (tx) => updateAudited(tx, files, id, read.rowVersion, { status: 'checking' }));
    let outcome = false;
    try {
        const stored = await checkAndStore(db, store, ctx, row, parts);
        outcome = true;
        return stored;
    } catch (error) {
        if (error instanceof Refused) {
            outcome = true;
            throw error.reason;
        }
        throw error;
    } finally {
        if (!outcome)
            await db
                .scoped(ctx, (tx) => updateAudited(tx, files, id, row.rowVersion, { status: 'pending' }))
                .catch(() => undefined);
    }
}

/** A refusal already written as the outcome (`rejected`): the claim is not handed back. */
class Refused extends Error {
    constructor(readonly reason: Error) {
        super(reason.message);
    }
}

async function checkAndStore(
    db: Database,
    store: ObjectStore,
    ctx: DbContext,
    row: FileRow,
    parts?: { partNumber: number; etag: string }[]
): Promise<StoredFile> {
    const id = row.id;
    if (row.uploadId) {
        if (!parts?.length)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'parts', code: 'custom', message: 'the parts uploaded, with their ETags' }]
            });
        try {
            await store.completeMultipart({ key: row.objectKey, uploadId: row.uploadId, parts });
        } catch (error) {
            if (!(error instanceof ObjectStoreRefusal)) throw error;
            if (error.kind === 'missing')
                throw new ConflictError('invalid_transition', { detail: 'This upload is no longer open.' });
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'parts', code: 'custom', message: 'the parts do not match the upload' }]
            });
        }
    }
    if (!(await store.head(row.objectKey)))
        throw new ConflictError('invalid_transition', { detail: 'Nothing was uploaded for this file yet.' });

    // out of quarantine first: the copy is what is checked and kept, and no URL handed out can reach it
    const key = storedKey(row.regionId, row.id);
    await store.copy(row.objectKey, key, row.contentType);
    await store.delete(row.objectKey);
    const refuse = async (reason: string, detail: string): Promise<never> => {
        await store.delete(key);
        await db.scoped(ctx, (tx) =>
            updateAudited(tx, files, id, row.rowVersion, { status: 'rejected', rejectReason: reason, uploadId: null })
        );
        throw new Refused(
            new ValidationError('validation_failed', {
                detail,
                errors: [{ path: 'file', code: reason, message: detail }]
            })
        );
    };
    const object = await store.head(key);
    if (!object || object.size !== row.size)
        return refuse('size_mismatch', 'The file is not the size that was declared.');
    const first = await store.readRange(key, 0, Math.min(MAGIC_LENGTH, object.size) - 1);
    if (detectType(first) !== row.contentType)
        return refuse('type_mismatch', 'The file is not of the type that was declared.');
    if ((await store.sha256(key)) !== row.sha256)
        return refuse('checksum_mismatch', 'The file is not the one that was declared (its checksum differs).');

    try {
        return await db.scoped(ctx, async (tx) => {
            const current = await getFile(tx, id);
            if (current.status !== 'checking' || current.rowVersion !== row.rowVersion) throw still(row);
            const stored = await updateAudited(tx, files, id, row.rowVersion, {
                status: 'stored',
                objectKey: key,
                uploadId: null,
                // a file no record links within a week is removed
                expiresAt: new Date(Date.now() + UNLINKED_DAYS * 86_400_000),
                confirmedAt: new Date()
            });
            return fileOut(stored);
        });
    } catch (error) {
        // not recorded as stored: its object must not stay behind
        await store.delete(key).catch(() => undefined);
        throw error;
    }
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
        filename: downloadName(row.filename, row.contentType as FileType),
        contentType: row.contentType,
        expiresIn: DOWNLOAD_URL_SECONDS
    });
    await recordEvent(tx, { type: 'file.downloaded', table: files, rowId: id });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() };
}

/**
 * Ties a stored file to the record it belongs to (called by that record's service, in its transaction). A file belongs
 * to one record; linking it again to the same one only changes the document type. A linked file no longer expires.
 */
export async function linkFile(
    tx: Tx,
    id: string,
    to: { table: string; id: string; documentType?: string }
): Promise<StoredFile> {
    const row = await getFile(tx, id);
    if (row.status !== 'stored')
        throw new ConflictError('invalid_transition', { detail: 'Only a confirmed upload can be attached.' });
    // past its week the purge may already be removing it: a record never gets a file that is going
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now())
        throw new ConflictError('invalid_transition', { detail: 'This upload has expired: upload it again.' });
    if (row.linkedId && (row.linkedId !== to.id || row.linkedTable !== to.table))
        throw new ConflictError('invalid_transition', { detail: 'This file is attached to another record.' });
    const linked = await updateAudited(tx, files, id, row.rowVersion, {
        linkedTable: to.table,
        linkedId: to.id,
        documentType: to.documentType ?? row.documentType,
        expiresAt: null
    });
    return fileOut(linked);
}
