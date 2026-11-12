/**
 * The effects the back-capture service's workflow names (ADR-0054, task 1.13, MIG-01). Each runs inside the transition's
 * transaction; one that fails undoes the step. The rules are in BackCaptureService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { BACK_CAPTURE_EFFECTS as B } from '../contracts';
import { BackCaptureService, type BackCaptureInput } from './back-capture.service';
import type { CasePlace } from './licences.service';
import { REGISTRATION_REQUEST } from './registration.effects';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/**
 * What the back-capture effects read from the request form: the vehicle's facts as a registration's (no mismatch box: a paper
 * file's check digit is kept as it is), and the paper file's own. The scan is required, so a capture is never without its paper.
 */
const REQUEST = {
    ...Object.fromEntries(Object.entries(REGISTRATION_REQUEST).filter(([key]) => key !== 'chassisMismatchConfirmed')),
    paperReference: { kind: 'text' },
    paperFileScan: { kind: 'files' },
    firstRegisteredOn: { kind: 'ethdate' },
    ownersSince: { kind: 'ethdate', required: false },
    federalVehicleId: { kind: 'text', required: false },
    plate: { kind: 'text' },
    plateSince: { kind: 'ethdate', required: false },
    libreNumber: { kind: 'text', required: false },
    libreIssuedOn: { kind: 'ethdate', required: false }
} as const;

@Injectable()
@Effect(B.checkBackCapture, { input: REQUEST })
export class CheckBackCaptureEffect implements WorkflowEffect<BackCaptureInput> {
    constructor(@Inject(BackCaptureService) private readonly capture: BackCaptureService) {}

    async run(run: EffectRun<BackCaptureInput>) {
        return { facts: await this.capture.check(run.tx, placeOf(run), run.input) };
    }
}

/** The second person's step: the vehicle joins the register, marked as migrated and verified by them. */
@Injectable()
@Effect(B.backCaptureVehicle, { givesService: true, input: REQUEST })
export class BackCaptureVehicleEffect implements WorkflowEffect<BackCaptureInput> {
    constructor(@Inject(BackCaptureService) private readonly capture: BackCaptureService) {}

    async run(run: EffectRun<BackCaptureInput>) {
        return { facts: await this.capture.capture(run.tx, placeOf(run), run.input) };
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const BACK_CAPTURE_EFFECTS = [CheckBackCaptureEffect, BackCaptureVehicleEffect] as const;
