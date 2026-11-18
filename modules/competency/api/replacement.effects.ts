/**
 * The effects the replacement's workflow names (task 1.5, DVC-06). Each runs inside the transition's transaction; one that fails
 * undoes the step. The rules are in ReplacementService; whether the vehicle is encumbered is the vehicles slice's check
 * (`vehicles.checkEncumbrances:replacement`), named beside the libre's steps and checked at filing by the service for a libre. The
 * plate's effect comes with 1.5c.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import { ENCUMBRANCE_EFFECTS } from '@itrms/vehicles/contracts';

import { REGISTRATION_CERTIFICATE_TEMPLATE, REPLACEMENT_EFFECTS as X } from '../contracts';
import type { CasePlace } from './licences.service';
import { ReplacementService, type ReplacementInput } from './replacement.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the check reads from the request form: the vehicle, what is replaced and why, its use, and the police letter and notice. */
const REQUEST = {
    vehicle: { kind: 'ref' },
    item: { kind: 'choice' },
    reason: { kind: 'choice' },
    use: { kind: 'choice' },
    policeReportReference: { kind: 'text', required: false },
    policeReportOn: { kind: 'ethdate', required: false },
    noticeNewspaper: { kind: 'text', required: false },
    noticePublishedOn: { kind: 'ethdate', required: false },
    oldItemHandedIn: { kind: 'boolean', required: false }
} as const;

@Injectable()
@Effect(X.checkReplacement, { input: REQUEST })
export class CheckReplacementEffect implements WorkflowEffect<ReplacementInput> {
    constructor(@Inject(ReplacementService) private readonly replacement: ReplacementService) {}

    async run(run: EffectRun<ReplacementInput>) {
        return { facts: await this.replacement.check(run.tx, placeOf(run), run.input) };
    }
}

/** The officer's step after the notice period: refused before the day the notice period ends. */
@Injectable()
@Effect(X.checkReplacementNotice)
export class CheckReplacementNoticeEffect implements WorkflowEffect {
    constructor(@Inject(ReplacementService) private readonly replacement: ReplacementService) {}

    async run(run: EffectRun) {
        return { facts: await this.replacement.checkNotice(run.tx, placeOf(run), run.facts) };
    }
}

/**
 * `competency.replaceLibre:<template>`: the libre in force leaves force and the new libre is issued, with its registration
 * certificate on the template named (`vehicle-registration-certificate` when none is).
 */
@Injectable()
// the vehicle's holds are checked in the same transaction, just before: a version without it is not published
@Effect(X.replaceLibre, {
    givesService: true,
    argument: { values: [REGISTRATION_CERTIFICATE_TEMPLATE] },
    requiresBefore: [`${ENCUMBRANCE_EFFECTS.checkEncumbrances}:replacement`]
})
export class ReplaceLibreEffect implements WorkflowEffect {
    constructor(@Inject(ReplacementService) private readonly replacement: ReplacementService) {}

    async run(run: EffectRun) {
        return { facts: await this.replacement.replaceLibre(run.tx, placeOf(run), run.facts, run.argument) };
    }
}

/**
 * The bolo takes a new sticker from the office's stationery and its document is reissued: the service is given. It reads the
 * step's own answers (the serial of the sticker handed over, if not the office's next one), as the bolo's sticker step does.
 */
@Injectable()
@Effect(X.replaceBoloSticker, { givesService: true })
export class ReplaceBoloStickerEffect implements WorkflowEffect {
    constructor(@Inject(ReplacementService) private readonly replacement: ReplacementService) {}

    async run(run: EffectRun) {
        return { facts: await this.replacement.replaceBoloSticker(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const REPLACEMENT_EFFECTS_LIST = [
    CheckReplacementEffect,
    CheckReplacementNoticeEffect,
    ReplaceLibreEffect,
    ReplaceBoloStickerEffect
] as const;
