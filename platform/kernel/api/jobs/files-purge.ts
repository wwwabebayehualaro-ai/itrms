/**
 * The files purge (task 0.15, architecture §14), run by the worker every hour as a system context: the S3 lifecycle rule
 * may also remove old quarantine objects, but this is the guarantee.
 */
import { and, inArray, lte, sql } from 'drizzle-orm';

import { updateAudited } from '../db/audit';
import type { SystemDatabase } from '../db/system';
import { PENDING_HOURS } from '../files/files';
import { files, type FileStatus } from '../files/files.table';
import type { ObjectStore } from '../files/object-store';

/**
 * The worker's purge (every hour): uploads never confirmed, or refused, are expired after 24 hours and their objects (and
 * open multipart uploads) removed; multipart uploads under `quarantine/` that no row knows are aborted too. Returns how
 * many it removed.
 */
export async function purgeExpiredUploads(system: SystemDatabase, store: ObjectStore): Promise<number> {
    const due = await system.systemContext(
        'files.purge',
        (tx) =>
            tx
                .select()
                .from(files)
                .where(
                    and(
                        inArray(files.status, ['pending', 'rejected'] as FileStatus[]),
                        lte(files.expiresAt, sql`now()`)
                    )
                )
                .limit(500),
        { recurring: true }
    );
    let removed = 0;
    for (const row of due) {
        if (row.uploadId) await store.abortMultipart(row.objectKey, row.uploadId).catch(() => undefined);
        await store.delete(row.objectKey);
        await system.systemContext(
            'files.purge',
            async (tx) => {
                await updateAudited(tx, files, row.id, row.rowVersion, { status: 'expired', uploadId: null });
            },
            { recurring: true }
        );
        removed++;
    }
    const known = new Set(due.map((r) => r.uploadId).filter(Boolean));
    const cutoff = Date.now() - PENDING_HOURS * 3_600_000;
    for (const pending of await store.listMultipart('quarantine/'))
        if (!known.has(pending.uploadId) && pending.initiated.getTime() < cutoff) {
            await store.abortMultipart(pending.key, pending.uploadId);
            removed++;
        }
    return removed;
}
