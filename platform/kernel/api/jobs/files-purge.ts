/**
 * The files purge (task 0.15, architecture §14), run by the worker every hour as a system context; the bucket's lifecycle
 * rule may also remove old quarantine objects, but this is the guarantee:
 *   - an upload never confirmed, or refused, after 24 hours; a stored file no record linked, after a week: its object (and
 *     open multipart upload) removed, its row `expired`;
 *   - under `quarantine/`, an object or an open upload older than 24 hours that no waiting file owns (a re-post after
 *     confirmation, an interrupted run).
 * One failure is logged by the caller and never stops the rest.
 */
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';

import { updateAudited } from '../db/audit';
import type { SystemDatabase } from '../db/system';
import { PENDING_HOURS } from '../files/files';
import { files, type FileStatus } from '../files/files.table';
import type { ObjectStore } from '../files/object-store';

const REASON = 'files.purge';
const recurring = { recurring: true } as const;

export interface PurgeOptions {
    /** told about each item that could not be removed (it is tried again next hour) */
    onError?: (error: unknown, what: string) => void;
    /** the time it is (tests move it on) */
    now?: number;
}

export async function purgeExpiredUploads(
    system: SystemDatabase,
    store: ObjectStore,
    { onError = () => undefined, now = Date.now() }: PurgeOptions = {}
): Promise<number> {
    const due = await system.systemContext(
        REASON,
        (tx) =>
            tx
                .select()
                .from(files)
                .where(
                    and(
                        lte(files.expiresAt, new Date(now)),
                        or(
                            inArray(files.status, ['pending', 'checking', 'rejected'] as FileStatus[]),
                            and(eq(files.status, 'stored'), isNull(files.linkedId))
                        )
                    )
                )
                .limit(500),
        recurring
    );
    let removed = 0;
    for (const row of due) {
        try {
            // the row first, on the version read: a file confirmed or linked meanwhile is left as it is, object and all.
            // An object whose removal then fails stays behind unreachable (no row serves it), never a record without it
            await system.systemContext(
                REASON,
                (tx) => updateAudited(tx, files, row.id, row.rowVersion, { status: 'expired', uploadId: null }),
                recurring
            );
            if (row.uploadId) await store.abortMultipart(row.objectKey, row.uploadId).catch(() => undefined);
            await store.delete(row.objectKey);
            removed++;
        } catch (error) {
            onError(error, row.id);
        }
    }

    // quarantine leftovers: what no waiting file owns, once older than a pending upload may be
    const waiting = await system.systemContext(
        REASON,
        (tx) =>
            tx
                .select({ key: files.objectKey, uploadId: files.uploadId })
                .from(files)
                .where(inArray(files.status, ['pending', 'checking'] as FileStatus[])),
        recurring
    );
    const ownedKeys = new Set(waiting.map((w) => w.key));
    const ownedUploads = new Set(waiting.map((w) => w.uploadId).filter(Boolean));
    const cutoff = now - PENDING_HOURS * 3_600_000;
    for (const open of await store.listMultipart('quarantine/'))
        if (!ownedUploads.has(open.uploadId) && open.initiated.getTime() < cutoff)
            try {
                await store.abortMultipart(open.key, open.uploadId);
                removed++;
            } catch (error) {
                onError(error, open.key);
            }
    for (const object of await store.listObjects('quarantine/'))
        if (!ownedKeys.has(object.key) && object.lastModified.getTime() < cutoff)
            try {
                await store.delete(object.key);
                removed++;
            } catch (error) {
                onError(error, object.key);
            }
    return removed;
}
