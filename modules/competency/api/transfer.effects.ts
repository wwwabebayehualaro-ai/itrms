/**
 * The effects the ownership transfer's workflow names (task 1.4b, DVC-13). Each runs inside the transition's transaction; one that
 * fails undoes the step. The rules are in OwnershipTransferService; whether the vehicle is encumbered is the vehicles slice's check
 * (`vehicles.checkEncumbrances:ownership-transfer`), named beside these.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';

import { TRANSFER_EFFECTS as X } from '../contracts';
import type { CasePlace } from './licences.service';
import { OwnershipTransferService, type TransferInput } from './transfer.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

/** What the check reads from the request form: the vehicle, its buyers (one person or organisation a row) and how they got it. */
const REQUEST = {
    vehicle: { kind: 'ref' },
    owners: { kind: 'rows' },
    acquiredBy: { kind: 'choice' }
} as const;

@Injectable()
@Effect(X.checkOwnershipTransfer, { input: REQUEST })
export class CheckOwnershipTransferEffect implements WorkflowEffect<TransferInput> {
    constructor(@Inject(OwnershipTransferService) private readonly transfer: OwnershipTransferService) {}

    async run(run: EffectRun<TransferInput>) {
        return { facts: await this.transfer.check(run.tx, placeOf(run), run.input, run.facts) };
    }
}

/** The inspector's step: its answers carry the committee's valuation. */
@Injectable()
@Effect(X.recordValuation)
export class RecordValuationEffect implements WorkflowEffect {
    constructor(@Inject(OwnershipTransferService) private readonly transfer: OwnershipTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfer.recordValuation(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/** The officer's step: its answers name the offices the letters go to. */
@Injectable()
@Effect(X.issueTransferLetters)
export class IssueTransferLettersEffect implements WorkflowEffect {
    constructor(@Inject(OwnershipTransferService) private readonly transfer: OwnershipTransferService) {}

    async run(run: EffectRun) {
        return {
            facts: await this.transfer.issueLetters(run.tx, placeOf(run), run.facts, run.input, run.caseNumber)
        };
    }
}

/** The officer's step: its answers carry the papers that came back from the other offices. */
@Injectable()
@Effect(X.recordTransferEvidence)
export class RecordTransferEvidenceEffect implements WorkflowEffect {
    constructor(@Inject(OwnershipTransferService) private readonly transfer: OwnershipTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfer.recordEvidence(run.tx, placeOf(run), run.facts, run.input) };
    }
}

/**
 * `competency.transferOwnership:<template>`: the owners change in the register and the new libre is issued, with its
 * registration certificate on the template named (`vehicle-registration-certificate` when none is).
 */
@Injectable()
@Effect(X.transferOwnership, { givesService: true })
export class TransferOwnershipEffect implements WorkflowEffect {
    constructor(@Inject(OwnershipTransferService) private readonly transfer: OwnershipTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfer.transfer(run.tx, placeOf(run), run.facts, run.argument) };
    }
}

@Injectable()
@Effect(X.revokeTransferLetters)
export class RevokeTransferLettersEffect implements WorkflowEffect {
    constructor(@Inject(OwnershipTransferService) private readonly transfer: OwnershipTransferService) {}

    async run(run: EffectRun) {
        return { facts: await this.transfer.revokeLetters(run.tx, placeOf(run)) };
    }
}

/** Every effect of the service, for the module and for the slice's `effects` list. */
export const TRANSFER_EFFECTS_LIST = [
    CheckOwnershipTransferEffect,
    RecordValuationEffect,
    IssueTransferLettersEffect,
    RecordTransferEvidenceEffect,
    TransferOwnershipEffect,
    RevokeTransferLettersEffect
] as const;
