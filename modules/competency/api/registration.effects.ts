/**
 * The effects the new vehicle registration service's workflow names (task 1.2b, DVC-01). Each runs inside the transition's
 * transaction; one that fails undoes the step. The rules are in VehicleRegistrationService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { REGISTRATION_EFFECTS as R } from '../contracts';
import type { CasePlace } from './licences.service';
import { VehicleRegistrationService, type RegistrationInput } from './registration.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the registration effects read from the request form (a service version may map these to other form keys). */
export const REGISTRATION_REQUEST = {
    // each row holds one owner: a person or an organisation (the effect refuses any other row)
    owners: { kind: 'rows' },
    chassisNumber: { kind: 'text' },
    chassisKind: { kind: 'choice', required: false },
    // the officer has checked the chassis plate, and a binding check digit that does not match is recorded as a mismatch
    chassisMismatchConfirmed: { kind: 'boolean', required: false },
    engineNumber: { kind: 'text', required: false },
    make: { kind: 'text' },
    model: { kind: 'text' },
    modelYear: { kind: 'number' },
    categoryKey: { kind: 'choice' },
    use: { kind: 'choice' },
    seats: { kind: 'number', required: false },
    loadCapacityKg: { kind: 'number', required: false },
    grossWeightKg: { kind: 'number', required: false },
    engineCc: { kind: 'number', required: false },
    axles: { kind: 'number', required: false },
    colour: { kind: 'text', required: false },
    fuel: { kind: 'choice', required: false },
    // the temporary libre's other facts (task 1.2d); the size in metres, as the papers give it
    madeIn: { kind: 'text', required: false },
    engineHp: { kind: 'number', required: false },
    cylinders: { kind: 'number', required: false },
    lengthM: { kind: 'number', required: false },
    widthM: { kind: 'number', required: false },
    heightM: { kind: 'number', required: false },
    tyreSize: { kind: 'text', required: false },
    tyres: { kind: 'number', required: false },
    netWeightKg: { kind: 'number', required: false }
} as const;

@Injectable()
@Effect(R.checkVehicleRegistration, { input: REGISTRATION_REQUEST })
export class CheckVehicleRegistrationEffect implements WorkflowEffect<RegistrationInput> {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun<RegistrationInput>) {
        return { facts: await this.registration.check(run.tx, placeOf(run), run.input) };
    }
}

@Injectable()
@Effect(R.reserveRegistrationPlate)
export class ReserveRegistrationPlateEffect implements WorkflowEffect {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun) {
        return { facts: await this.registration.reservePlate(run.tx, placeOf(run)) };
    }
}

/** The officer's step: its answers carry the federal vehicle id. */
@Injectable()
@Effect(R.recordFederalVehicleId)
export class RecordFederalVehicleIdEffect implements WorkflowEffect {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun) {
        return { facts: await this.registration.recordFederalId(run.tx, placeOf(run), run.facts, run.input) };
    }
}

@Injectable()
@Effect(R.registerVehicle, { givesService: true, input: REGISTRATION_REQUEST })
export class RegisterVehicleEffect implements WorkflowEffect<RegistrationInput> {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun<RegistrationInput>) {
        return { facts: await this.registration.register(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/** The officer's step: its answers may name the plate handed over when it is not the reserved one. */
@Injectable()
@Effect(R.assignRegistrationPlate, { givesService: true })
export class AssignRegistrationPlateEffect implements WorkflowEffect {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun) {
        return { facts: await this.registration.assignPlate(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/**
 * `competency.issueLibre:<template>`: the libre, with no number until its booklet, and its registration certificate (the
 * temporary libre, ADR-0050); the template `vehicle-registration-certificate` when none is named.
 */
@Injectable()
@Effect(R.issueLibre, { givesService: true })
export class IssueLibreEffect implements WorkflowEffect {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun) {
        return { facts: await this.registration.issueLibre(run.tx, placeOf(run), run.facts, run.argument) };
    }
}

/** The officer's step: the federal booklet from the office's stationery, the booklets spoiled on the way, the national reference. */
@Injectable()
@Effect(R.issueLibreBooklet, { givesService: true })
export class IssueLibreBookletEffect implements WorkflowEffect {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun) {
        return { facts: await this.registration.issueBooklet(run.tx, placeOf(run), run.facts, run.input) };
    }
}

@Injectable()
@Effect(R.releaseRegistrationPlate)
export class ReleaseRegistrationPlateEffect implements WorkflowEffect {
    constructor(@Inject(VehicleRegistrationService) private readonly registration: VehicleRegistrationService) {}

    async run(run: EffectRun) {
        await this.registration.releasePlate(run.tx, placeOf(run));
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const REGISTRATION_EFFECTS = [
    CheckVehicleRegistrationEffect,
    ReserveRegistrationPlateEffect,
    RecordFederalVehicleIdEffect,
    RegisterVehicleEffect,
    AssignRegistrationPlateEffect,
    IssueLibreEffect,
    IssueLibreBookletEffect,
    ReleaseRegistrationPlateEffect
] as const;
