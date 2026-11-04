/**
 * A closed case's open payment order is cancelled (task 0.22b): nothing more is paid for it. On the workflow's
 * `case.transitioned.v1`, read with this slice's own schema (it sits below the workflow and never imports it). Idempotent:
 * an order already cancelled, settled or gone is left as it is. A settled order of a closed case stays settled (its
 * receipt holds; a reversal of it is refused, ADR-0042).
 */
import { and, eq } from 'drizzle-orm';
import { updateAudited } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { z } from 'zod';

import { paymentOrders } from '../fees.table';

const caseTransitioned = z.object({ caseId: z.uuid(), closed: z.boolean() });

/** Cancels the case's open order: true when there was one. */
export async function cancelClosedCaseOrder(system: SystemDatabase, caseId: string): Promise<boolean> {
    return system.systemContext('fees.case_closed', async (tx) => {
        const [order] = await tx
            .select()
            .from(paymentOrders)
            .where(and(eq(paymentOrders.caseId, caseId), eq(paymentOrders.state, 'open')))
            .for('update');
        if (!order) return false;
        await updateAudited(tx, paymentOrders, order.id, order.rowVersion, {
            state: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: 'case_closed'
        });
        return true;
    });
}

export function feesHandlers(system: SystemDatabase): Record<string, OutboxHandler> {
    return {
        'case.transitioned.v1': async (job) => {
            const event = caseTransitioned.parse(job.payload);
            if (event.closed) await cancelClosedCaseOrder(system, event.caseId);
        }
    };
}
