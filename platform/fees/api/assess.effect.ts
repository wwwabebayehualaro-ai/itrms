/**
 * `fees.assess` (task 0.22a): named on a workflow's transitions that change the request (`amendsRequest`), it works the
 * case's fee out again over the corrected answers. The transition runs it after the change, in its transaction; a fee
 * that cannot be worked out refuses the transition. It reads no input contract: its inputs are the fee rule's, kept with
 * the case's first assessment. A case past its payment step keeps its order in step (task 0.22b): an open order for a
 * changed fee is issued again; a paid one refuses the change (its receipt is reversed first); a fee that was nothing and
 * now is something gets its first order, and the case is no longer settled.
 */
import { Inject, Injectable } from '@nestjs/common';
import { currentContext } from '@itrms/kernel/context';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { FEE_ASSESS_EFFECT } from '../contracts';
import { FeesService } from './fees.service';
import { PaymentOrdersService } from './payment-orders.service';

@Injectable()
@Effect(FEE_ASSESS_EFFECT)
export class AssessFeeEffect implements WorkflowEffect {
    constructor(
        @Inject(FeesService) private readonly fees: FeesService,
        @Inject(PaymentOrdersService) private readonly orders: PaymentOrdersService
    ) {}

    async run({ tx, caseId, caseNumber, regionId, handlingUnitId, config, facts: known }: EffectRun) {
        const fee = await this.fees.reassess(tx, caseId, handlingUnitId, currentContext()?.language ?? 'am');
        if (!fee) return undefined;
        const facts: Record<string, unknown> = { fee: { id: fee.id, totalSantim: fee.totalSantim } };
        // a fee of nothing has no order to find, only the fact
        if (known.payment !== undefined || (await this.orders.live(tx, caseId)))
            facts.payment = await this.orders.followFee(tx, { caseId, caseNumber, regionId, handlingUnitId, config });
        return { facts };
    }
}
