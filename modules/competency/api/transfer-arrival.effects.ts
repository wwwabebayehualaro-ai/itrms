/**
 * The effects the arrival service's workflow names (task 1.4c3, DVC-17, ADR-0060). Each runs inside the transition's transaction; one
 * that fails undoes the step. The rules are in TransferArrivalService. The plate step is the registration's effects
 * (`competency.reserveRegistrationPlate`, `assignRegistrationPlate`, `releaseRegistrationPlate`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { TRANSFER_ARRIVAL_EFFECTS as A } from '../contracts';
import type { CasePlace } from './licences.service';
import { REGISTRATION_REQUEST } from './registration.effects';
import { TransferArrivalService, type TransferArrivalInput } from './transfer-arrival.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/**
 * What the arrival effects read from the request form: the vehicle's facts as a registration's, and the document's. The document's
 * scan is required, so an arrival is never without the paper the officer checked. The tick that the officer checked the document is
 * read as it stands and refused unticked by the service, at its own field.
 */
export const ARRIVAL_REQUEST = {
    ...REGISTRATION_REQUEST,
    firstRegisteredOn: { kind: 'ethdate' },
    ownersSince: { kind: 'ethdate', required: false },
    federalVehicleId: { kind: 'text', required: false },
    plate: { kind: 'text' },
    takesNationalPlate: { kind: 'boolean', required: false },
    libreNumber: { kind: 'text' },
    libreIssuedOn: { kind: 'ethdate' },
    boloValidUntil: { kind: 'ethdate', required: false },
    transferDocumentNumber: { kind: 'text' },
    issuingRegion: { kind: 'text' },
    issuingOffice: { kind: 'text' },
    documentDate: { kind: 'ethdate' },
    documentValidUntil: { kind: 'ethdate' },
    documentVerified: { kind: 'boolean', required: false },
    verifiedHow: { kind: 'choice' },
    holdsListed: { kind: 'boolean', required: false },
    holdsNote: { kind: 'text', required: false },
    transferDocumentScan: { kind: 'files' }
} as const;

@Injectable()
@Effect(A.checkTransferArrival, { input: ARRIVAL_REQUEST })
export class CheckTransferArrivalEffect implements WorkflowEffect<TransferArrivalInput> {
    constructor(@Inject(TransferArrivalService) private readonly arrivals: TransferArrivalService) {}

    async run(run: EffectRun<TransferArrivalInput>) {
        return { facts: await this.arrivals.check(run.tx, placeOf(run), run.input, run.facts) };
    }
}

/** The giving step: the vehicle joins the register on its document. */
@Injectable()
@Effect(A.registerArrival, { givesService: true, input: ARRIVAL_REQUEST })
export class RegisterArrivalEffect implements WorkflowEffect<TransferArrivalInput> {
    constructor(@Inject(TransferArrivalService) private readonly arrivals: TransferArrivalService) {}

    async run(run: EffectRun<TransferArrivalInput>) {
        return { facts: await this.arrivals.register(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/** The registration certificate this office issues for the vehicle's libre. */
@Injectable()
@Effect(A.issueArrivalCertificate, { givesService: true, requiresBefore: [A.registerArrival] })
export class IssueArrivalCertificateEffect implements WorkflowEffect {
    constructor(@Inject(TransferArrivalService) private readonly arrivals: TransferArrivalService) {}

    async run(run: EffectRun) {
        return { facts: await this.arrivals.issueCertificate(run.tx, placeOf(run), run.facts) };
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const TRANSFER_ARRIVAL_EFFECTS_LIST = [
    CheckTransferArrivalEffect,
    RegisterArrivalEffect,
    IssueArrivalCertificateEffect
] as const;
