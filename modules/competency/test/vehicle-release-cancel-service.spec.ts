/** The cancellation of a vehicle release's workflow and form (task 1.4c2b, DVC-16, ADR-0059): what the maker-checker and the document check ask of it. */
import { effectKeyOf, workflowDefinitionSchema } from '@itrms/schemas';
import { missingBefore } from '@itrms/services/api';
import { describe, expect, it } from 'vitest';

import { transferDocumentNumberKey, VEHICLE_TRANSFER_EFFECTS as X } from '../contracts';
import { RELEASE_CANCEL_FORM, releaseCancelFlow } from '../seed/vehicle-transfer-service';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    effects?: readonly string[];
}

interface State {
    key: string;
    separationOfDuties?: string[];
    assignee?: { role: string; unit: string };
}

interface Field {
    id: string;
    type: string;
    props?: Record<string, unknown>;
}

const flow = releaseCancelFlow();
const steps = flow.transitions as readonly Step[];
const state = (key: string) => flow.states.find((s) => s.key === key) as State | undefined;

describe('the release cancellation workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('checks the release when it is filed, corrected and passed on, and cancels only on the lead’s approval', () => {
        const checked = steps
            .filter((t) => t.to === 'review' && t.from === 'draft')
            .concat(steps.filter((t) => t.to === 'approval'));
        expect(checked).toHaveLength(3);
        for (const t of checked) expect(t.effects, String(t.action)).toContain(X.checkReleaseCancel);
        const cancelling = steps.filter((t) => t.effects?.includes(X.cancelRelease));
        expect(cancelling).toHaveLength(1);
        expect(cancelling[0]).toMatchObject({ from: 'approval', to: 'cancelled', action: 'approve' });
        expect(cancelling[0]?.effects).toEqual([X.checkReleaseCancel, X.cancelRelease]);
    });

    it('is approved by a lead who is neither the filer nor the checker', () => {
        expect(state('approval')?.assignee?.role).toBe('competency.lead');
        expect(state('approval')?.separationOfDuties).toEqual(['draft', 'review']);
        expect(state('review')?.assignee?.role).toBe('competency.officer');
    });

    it('may be rejected or withdrawn, and has no payment step', () => {
        expect(steps.some((t) => t.action === 'reject')).toBe(true);
        expect(steps.some((t) => t.action === 'withdraw')).toBe(true);
        expect(flow.states.some((s) => s.key === 'payment')).toBe(false);
        expect(steps.some((t) => t.effects?.some((e) => e.startsWith('fees.')))).toBe(false);
    });

    it('names the check before the effect that gives the service', () => {
        const requires = (effect: string) => (effect === X.cancelRelease ? [X.checkReleaseCancel] : []);
        expect(missingBefore(workflowDefinitionSchema.parse(flow), requires, effectKeyOf)).toEqual([]);
    });
});

describe('the release cancellation form', () => {
    const fields = RELEASE_CANCEL_FORM.fields as readonly Field[];
    const field = (id: string) => fields.find((f) => f.id === id);

    it('asks for a released vehicle, the number of the document handed back, and the reason', () => {
        expect(field('vehicle')).toMatchObject({ type: 'RegistryLookup', props: { provider: 'released-vehicle' } });
        expect(field('documentNumber')?.props).toMatchObject({ required: false, maxLength: 40 });
        expect(field('reason')?.type).toBe('InputTextarea');
        expect(field('reason')?.props?.required).not.toBe(false);
    });

    it('carries no fee', () => {
        expect(fields.some((f) => f.type === 'Fee')).toBe(false);
    });
});

describe('the number of a transfer document', () => {
    it('is compared trimmed, with no spaces, in upper case', () => {
        expect(transferDocumentNumberKey('  wol-boditi / vt/00001 /2019 ')).toBe('WOL-BODITI/VT/00001/2019');
        expect(transferDocumentNumberKey('A B\tC')).toBe('ABC');
    });
});
