/**
 * The effects of a renewal's medical examination (task 1.6a): each runs inside the transition's transaction, on the step's
 * answers. The rules are in MedicalReportService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { MEDICAL_EFFECTS } from '../contracts';
import type { CasePlace } from './licences.service';
import { MedicalReportService } from './medical-report.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** The referral step: the letter to the facility it names. */
@Injectable()
@Effect(MEDICAL_EFFECTS.issueMedicalReferral)
export class IssueMedicalReferralEffect implements WorkflowEffect {
    constructor(@Inject(MedicalReportService) private readonly medical: MedicalReportService) {}

    async run(run: EffectRun) {
        return {
            facts: await this.medical.issueReferral(run.tx, placeOf(run), run.facts, run.input, run.caseNumber)
        };
    }
}

/** The report step: `:fit` on the way on, `:unfit` back to a referral or a rejection. */
@Injectable()
@Effect(MEDICAL_EFFECTS.recordMedicalReport, { argument: { values: ['fit', 'unfit'] } })
export class RecordMedicalReportEffect implements WorkflowEffect {
    constructor(@Inject(MedicalReportService) private readonly medical: MedicalReportService) {}

    async run(run: EffectRun) {
        return { facts: await this.medical.recordReport(run.tx, placeOf(run), run.facts, run.input, run.argument) };
    }
}

export const MEDICAL_EFFECTS_LIST = [IssueMedicalReferralEffect, RecordMedicalReportEffect] as const;
