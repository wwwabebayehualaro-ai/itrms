/**
 * A verified reference settles its order (task 0.22c, ADR-0043): by a person's decision in a request, or a statement's
 * line in the worker, through the same steps as a payment at the till, in the caller's transaction. The caller holds
 * the locks, in the one order: the case, the order, the reference.
 */
import { updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { emit } from '@itrms/kernel/outbox';

import type { FeeCasePort } from './case-port';
import { externalPaymentRefs, paymentOrders } from './fees.table';
import { factsOf } from './payment-orders.service';

export async function settleByReference(
    tx: Tx,
    ctx: DbContext,
    cases: FeeCasePort | undefined,
    settling: {
        order: typeof paymentOrders.$inferSelect;
        ref: typeof externalPaymentRefs.$inferSelect;
        via: 'person' | 'statement';
        note?: string;
        language: string;
    }
): Promise<void> {
    const { order, ref, via, note, language } = settling;
    await updateAudited(tx, externalPaymentRefs, ref.id, ref.rowVersion, {
        state: 'verified',
        decidedBy: via === 'person' ? (ctx.userId ?? null) : null,
        decidedAt: new Date(),
        verifiedVia: via,
        note: note ?? null
    });
    const now = await updateAudited(tx, paymentOrders, order.id, order.rowVersion, {
        state: 'settled',
        settledExternalRefId: ref.id
    });
    await emit(
        tx,
        'payment.settled.v1',
        { orderId: order.id, caseId: order.caseId, externalRefId: ref.id },
        { unitId: order.handlingUnitId, regionId: order.regionId }
    );
    await cases?.paymentChanged(
        tx,
        ctx,
        order.caseId,
        {
            payment: factsOf(now),
            action: 'paid',
            // the issuer's receipt is the receipt: the case shows whose and which
            data: { receiptId: null, receiptNumber: `${ref.issuer}/${ref.reference}`, note: note ?? null }
        },
        language
    );
}
