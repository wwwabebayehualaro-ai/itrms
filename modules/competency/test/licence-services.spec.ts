/** The two services' workflows: what the law and ADR-0042 ask of them, whatever else a bureau changes later. */
import { describe, expect, it } from 'vitest';

import { newLicenceFlow, renewalFlow } from '../seed/licence-services';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    on?: string;
    guard?: unknown;
    effects?: readonly string[];
}
const stepsOf = (flow: { transitions: readonly unknown[] }) => flow.transitions as readonly Step[];

const flows = { 'new licence': newLicenceFlow('licence-exam-result@1'), renewal: renewalFlow('licence-exam-result@1') };

describe.each(Object.entries(flows))('the %s workflow', (_name, flow) => {
    const guarded = (t: { guard?: unknown }) =>
        expect(t.guard).toEqual({ fact: 'payment.settled', op: 'eq', value: true });

    it('gives the service only while the fee stands paid (ADR-0042)', () => {
        const giving = stepsOf(flow).filter((t) => t.from === 'approval' && t.to === 'national');
        const given = stepsOf(flow).filter((t) => t.to === 'issued');
        expect(giving).toHaveLength(1);
        expect(given).toHaveLength(1);
        for (const t of [...giving, ...given]) guarded(t);
    });

    it('keeps whoever filed or checked a case off its final approval', () => {
        const approval = flow.states.find((s) => s.key === 'approval') as { separationOfDuties: string[] } | undefined;
        const human = flow.states.filter((s) => s.kind === 'task' && s.key !== 'approval').map((s) => s.key);
        expect(approval?.separationOfDuties.sort()).toEqual(['draft', ...human].sort());
    });

    it('voids what waits for the national platform whenever a case is rejected', () => {
        const rejections = stepsOf(flow).filter((t) => t.action === 'reject');
        expect(rejections).toHaveLength(1);
        expect(rejections[0]?.effects).toContain('competency.voidPendingLicence');
    });

    it('lets a draft be withdrawn, and closes a fee never paid', () => {
        expect(stepsOf(flow).some((t) => t.from === 'draft' && t.action === 'withdraw')).toBe(true);
        expect(stepsOf(flow).some((t) => t.from === 'payment' && t.on === 'timeout' && t.to === 'rejected')).toBe(true);
    });
});
