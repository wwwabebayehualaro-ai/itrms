/**
 * The effect a service's workflow names to refuse itself while the vehicle is encumbered (task 1.4a). The argument after the colon
 * is the conflict (`vehicles.checkEncumbrances:ownership-transfer`); the kinds that block it are the setting
 * `vehicles.encumbrance_blocks`. It reads the vehicle the request names and writes nothing, so a service names it on filing, on the
 * step that creates the payment order and before the step that gives the result: a hold recorded in between still stops it.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { ENCUMBRANCE_CONFLICTS, ENCUMBRANCE_EFFECTS as X } from '../contracts';
import { EncumbranceService } from './encumbrances.service';

@Injectable()
@Effect(X.checkEncumbrances, {
    input: { vehicle: { kind: 'ref' } },
    argument: { values: ENCUMBRANCE_CONFLICTS, required: true }
})
export class CheckEncumbrancesEffect implements WorkflowEffect<{ vehicle: string }> {
    constructor(@Inject(EncumbranceService) private readonly encumbrances: EncumbranceService) {}

    async run(run: EffectRun<{ vehicle: string }>) {
        await this.encumbrances.assertClear(run.tx, run.input.vehicle, run.argument ?? '', run.handlingUnitId);
        return {};
    }
}

/** Every effect of the slice, for the module and for the slice's `effects` list. */
export const ENCUMBRANCE_EFFECTS_LIST = [CheckEncumbrancesEffect] as const;
