/** The ownership transfer's workflow and forms (task 1.4b, DVC-13): what ADR-0042, the holds and the maker-checker ask of it, whatever else a bureau changes. */
import { workflowDefinitionSchema } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import {
    evidenceEntrySchema,
    lettersEntrySchema,
    REGISTRATION_EFFECTS as R,
    TRANSFER_EFFECTS as T,
    valuationEntrySchema
} from '../contracts';
import {
    OWNERSHIP_TRANSFER_FORM,
    ownershipTransferFlow,
    TRANSFER_EVIDENCE_FORM,
    TRANSFER_LETTERS_FORM,
    TRANSFER_VALUATION_FORM
} from '../seed/transfer-service';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    on?: string;
    guard?: unknown;
    effects?: readonly string[];
}

interface State {
    key: string;
    separationOfDuties?: string[];
    stepForm?: string;
    assignee?: { role: string; unit: string };
}

const flow = ownershipTransferFlow(
    'vehicle-transfer-valuation@1',
    'vehicle-transfer-letters@1',
    'vehicle-transfer-evidence@1',
    'vehicle-libre-booklet@1'
);
const steps = flow.transitions as readonly Step[];
const state = (key: string) => flow.states.find((s) => s.key === key) as State | undefined;
const PAID = { fact: 'payment.settled', op: 'eq', value: true };
const ENC = 'vehicles.checkEncumbrances:ownership-transfer';
const TRANSFER = `${T.transferOwnership}:vehicle-registration-certificate`;

describe('the ownership transfer workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('checks the request, and the vehicle for a hold, when it is filed and when it is corrected', () => {
        const filing = steps.filter((t) => t.from === 'draft' && t.to === 'review');
        expect(filing.map((t) => t.action).sort()).toEqual(['correct', 'submit']);
        for (const t of filing) {
            expect(t.effects).toContain(T.checkOwnershipTransfer);
            expect(t.effects).toContain(ENC);
        }
    });

    it('gives the service only while the fee stands paid (ADR-0042), and checks for a hold right before the owners change', () => {
        const giving = [T.transferOwnership, R.issueLibreBooklet];
        const gives = steps.filter((t) => t.effects?.some((e) => giving.some((g) => e.startsWith(g))));
        expect(gives.map((t) => t.to)).toEqual(['booklet', 'transferred']);
        for (const t of gives) expect(t.guard).toEqual(PAID);
        const transfer = steps.find((t) => t.action === 'transfer');
        expect(transfer?.effects).toEqual([ENC, TRANSFER]);
        // the final approval checks again: a hold recorded after the payment stops the case before the transfer step
        expect(steps.find((t) => t.from === 'approval' && t.action === 'approve')).toMatchObject({
            guard: PAID,
            effects: [ENC]
        });
    });

    it('checks for a hold before the letters, before the payment order, and before the transfer', () => {
        expect(steps.find((t) => t.action === 'issue_letters')?.effects).toEqual([
            T.checkOwnershipTransfer,
            ENC,
            T.issueTransferLetters
        ]);
        // the payment order is made only after the papers are in and the vehicle is still clear
        expect(steps.find((t) => t.from === 'outside' && t.action === 'approve')?.effects).toEqual([
            T.recordTransferEvidence,
            ENC,
            'fees.createPaymentOrder'
        ]);
        expect(steps.find((t) => t.from === 'review' && t.action === 'approve')?.effects).toEqual([ENC]);
    });

    it('records the valuation on the inspector step, and the papers and the letters on the officer steps', () => {
        expect(state('valuation')).toMatchObject({
            assignee: { role: 'competency.inspector', unit: 'handling' },
            stepForm: 'vehicle-transfer-valuation@1'
        });
        expect(steps.find((t) => t.from === 'valuation' && t.action === 'value')?.effects).toEqual([T.recordValuation]);
        expect(state('letters')).toMatchObject({
            assignee: { role: 'competency.officer', unit: 'handling' },
            stepForm: 'vehicle-transfer-letters@1'
        });
        expect(state('outside')).toMatchObject({
            assignee: { role: 'competency.officer', unit: 'handling' },
            stepForm: 'vehicle-transfer-evidence@1'
        });
        expect(state('booklet')?.stepForm).toBe('vehicle-libre-booklet@1');
    });

    it('keeps whoever filed, checked, valued or took the papers off the approval, and the approver off the transfer', () => {
        expect(state('valuation')?.separationOfDuties).toEqual(['draft']);
        expect(state('approval')?.separationOfDuties?.sort()).toEqual([
            'draft',
            'letters',
            'outside',
            'review',
            'valuation'
        ]);
        expect(state('transfer')?.separationOfDuties).toEqual(['approval']);
    });

    it('ends with the federal booklet, rejects before the owners change and withdraws the letters', () => {
        expect(steps.filter((t) => t.from === 'booklet').map((t) => [t.action, t.to])).toEqual([
            ['issue_booklet', 'transferred'],
            ['close_without_booklet', 'transferred']
        ]);
        const rejections = steps.filter((t) => t.action === 'reject');
        expect(rejections).toHaveLength(1);
        expect(rejections[0]?.from).toEqual(['review', 'valuation', 'letters', 'outside', 'approval', 'transfer']);
        expect(rejections[0]?.effects).toEqual([T.revokeTransferLetters]);
    });

    it('lets a draft be withdrawn, and closes a fee never paid', () => {
        expect(steps.some((t) => t.from === 'draft' && t.action === 'withdraw')).toBe(true);
        expect(steps.some((t) => t.from === 'payment' && t.on === 'timeout' && t.to === 'rejected')).toBe(true);
        expect(steps.find((t) => t.from === 'payment' && t.on === 'event:payment.settled')?.guard).toEqual(PAID);
    });
});

