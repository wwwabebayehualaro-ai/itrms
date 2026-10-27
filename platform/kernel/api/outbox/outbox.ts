/**
 * Writing outbox events (architecture.md §12): `emit(tx, type, payload)` in the business transaction, so the event exists
 * exactly when the change does. The event belongs to the unit it happened in (by default the acting unit), which is its
 * RLS scope. Slow or external work (PDFs, SMS, the identity provider) runs from it in the worker, never in the request.
 */
import { contextOfTx, plain } from '../db/audit';
import type { Tx } from '../db/types';
import { outboxEvents } from './outbox.table';

const EVENT = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[1-9]\d*$/;

export interface Emitted {
    id: string;
}

/**
 * Appends an event to the outbox in the caller's transaction. `unitId` and `regionId` default to the transaction's
 * acting unit; installation work (no acting unit) names them.
 */
export async function emit(
    tx: Tx,
    type: string,
    payload: Record<string, unknown>,
    where: {
        unitId?: string;
        regionId?: string;
        /** not before (an SLA's due time): the relay waits for it */ availableAt?: Date;
    } = {}
): Promise<Emitted> {
    if (!EVENT.test(type)) throw new Error(`"${type}" is not an event name (<entity>.<happened>.v<n>)`);
    const ctx = contextOfTx(tx);
    const unitId = where.unitId ?? ctx.unitId;
    const regionId = where.regionId ?? ctx.regionId;
    if (!unitId || !regionId) throw new Error(`emit("${type}"): no unit for the event (name one outside a request)`);
    const [row] = await tx
        .insert(outboxEvents)
        .values({
            type,
            payload: plain(payload),
            unitId,
            regionId,
            requestId: ctx.requestId,
            ...(where.availableAt ? { availableAt: where.availableAt } : {})
        })
        .returning({ id: outboxEvents.id });
    if (!row) throw new Error(`emit("${type}"): the event was not written`);
    return row;
}
