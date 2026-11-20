/**
 * The effects the paper licence back-capture's workflow names (MIG-02, ADR-0054, task 1.6b). Each runs inside the transition's
 * transaction; one that fails undoes the step. The rules are in LicenceCaptureService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { LICENCE_CAPTURE_EFFECTS as L, type LicenceCaptureInput } from '../contracts';
import { LicenceCaptureService } from './licence-capture.service';
import type { CasePlace } from './licences.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the capture's effects read from the request form. The scan is required: the second person checks against it. */
const REQUEST = {
    paperReference: { kind: 'text' },
    paperFileScan: { kind: 'files' },
    person: { kind: 'ref' },
    number: { kind: 'text' },
    cardSerial: { kind: 'text', required: false },
    kind: { kind: 'choice' },
    issuedOn: { kind: 'ethdate' },
    validUntil: { kind: 'ethdate' },
    issuedBy: { kind: 'text', required: false },
    // each row is one grade the paper licence carries, and since when it is permanent when the paper says
    grades: { kind: 'rows' }
} as const;

@Injectable()
@Effect(L.checkLicenceCapture, { input: REQUEST })
export class CheckLicenceCaptureEffect implements WorkflowEffect<LicenceCaptureInput> {
    constructor(@Inject(LicenceCaptureService) private readonly capture: LicenceCaptureService) {}

    async run(run: EffectRun<LicenceCaptureInput>) {
        return { facts: await this.capture.check(run.tx, placeOf(run), run.input) };
    }
}

/** The second person's step: the licence joins the register as printed, marked as migrated and verified by them. */
@Injectable()
@Effect(L.captureLicence, { givesService: true, input: REQUEST })
export class CaptureLicenceEffect implements WorkflowEffect<LicenceCaptureInput> {
    constructor(@Inject(LicenceCaptureService) private readonly capture: LicenceCaptureService) {}

    async run(run: EffectRun<LicenceCaptureInput>) {
        return { facts: await this.capture.capture(run.tx, placeOf(run), run.input) };
    }
}

/** The second person's other step: a number that cannot be kept is flagged to the bureau, never renumbered. */
@Injectable()
@Effect(L.flagLicenceNumber, { input: REQUEST })
export class FlagLicenceNumberEffect implements WorkflowEffect<LicenceCaptureInput> {
    constructor(@Inject(LicenceCaptureService) private readonly capture: LicenceCaptureService) {}

    async run(run: EffectRun<LicenceCaptureInput>) {
        return { facts: await this.capture.flag(run.tx, placeOf(run), run.input, run.facts) };
    }
}

export const LICENCE_CAPTURE_EFFECTS_LIST = [
    CheckLicenceCaptureEffect,
    CaptureLicenceEffect,
    FlagLicenceNumberEffect
] as const;
