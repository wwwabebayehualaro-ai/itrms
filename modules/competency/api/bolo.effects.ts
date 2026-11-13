/**
 * The effects the bolo's workflow names (task 1.3a, DVC-02). Each runs inside the transition's transaction; one that fails undoes
 * the step. The rules are in BoloService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { BOLO_EFFECTS as B } from '../contracts';
import { BoloService, type BoloInput } from './bolo.service';
import type { CasePlace } from './licences.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the check reads from the request form: the vehicle, the insurance certificate, and the Road Fund receipt if any. */
const REQUEST = {
    vehicle: { kind: 'ref' },
    use: { kind: 'choice' },
    insuranceCertificate: { kind: 'text' },
    insurer: { kind: 'text' },
    insuredFrom: { kind: 'ethdate' },
    insuredUntil: { kind: 'ethdate' },
    roadFundReceipt: { kind: 'files', required: false }
} as const;

@Injectable()
@Effect(B.checkBolo, { input: REQUEST })
export class CheckBoloEffect implements WorkflowEffect<BoloInput> {
    constructor(@Inject(BoloService) private readonly bolo: BoloService) {}

    async run(run: EffectRun<BoloInput>) {
        return { facts: await this.bolo.check(run.tx, placeOf(run), run.input) };
    }
}

/**
 * `:pass` makes the bolo (refused unless the checklist passed); `:fail` records the failed items. It reads the inspection step's own
 * answers (no contract: a contracted effect reads the request), filed and settled like any form's, so the outcome is the server's.
 */
@Injectable()
@Effect(B.recordBoloInspection)
export class RecordBoloInspectionEffect implements WorkflowEffect {
    constructor(@Inject(BoloService) private readonly bolo: BoloService) {}

    async run(run: EffectRun) {
        const result = run.argument === 'fail' ? 'fail' : 'pass';
        return { facts: await this.bolo.inspect(run.tx, placeOf(run), run.facts, run.input, result) };
    }
}

/** The sticker from the office's stationery, and the bolo document: the service is given. */
@Injectable()
@Effect(B.issueBoloSticker, { givesService: true })
export class IssueBoloStickerEffect implements WorkflowEffect {
    constructor(@Inject(BoloService) private readonly bolo: BoloService) {}

    async run(run: EffectRun) {
        return { facts: await this.bolo.issueSticker(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/** A temporary bolo while the office has no sticker of the vehicle's kind and year. */
@Injectable()
@Effect(B.issueTemporaryBolo)
export class IssueTemporaryBoloEffect implements WorkflowEffect {
    constructor(@Inject(BoloService) private readonly bolo: BoloService) {}

    async run(run: EffectRun) {
        return { facts: await this.bolo.issueTemporary(run.tx, placeOf(run), run.facts, run.config) };
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const BOLO_EFFECTS = [
    CheckBoloEffect,
    RecordBoloInspectionEffect,
    IssueBoloStickerEffect,
    IssueTemporaryBoloEffect
] as const;
