/** The arriving vehicle's workflow, form and fee (task 1.4c3, DVC-17, ADR-0060): what the plate step, the guards and the register's command ask of them. */
import { ownershipTransferSchema } from '@itrms/vehicles/contracts';
import { workflowDefinitionSchema } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import { REGISTRATION_EFFECTS as R, TRANSFER_ARRIVAL_EFFECTS as A } from '../contracts';
import { ARRIVAL_PLATE_FORM, TRANSFER_ARRIVAL_FORM, transferArrivalFlow } from '../seed/vehicle-arrival-service';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    effects?: readonly string[];
    guard?: unknown;
}
interface State {
    key: string;
    separationOfDuties?: string[];
    assignee?: { role: string };
}
interface Field {
    id: string;
    type: string;
    classification?: string;
    props?: Record<string, unknown>;
}

const flow = transferArrivalFlow('inspection@1', 'plate@1');
const steps = flow.transitions as readonly Step[];
const state = (key: string) => flow.states.find((s) => s.key === key) as State | undefined;
const fields = TRANSFER_ARRIVAL_FORM.fields as readonly Field[];

describe('the arrival workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('checks the document when it is filed, corrected and at every step that moves on', () => {
        const checked = steps.filter((t) => t.effects?.includes(A.checkTransferArrival));
        expect(checked.map((t) => `${String(t.from)}>${t.to}`)).toEqual([
            'draft>review',
            'draft>review',
            'review>inspection',
            'review>payment',
            'approval>arrival',
            'approval>arrival',
            'arrival>registered',
            'arrival>registered'
        ]);
    });

    it('goes to the inspection first only when the case asks for it, then to payment', () => {
        const fromReview = steps.filter((t) => t.from === 'review' && t.action === 'approve');
        expect(fromReview.map((t) => t.to)).toEqual(['inspection', 'payment']);
        expect(fromReview[0]?.guard).toMatchObject({ fact: 'transferArrival.reinspect' });
        expect(fromReview[1]?.guard).toBeUndefined();
    });

    it('holds the plate at the approval and puts it on at the registration only when the plate is exchanged, the exchange first', () => {
        const approve = steps.filter((t) => t.from === 'approval' && t.to === 'arrival');
        expect(approve[0]?.effects).toContain(R.reserveRegistrationPlate);
        expect(JSON.stringify(approve[0]?.guard)).toContain('"transferArrival.plateExchange"');
        expect(JSON.stringify(approve[1]?.guard)).not.toContain('plateExchange');
        expect(approve[1]?.effects).not.toContain(R.reserveRegistrationPlate);
        const register = steps.filter((t) => t.from === 'arrival' && t.action === 'register');
        expect(register[0]?.effects).toEqual([
            A.checkTransferArrival,
            A.registerArrival,
            R.assignRegistrationPlate,
            A.issueArrivalCertificate
        ]);
        expect(register[1]?.effects).toEqual([A.checkTransferArrival, A.registerArrival, A.issueArrivalCertificate]);
        // every giving step waits for the payment
        for (const t of register) expect(JSON.stringify(t.guard)).toContain('payment.settled');
    });

    it('is approved by a lead who is neither the filer, the checker nor the inspector, and registered by an officer who did not approve', () => {
        expect(state('approval')?.assignee?.role).toBe('competency.lead');
        expect(state('approval')?.separationOfDuties).toEqual(['draft', 'review', 'inspection']);
        expect(state('inspection')?.separationOfDuties).toEqual(['draft']);
        expect(state('arrival')?.separationOfDuties).toEqual(['approval']);
        expect(state('arrival')?.assignee?.role).toBe('competency.officer');
    });

    it('gives a rejected case’s plate back from every step that may hold it, and may be withdrawn', () => {
        const reject = steps.find((t) => t.action === 'reject');
        expect(reject?.from).toEqual(['review', 'inspection', 'approval', 'arrival']);
        expect(reject?.effects).toEqual([R.releaseRegistrationPlate]);
        expect(steps.some((t) => t.action === 'withdraw')).toBe(true);
    });
});

describe('the arrival form', () => {
    const field = (id: string) => fields.find((f) => f.id === id);

    it('asks for the document, its scan and the libre, and classifies the document’s facts as internal', () => {
        for (const id of [
            'transferDocumentNumber',
            'issuingRegion',
            'issuingOffice',
            'documentDate',
            'documentValidUntil',
            'verifiedHow',
            'libreNumber',
            'plate'
        ])
            expect(field(id)?.props?.required, id).toBe(true);
        expect(field('transferDocumentScan')).toMatchObject({ type: 'FileUpload', props: { required: true } });
        expect(field('takesNationalPlate')).toMatchObject({ type: 'Checkbox' });
        for (const id of [
            'transferDocumentNumber',
            'issuingRegion',
            'issuingOffice',
            'documentVerified',
            'plate',
            'libreNumber'
        ])
            expect(field(id)?.classification, id).toBe('internal');
        // free text about holds may name a person or a bank: personal, as the scan is
        expect(field('holdsNote')?.classification).toBe('personal');
        expect(field('transferDocumentScan')?.classification).toBe('personal');
    });

    it('takes the vehicle’s facts as a registration does', () => {
        for (const id of ['owners', 'chassisNumber', 'categoryKey', 'use', 'make', 'model', 'modelYear'])
            expect(field(id), id).toBeDefined();
    });

    it('has a plate step that only names another plate, optionally', () => {
        expect((ARRIVAL_PLATE_FORM.fields as readonly Field[]).map((f) => f.id)).toEqual(['replacementPlate']);
        expect(ARRIVAL_PLATE_FORM.fields[0]?.props.required).toBe(false);
    });
});

describe('the register’s ownership transfer', () => {
    it('never takes the arrival’s or the first registration’s way of acquiring', () => {
        const base = { since: '2026-01-01', owners: [{ kind: 'person', id: '0199f0a0-d000-7000-8000-00000000fa11' }] };
        expect(ownershipTransferSchema.safeParse({ ...base, acquiredBy: 'transfer_in' }).success).toBe(false);
        expect(ownershipTransferSchema.safeParse({ ...base, acquiredBy: 'first_registration' }).success).toBe(false);
        expect(ownershipTransferSchema.safeParse({ ...base, acquiredBy: 'sale' }).success).toBe(true);
    });
});