type Field = { id: string; type: string; parentId?: string; props?: { required?: boolean; provider?: string } };
const fieldsOf = (form: { fields: readonly object[] }) => form.fields as readonly Field[];
const requiredOf = (form: { fields: readonly object[] }) =>
    fieldsOf(form)
        .filter((f) => f.props?.required !== false)
        .map((f) => f.id)
        .sort();

describe('the ownership transfer forms', () => {
    it('picks the vehicle from the register, names the buyers in rows of a person or an organisation, and asks how they came by it', () => {
        const field = (id: string) => fieldsOf(OWNERSHIP_TRANSFER_FORM).find((f) => f.id === id);
        expect(field('vehicle')).toMatchObject({
            type: 'RegistryLookup',
            props: { provider: 'vehicle', required: true }
        });
        expect(field('owners')?.type).toBe('FormArray');
        expect(field('ownerPerson')).toMatchObject({ parentId: 'owners', props: { provider: 'person' } });
        expect(field('ownerOrganisation')).toMatchObject({ parentId: 'owners', props: { provider: 'organisation' } });
        expect(field('acquiredBy')).toMatchObject({ type: 'Dropdown', props: { required: true } });
        expect(field('fee')?.type).toBe('Fee');
        // the dropdown offers exactly the reasons the service accepts
        const offered = (
            field('acquiredBy') as unknown as {
                data: { dataSource: { staticData: { value: string }[] } };
            }
        ).data.dataSource.staticData.map((o) => o.value);
        expect(offered).toEqual(['sale', 'gift', 'inheritance', 'court_order', 'auction']);
    });

    it('has the keys of each step the service reads, and requires in the form only what the service always needs', () => {
        const keys = (form: { fields: readonly object[] }) =>
            fieldsOf(form)
                .map((f) => f.id)
                .sort();
        expect(keys(TRANSFER_VALUATION_FORM)).toEqual(Object.keys(valuationEntrySchema.shape).sort());
        expect(keys(TRANSFER_LETTERS_FORM)).toEqual(Object.keys(lettersEntrySchema.shape).sort());
        expect(keys(TRANSFER_EVIDENCE_FORM)).toEqual(Object.keys(evidenceEntrySchema.shape).sort());
        expect(requiredOf(TRANSFER_VALUATION_FORM)).toEqual(['committeeValueBirr', 'inspectionMatches']);
        expect(requiredOf(TRANSFER_LETTERS_FORM)).toEqual(['revenueOffice']);
        expect(requiredOf(TRANSFER_EVIDENCE_FORM)).toEqual(['stampDutyPaidOn', 'stampDutyReceipt']);
    });

    it('takes the committee value in whole Birr and the answers of a step as their schemas say', () => {
        expect(valuationEntrySchema.safeParse({ inspectionMatches: true, committeeValueBirr: 350000 }).success).toBe(
            true
        );
        expect(valuationEntrySchema.safeParse({ inspectionMatches: true }).success).toBe(false);
        expect(
            valuationEntrySchema.safeParse({ inspectionMatches: true, committeeValueBirr: 1, depreciationPercent: 101 })
                .success
        ).toBe(false);
        expect(lettersEntrySchema.safeParse({ revenueOffice: '' }).success).toBe(false);
        expect(lettersEntrySchema.parse({ revenueOffice: 'Revenue', justiceOffice: '' }).justiceOffice).toBeUndefined();
        expect(evidenceEntrySchema.safeParse({ stampDutyReceipt: 'R-1', stampDutyPaidOn: '2026-11-04' }).success).toBe(
            true
        );
    });
});
