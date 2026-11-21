/**
 * The effects the licence replacement's workflow names (DVC-19, task 1.6e). Each runs inside the transition's transaction; one that
 * fails undoes the step. The rules are in LicenceReplacementService; the card is LicencesService's.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { LICENCE_REPLACEMENT_EFFECTS as L, type LicenceReplacementInput } from '../contracts';
import { LicenceReplacementService } from './licence-replacement.service';
import { LicencesService, type CasePlace } from './licences.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the check reads from the request form: the police letter for a card that is gone, the old card for one in hand. */
const REQUEST = {
    licence: { kind: 'ref' },
    reason: { kind: 'choice' },
    policeReport: { kind: 'files', required: false },
    oldCardHandedIn: { kind: 'boolean', required: false }
} as const;

@Injectable()
@Effect(L.checkLicenceReplacement, { input: REQUEST })
export class CheckLicenceReplacementEffect implements WorkflowEffect<LicenceReplacementInput> {
    constructor(@Inject(LicenceReplacementService) private readonly replacements: LicenceReplacementService) {}

    async run(run: EffectRun<LicenceReplacementInput>) {
        return { facts: await this.replacements.check(run.tx, placeOf(run), run.input) };
    }
}

/** The card issued again with the licence's number: the old card document superseded, its QR says so. */
@Injectable()
@Effect(L.replaceLicenceCard, { givesService: true })
export class ReplaceLicenceCardEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        return { facts: await this.licences.issueCard(run.tx, placeOf(run), run.facts, { replace: true }) };
    }
}

export const LICENCE_REPLACEMENT_EFFECTS_LIST = [CheckLicenceReplacementEffect, ReplaceLicenceCardEffect] as const;
