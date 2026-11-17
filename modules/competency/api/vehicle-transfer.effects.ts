/**
 * The effects the transfer out (DVC-14) and the transfer in (DVC-15) name (task 1.4c). Each runs inside the transition's
 * transaction; one that fails undoes the step. Whether the vehicle is encumbered is the vehicles slice's check
 * (`vehicles.checkEncumbrances:zone-transfer-out`), named beside these and required just before each giving step.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import { ENCUMBRANCE_EFFECTS } from '@itrms/vehicles/contracts';

import { VEHICLE_TRANSFER_EFFECTS as X } from '../contracts';
import type { CasePlace } from './licences.service';
import { VehicleTransferService, type TransferInInput, type TransferOutInput } from './vehicle-transfer.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

const HOLDS = `${ENCUMBRANCE_EFFECTS.checkEncumbrances}:zone-transfer-out`;

@Injectable()
@Effect(X.checkTransferOut, { input: { vehicle: { kind: 'ref' }, toOffice: { kind: 'ref' } } })
export class CheckTransferOutEffect implements WorkflowEffect<TransferOutInput> {
    constructor(@Inject(VehicleTransferService) private readonly transfers: VehicleTransferService) {}

    async run(run: EffectRun<TransferOutInput>) {
        return { facts: await this.transfers.checkOut(run.tx, placeOf(run), run.input, run.facts) };
    }
}

/** The transfer out's giving step: the vehicle is released to the receiving office. */
@Injectable()
@Effect(X.releaseVehicle, { givesService: true, requiresBefore: [HOLDS] })
export class ReleaseVehicleEffect implements WorkflowEffect {
    constructor(@Inject(VehicleTransferService) private readonly transfers: VehicleTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfers.release(run.tx, placeOf(run), run.facts) };
    }
}

@Injectable()
@Effect(X.checkTransferIn, { input: { vehicle: { kind: 'ref' } } })
export class CheckTransferInEffect implements WorkflowEffect<TransferInInput> {
    constructor(@Inject(VehicleTransferService) private readonly transfers: VehicleTransferService) {}

    async run(run: EffectRun<TransferInInput>) {
        return { facts: await this.transfers.checkIn(run.tx, placeOf(run), run.input, run.facts) };
    }
}

/** The receiving office's inspection, when the setting asks for one: its answers are the step form's. */
@Injectable()
@Effect(X.recordTransferInspection)
export class RecordTransferInspectionEffect implements WorkflowEffect {
    constructor(@Inject(VehicleTransferService) private readonly transfers: VehicleTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfers.recordInspection(run.tx, placeOf(run), run.input) };
    }
}

/** The transfer in's giving step: the vehicle and its live records move to this office. */
@Injectable()
@Effect(X.receiveVehicle, { givesService: true, requiresBefore: [HOLDS] })
export class ReceiveVehicleEffect implements WorkflowEffect {
    constructor(@Inject(VehicleTransferService) private readonly transfers: VehicleTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfers.receive(run.tx, placeOf(run), run.facts) };
    }
}

/** Every effect of the two services, for the module and for the slice's `effects` list. */
export const VEHICLE_TRANSFER_EFFECTS_LIST = [
    CheckTransferOutEffect,
    ReleaseVehicleEffect,
    CheckTransferInEffect,
    RecordTransferInspectionEffect,
    ReceiveVehicleEffect
] as const;
