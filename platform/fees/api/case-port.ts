/**
 * What a payment does to its case (a port, task 0.22b, ADR-0042): the fees slice sits below the workflow, so the workflow
 * provides this. In the payment's own transaction: the case is locked first (one lock order, case → order → counter, so
 * a payment and a transition never deadlock), its fact `payment` replaced, the change put on its timeline, and a case
 * waiting on `event:payment.settled` moved on. Without it (the fees slice alone, in its own tests) no case is touched.
 */
import type { DbContext, Tx } from '@itrms/kernel/db';

import type { PaymentFacts } from '../contracts';

export type PaymentChange =
    | 'paid'
    | 'reversal_requested'
    | 'reversed'
    | 'reversal_rejected'
    | 'reference_entered'
    | 'reference_rejected'
    | 'reference_revoked';

export interface FeeCasePort {
    /** Locks the case for the payment's transaction: null when it cannot be read here. */
    lock(tx: Tx, caseId: string): Promise<{ closed: boolean } | null>;
    paymentChanged(
        tx: Tx,
        ctx: DbContext,
        caseId: string,
        change: { payment: PaymentFacts; action: PaymentChange; data: Record<string, unknown> },
        language: string
    ): Promise<void>;
}

export const FEE_CASE_PORT = Symbol('fees.case-port');
