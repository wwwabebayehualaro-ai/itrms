/** The replacement's workflow and form (task 1.5, DVC-06): what ADR-0062, the holds and the maker-checker ask of it. */
import { workflowDefinitionSchema } from '@itrms/schemas';
import { checkDefinition } from '@itrms/workflow/api';
import { describe, expect, it } from 'vitest';

import { REGISTRATION_EFFECTS as R, REPLACEMENT_EFFECTS as X } from '../contracts';
import { REPLACEMENT_FORM, replacementFlow } from '../seed/replacement-service';

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
}

const flow = replacementFlow('vehicle-libre-booklet@1');
const steps = flow.transitions as readonly Step[];
const state = (key: string) => flow.states.find((s) => s.key === key) as State | undefined;
const ENC = 'vehicles.checkEncumbrances:replacement';

describe('the replacement workflow', () => {
    it('is a valid definition with no unreachable state or dead end', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
        expect(checkDefinition(flow).problems).toEqual([]);
    });

    it('checks the request when it is filed and when it is corrected', () => {
        const filing = steps.filter((t) => t.from === 'draft' && t.to === 'review');
        expect(filing.map((t) => t.action).sort()).toEqual(['correct', 'submit']);
        for (const t of filing) expect(t.effects).toContain(X.checkReplacement);
    });

    it('reaches the notice state only when a notice is required, and checks its end before payment', () => {
        const approvals = steps.filter((t) => t.from === 'review' && t.action === 'approve');
        expect(approvals.map((t) => t.to)).toEqual(['notice', 'payment']);
        expect(approvals[0]?.guard).toEqual({ fact: 'replacement.noticeRequired', op: 'eq', value: true });
        expect(steps.find((t) => t.from === 'notice' && t.action === 'notice_over')?.effects).toEqual([
            X.checkReplacementNotice,
            ENC,
            'fees.createPaymentOrder'
        ]);
    });

    it('replaces the libre only while the fee stands paid and the vehicle is clear, then writes the booklet', () => {
        expect(steps.find((t) => t.action === 'replace_libre')).toMatchObject({
            from: 'libre',
            to: 'booklet',
            effects: [ENC, `${X.replaceLibre}:vehicle-registration-certificate`]
        });
        expect(steps.find((t) => t.action === 'issue_booklet')?.effects).toEqual([R.issueLibreBooklet]);
        expect(state('booklet')?.stepForm).toBe('vehicle-libre-booklet@1');
    });

    it('keeps whoever filed, checked or released the notice off the approval, and the approver off the replacement', () => {
        expect(state('approval')?.separationOfDuties?.sort()).toEqual(['draft', 'notice', 'review']);
        expect(state('libre')?.separationOfDuties).toEqual(['approval']);
    });

    it('lets a draft be withdrawn, rejects before the replacement and closes a fee never paid', () => {
        expect(steps.some((t) => t.from === 'draft' && t.action === 'withdraw')).toBe(true);
        expect(steps.some((t) => t.from === 'payment' && t.on === 'timeout' && t.to === 'rejected')).toBe(true);
        expect(steps.find((t) => t.action === 'reject')?.from).toEqual(['review', 'notice', 'approval', 'libre']);
    });
});

type Field = { id: string; type: string; props?: { required?: boolean; provider?: string } };

describe('the replacement form', () => {
    const fields = REPLACEMENT_FORM.fields as readonly Field[];
    const field = (id: string) => fields.find((f) => f.id === id);

    it('has the keys the effects read, the optional ones not required, and the fee', () => {
        expect(field('vehicle')).toMatchObject({
            type: 'RegistryLookup',
            props: { provider: 'vehicle', required: true }
        });
        for (const id of ['item', 'reason', 'use'])
            expect(field(id)).toMatchObject({ type: 'Dropdown', props: { required: true } });
        for (const id of [
            'policeReportReference',
            'policeReportOn',
            'noticeNewspaper',
            'noticePublishedOn',
            'oldItemHandedIn'
        ])
            expect(field(id)?.props?.required, id).toBe(false);
        expect(field('policeReportOn')?.type).toBe('EthDate');
        expect(field('fee')?.type).toBe('Fee');
    });

    it('offers only the libre for now', () => {
        const offered = (
            field('item') as unknown as { data: { dataSource: { staticData: { value: string }[] } } }
        ).data.dataSource.staticData.map((o) => o.value);
        expect(offered).toEqual(['libre']);
    });
});
