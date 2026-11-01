/**
 * `fees.assess` (task 0.22a): named on a workflow's transitions that change the request (`amendsRequest`), it works the
 * case's fee out again over the corrected answers. The transition runs it after the change, in its transaction; a fee
 * that cannot be worked out refuses the transition. It reads no input contract: its inputs are the fee rule's, kept with
 * the case's first assessment.
 */
import { Inject, Injectable } from '@nestjs/common';
import { currentContext } from '@itrms/kernel/context';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { FEE_ASSESS_EFFECT } from '../contracts';
import { FeesService } from './fees.service';

@Injectable()
@Effect(FEE_ASSESS_EFFECT)
export class AssessFeeEffect implements WorkflowEffect {
    constructor(@Inject(FeesService) private readonly fees: FeesService) {}

    async run({ tx, caseId }: EffectRun) {
        const fee = await this.fees.reassess(tx, caseId, currentContext()?.language ?? 'am');
        return fee ? { facts: { fee: { id: fee.id, totalSantim: fee.totalSantim } } } : undefined;
    }
}
