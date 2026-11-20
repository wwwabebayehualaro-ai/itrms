/**
 * The effects the suspension and cancellation record's workflow names (DVC-21, ADR-0064 §6, task 1.6c). Each runs inside the
 * transition's transaction; one that fails undoes the step. The rules are in LicenceRestrictionService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { LICENCE_RESTRICTION_EFFECTS as L, type LicenceRestrictionInput } from '../contracts';
import { LicenceRestrictionService } from './licence-restriction.service';
import type { CasePlace } from './licences.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the record's effects read from the request form. The decision's scan is required: the second person checks against it. */
const REQUEST = {
    licence: { kind: 'ref' },
    kind: { kind: 'choice' },
    authority: { kind: 'choice' },
    authorityReference: { kind: 'text' },
    decidedOn: { kind: 'ethdate' },
    startsOn: { kind: 'ethdate' },
    endsOn: { kind: 'ethdate', required: false },
    decisionScan: { kind: 'files' }
} as const;

@Injectable()
@Effect(L.checkLicenceRestriction, { input: REQUEST })
export class CheckLicenceRestrictionEffect implements WorkflowEffect<LicenceRestrictionInput> {
    constructor(@Inject(LicenceRestrictionService) private readonly restrictions: LicenceRestrictionService) {}

    async run(run: EffectRun<LicenceRestrictionInput>) {
        return { facts: await this.restrictions.check(run.tx, placeOf(run), run.input) };
    }
}

/** The second person's step: the restriction joins the register; a cancellation ends the licence and revokes its card. */
@Injectable()
@Effect(L.recordLicenceRestriction, { givesService: true, input: REQUEST })
export class RecordLicenceRestrictionEffect implements WorkflowEffect<LicenceRestrictionInput> {
    constructor(@Inject(LicenceRestrictionService) private readonly restrictions: LicenceRestrictionService) {}

    async run(run: EffectRun<LicenceRestrictionInput>) {
        return { facts: await this.restrictions.record(run.tx, placeOf(run), run.input, run.facts) };
    }
}

export const LICENCE_RESTRICTION_EFFECTS_LIST = [
    CheckLicenceRestrictionEffect,
    RecordLicenceRestrictionEffect
] as const;
