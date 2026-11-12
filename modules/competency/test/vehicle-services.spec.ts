/** The registration service's workflow: what ADR-0042 and the plate's life ask of it, whatever else a bureau changes later. */
import { workflowDefinitionSchema } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import { REGISTRATION_EFFECTS as E } from '../contracts';
import { vehicleRegistrationFlow } from '../seed/vehicle-services';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    on?: string;
    guard?: unknown;
    effects?: readonly string[];
}

const flow = vehicleRegistrationFlow('vehicle-national-entry@1', 'vehicle-libre-booklet@1');
const steps = flow.transitions as readonly Step[];
const PAID = { fact: 'payment.settled', op: 'eq', value: true };

describe('the vehicle registration workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('gives the service only while the fee stands paid (ADR-0042)', () => {
        const giving = [E.registerVehicle, E.assignRegistrationPlate, E.issueLibre, E.issueLibreBooklet];
        const registering = steps.filter((t) => t.effects?.some((e) => giving.some((g) => e.startsWith(g))));
        expect(registering.map((t) => t.to)).toEqual(['booklet', 'registered']);
        for (const t of registering) expect(t.guard).toEqual(PAID);
    });

    it('runs the register steps in their order, issuing the libre and its temporary certificate last', () => {
        const register = steps.find((t) => t.action === 'register');
        expect(register?.effects).toEqual([
            E.recordFederalVehicleId,
            E.registerVehicle,
            E.assignRegistrationPlate,
            `${E.issueLibre}:vehicle-registration-certificate`
        ]);
    });

    it('ends with the federal booklet from stock, on its own step a case can wait in, and never rejected there (ADR-0050)', () => {
        const booklet = flow.states.find((s) => s.key === 'booklet') as { stepForm?: string } | undefined;
        expect(booklet?.stepForm).toBe('vehicle-libre-booklet@1');
        const issue = steps.filter((t) => t.from === 'booklet');
        expect(issue.map((t) => [t.action, t.to, t.effects])).toEqual([
            ['issue_booklet', 'registered', [E.issueLibreBooklet]],
            // a vehicle that left the register meanwhile: closed with the reason, taking nothing
            ['close_without_booklet', 'registered', undefined]
        ]);
    });

    it('holds the plate at the final approval and gives it back whenever a case is rejected', () => {
        expect(steps.find((t) => t.from === 'approval' && t.action === 'approve')?.effects).toContain(
            E.reserveRegistrationPlate
        );
        const rejections = steps.filter((t) => t.action === 'reject');
        expect(rejections).toHaveLength(1);
        expect(rejections[0]?.from).toEqual(['review', 'approval', 'registration']);
        expect(rejections[0]?.effects).toContain(E.releaseRegistrationPlate);
    });

    it('checks the request when it is filed and when it is corrected', () => {
        const filing = steps.filter((t) => t.from === 'draft' && t.to === 'review');
        expect(filing.map((t) => t.action).sort()).toEqual(['correct', 'submit']);
        for (const t of filing) expect(t.effects).toContain(E.checkVehicleRegistration);
    });

    it('keeps whoever filed or checked a case off its final approval, and the approver off the registration', () => {
        const approval = flow.states.find((s) => s.key === 'approval') as { separationOfDuties: string[] } | undefined;
        const registration = flow.states.find((s) => s.key === 'registration') as
            { separationOfDuties: string[] } | undefined;
        expect(approval?.separationOfDuties.sort()).toEqual(['draft', 'review']);
        expect(registration?.separationOfDuties).toEqual(['approval']);
    });

    it('lets a draft be withdrawn, and closes a fee never paid', () => {
        expect(steps.some((t) => t.from === 'draft' && t.action === 'withdraw')).toBe(true);
        expect(steps.some((t) => t.from === 'payment' && t.on === 'timeout' && t.to === 'rejected')).toBe(true);
    });
});
