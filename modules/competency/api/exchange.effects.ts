/**
 * The effects the plate exchange's workflow names (task 1.2c, DVC-12). Each runs inside the transition's transaction; one that
 * fails undoes the step. The rules are in PlateExchangeService; the plate is held and released by the registration's effects.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { EXCHANGE_EFFECTS as X } from '../contracts';
import { PlateExchangeService, type ExchangeInput } from './exchange.service';
import type { CasePlace } from './licences.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the check reads from the request form: the vehicle picked from the register, and the use the fee was worked out from. */
const REQUEST = {
    vehicle: { kind: 'ref' },
    use: { kind: 'choice' }
} as const;

@Injectable()
@Effect(X.checkPlateExchange, { input: REQUEST })
export class CheckPlateExchangeEffect implements WorkflowEffect<ExchangeInput> {
    constructor(@Inject(PlateExchangeService) private readonly exchange: PlateExchangeService) {}

    async run(run: EffectRun<ExchangeInput>) {
        return { facts: await this.exchange.check(run.tx, placeOf(run), run.input) };
    }
}

/** The officer's step: its answers carry the federal vehicle id, and the plate handed over if not the held one. */
@Injectable()
@Effect(X.exchangePlate, { givesService: true })
export class ExchangePlateEffect implements WorkflowEffect {
    constructor(@Inject(PlateExchangeService) private readonly exchange: PlateExchangeService) {}

    async run(run: EffectRun) {
        return { facts: await this.exchange.exchange(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const EXCHANGE_EFFECTS = [CheckPlateExchangeEffect, ExchangePlateEffect] as const;
