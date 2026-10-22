/**
 * `reveal()` (ADR-0031, SEC-PD-1): the only way a sensitive field is read back in clear. The caller has checked
 * `pii:reveal` (and a recent second factor); reveal records who asked for which fields of which record and why, in a
 * transaction of its own that commits first, so the record stays even when the read then fails. Then it reads.
 */
import type { PgTable } from 'drizzle-orm/pg-core';

import type { Database } from '../db/database';
import type { DbContext, Tx } from '../db/types';

export interface RevealRequest {
    /** the audit event (`person.revealed`) */
    type: string;
    table: PgTable;
    rowId: string;
    fields: readonly string[];
    /** why, in the person's words (kept in the audit log) */
    reason: string;
}

export async function reveal<T>(
    db: Database,
    ctx: DbContext,
    request: RevealRequest,
    read: (tx: Tx) => Promise<T>
): Promise<T> {
    await db.recordSensitiveEvent(ctx, {
        type: request.type,
        table: request.table,
        rowId: request.rowId,
        data: { fields: [...request.fields].sort(), reason: request.reason }
    });
    return db.scoped(ctx, read);
}
