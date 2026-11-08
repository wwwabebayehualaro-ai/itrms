/**
 * The effects a licence service's workflow names (task 0.24a). Each runs inside the transition's transaction; one that fails undoes
 * the step. The rules are in LicencesService.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import { ConflictError } from '@itrms/kernel/errors';

import { COMPETENCY_EFFECTS } from '../contracts';
import { LicencesService, type CasePlace } from './licences.service';

const placeOf = (run: EffectRun<unknown>): CasePlace => ({
    caseId: run.caseId,
    regionId: run.regionId,
    handlingUnitId: run.handlingUnitId,
    ctx: run.ctx
});

interface ApplicationInput {
    person: string;
    grade: string;
    educationGrade: number;
    school: string;
    medicalFacility: string;
    medicalExaminedOn: string;
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.checkApplication, {
    input: {
        person: { kind: 'ref' },
        grade: { kind: 'choice' },
        educationGrade: { kind: 'number' },
        school: { kind: 'ref' },
        medicalFacility: { kind: 'text' },
        medicalExaminedOn: { kind: 'ethdate' }
    }
})
export class CheckApplicationEffect implements WorkflowEffect<ApplicationInput> {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun<ApplicationInput>) {
        return { facts: await this.licences.checkApplication(run.tx, placeOf(run), run.input) };
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.createPendingLicence, { input: { person: { kind: 'ref' }, grade: { kind: 'choice' } } })
export class CreatePendingLicenceEffect implements WorkflowEffect<{ person: string; grade: string }> {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun<{ person: string; grade: string }>) {
        return { facts: await this.licences.createPending(run.tx, placeOf(run), run.input) };
    }
}

/** An examiner's step: its answers are the result, and whose it is comes from the case's facts or its request. */
@Injectable()
@Effect(COMPETENCY_EFFECTS.recordExam)
export class RecordExamEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        const person = run.facts.personId;
        if (typeof person !== 'string')
            throw new ConflictError('contract_unmet', { detailKey: 'competency.errors.exam_owner_unknown' });
        return { facts: await this.licences.recordExam(run.tx, placeOf(run), person, run.input, run.argument) };
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.activateLicence, { givesService: true })
export class ActivateLicenceEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        return { facts: await this.licences.activate(run.tx, placeOf(run), run.facts, run.input) };
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.voidPendingLicence)
export class VoidPendingLicenceEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        return { facts: await this.licences.voidPending(run.tx, run.facts, run.input) };
    }
}

interface RenewalInput {
    licence: string;
    medicalFacility: string;
    medicalExaminedOn: string;
    /** what the request's fee was worked out from, where its form asks: checked against the register */
    grade?: string;
    expiry?: string;
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.checkRenewal, {
    input: {
        licence: { kind: 'ref' },
        medicalFacility: { kind: 'text' },
        medicalExaminedOn: { kind: 'ethdate' },
        grade: { kind: 'choice', required: false },
        expiry: { kind: 'ethdate', required: false }
    }
})
export class CheckRenewalEffect implements WorkflowEffect<RenewalInput> {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun<RenewalInput>) {
        return { facts: await this.licences.checkRenewal(run.tx, placeOf(run), run.input) };
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.requestRenewal)
export class RequestRenewalEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        await this.licences.requestRenewal(run.tx, placeOf(run), run.facts);
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.renewLicence, { givesService: true })
export class RenewLicenceEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        return { facts: await this.licences.renew(run.tx, placeOf(run), run.facts, run.input) };
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.issueLicenceCard, { givesService: true })
export class IssueLicenceCardEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        return { facts: await this.licences.issueCard(run.tx, placeOf(run), run.facts) };
    }
}

@Injectable()
@Effect(COMPETENCY_EFFECTS.addToPrintBatch, { givesService: true })
export class AddToPrintBatchEffect implements WorkflowEffect {
    constructor(@Inject(LicencesService) private readonly licences: LicencesService) {}

    async run(run: EffectRun) {
        return { facts: await this.licences.addToPrintBatch(run.tx, placeOf(run), run.facts) };
    }
}

/** Every effect of the slice, for its module and for the slice's `effects` list. */
export const LICENCE_EFFECTS = [
    CheckApplicationEffect,
    CreatePendingLicenceEffect,
    RecordExamEffect,
    ActivateLicenceEffect,
    VoidPendingLicenceEffect,
    CheckRenewalEffect,
    RequestRenewalEffect,
    RenewLicenceEffect,
    IssueLicenceCardEffect,
    AddToPrintBatchEffect
] as const;
