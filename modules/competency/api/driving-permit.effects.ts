/**
 * The effect a licence service's workflow names to give the temporary driving permit while the region prints (ADR-0064 §7, task
 * 1.6d): after the card is issued and sent to print, on the same step. The rules are in DrivingPermitService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { DRIVING_PERMIT_EFFECTS } from '../contracts';
import { DrivingPermitService } from './driving-permit.service';

@Injectable()
@Effect(DRIVING_PERMIT_EFFECTS.issueDrivingPermit)
export class IssueDrivingPermitEffect implements WorkflowEffect {
    constructor(@Inject(DrivingPermitService) private readonly permits: DrivingPermitService) {}

    async run(run: EffectRun) {
        return {
            facts: await this.permits.issue(
                run.tx,
                { caseId: run.caseId, regionId: run.regionId, handlingUnitId: run.handlingUnitId, ctx: run.ctx },
                run.caseNumber,
                run.facts
            )
        };
    }
}

export const DRIVING_PERMIT_EFFECTS_LIST = [IssueDrivingPermitEffect] as const;
