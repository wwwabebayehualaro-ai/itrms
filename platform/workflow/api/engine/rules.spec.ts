// The engine's rules (task 0.19a): who may take which transition, separation of duties, guards, and where a step goes.
import type { WorkflowGuard } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import { LICENCE } from './fixtures';
import {
    actionsFor,
    assigneeUnit,
    decideAction,
    decideEvent,
    evaluateGuard,
    excludedBySeparation,
    factAt,
    routeStep,
    stateOf,
    SYSTEM_TIMER,
    type PersonActor,
    type StepHistory,
    type UnitRef
} from './rules';

const person = (userId: string, ...roles: string[]): PersonActor => ({
    kind: 'person',
    userId,
    rolesInUnit: new Set(roles)
});
const none = { history: [] as StepHistory[], facts: {}, comment: false };

describe('actions', () => {
    it('lets the step role act, and only rejectRoles reject: a cashier pays but does not reject', () => {
        expect(actionsFor(LICENCE, 'payment', person('c1', 'cashier'))).toEqual(['paid']);
        expect(decideAction(LICENCE, 'payment', 'reject', person('c1', 'cashier'), { ...none, comment: true })).toEqual(
            {
                ok: false,
                refusal: 'reject-not-allowed'
            }
        );
        const lead = decideAction(LICENCE, 'payment', 'reject', person('l1', 'competency.lead'), {
            ...none,
            comment: true
        });
        expect(lead.ok && lead.transition.to).toBe('rejected');
    });

    it('refuses someone without the step role', () => {
        expect(decideAction(LICENCE, 'review', 'approve', person('x', 'cashier'), none)).toEqual({
            ok: false,
            refusal: 'role-required'
        });
        const ok = decideAction(LICENCE, 'review', 'approve', person('o1', 'competency.officer'), none);
        expect(ok.ok && ok.transition.to).toBe('exam');
    });

    it('refuses an action out of a wait or an end, and an action the state does not have', () => {
        const lead = person('l1', 'competency.lead');
        expect(decideAction(LICENCE, 'national', 'approve', lead, none)).toEqual({
            ok: false,
            refusal: 'not-an-action'
        });
        expect(decideAction(LICENCE, 'issued', 'approve', lead, none)).toEqual({ ok: false, refusal: 'final-state' });
        expect(decideAction(LICENCE, 'review', 'fly', person('o', 'competency.officer'), none)).toEqual({
            ok: false,
            refusal: 'unknown-action'
        });
        expect(decideAction(LICENCE, 'nowhere', 'x', lead, none)).toEqual({ ok: false, refusal: 'unknown-state' });
    });

    it('keeps the maker off the approval: whoever reviewed or examined does not approve', () => {
        const history: StepHistory[] = [
            { state: 'draft', userId: 'r1' },
            { state: 'review', userId: 'o1' },
            { state: 'exam', userId: 'e1' }
        ];
        // o1 also holds the lead role in the zone: still not the one to approve
        const maker = person('o1', 'competency.lead');
        expect(decideAction(LICENCE, 'approval', 'approve', maker, { ...none, history })).toEqual({
            ok: false,
            refusal: 'separation-of-duties'
        });
        const other = decideAction(LICENCE, 'approval', 'approve', person('l1', 'competency.lead'), {
            ...none,
            history
        });
        expect(other.ok).toBe(true);
        const approval = stateOf(LICENCE, 'approval');
        expect(approval && [...excludedBySeparation(approval, history)]).toEqual(['o1', 'e1']);
    });

    it('takes a transition only when its guard holds, and asks for a comment where one is required', () => {
        const cashier = person('c1', 'cashier');
        expect(
            decideAction(LICENCE, 'payment', 'paid', cashier, { ...none, facts: { payment: { settled: false } } })
        ).toEqual({ ok: false, refusal: 'guard-failed' });
        const paid = decideAction(LICENCE, 'payment', 'paid', cashier, {
            ...none,
            facts: { payment: { settled: true } }
        });
        expect(paid.ok && paid.transition.to).toBe('approval');
        const officer = person('o1', 'competency.officer');
        expect(decideAction(LICENCE, 'review', 'return', officer, none)).toEqual({
            ok: false,
            refusal: 'comment-required'
        });
        expect(decideAction(LICENCE, 'review', 'return', officer, { ...none, comment: true }).ok).toBe(true);
    });
});

describe('events', () => {
    const platform = { kind: 'system', id: 'system:national-driver-platform' } as const;

    it('leaves a wait only by its event, taken by the named system actor', () => {
        const accepted = decideEvent(LICENCE, 'national', 'event:national.licence.accepted', platform, {});
        expect(accepted.ok && accepted.transition.to).toBe('issued');
        expect(
            decideEvent(
                LICENCE,
                'national',
                'event:national.licence.accepted',
                { kind: 'system', id: 'system:sms' },
                {}
            )
        ).toEqual({ ok: false, refusal: 'wrong-system-actor' });
        expect(decideEvent(LICENCE, 'national', 'event:payment.settled', platform, {})).toEqual({
            ok: false,
            refusal: 'unknown-action'
        });
    });

    it('leaves a wait by its timeout, taken by the timer only', () => {
        const timeout = decideEvent(LICENCE, 'national', 'timeout', { kind: 'system', id: SYSTEM_TIMER }, {});
        expect(timeout.ok && timeout.transition.to).toBe('approval');
        expect(decideEvent(LICENCE, 'national', 'timeout', platform, {})).toEqual({
            ok: false,
            refusal: 'wrong-system-actor'
        });
    });

    it('takes no event out of a task', () => {
        expect(decideEvent(LICENCE, 'review', 'event:national.licence.accepted', platform, {})).toEqual({
            ok: false,
            refusal: 'not-an-event'
        });
    });
});

describe('guards', () => {
    const facts = { payment: { settled: true, amount: 12_500 }, licence: { grade: 'B' }, tags: ['x'] };

    it('compares facts by dotted path', () => {
        expect(evaluateGuard({ fact: 'payment.amount', op: 'gte', value: 12_500 }, facts)).toBe(true);
        expect(evaluateGuard({ fact: 'payment.amount', op: 'lt', value: 100 }, facts)).toBe(false);
        expect(evaluateGuard({ fact: 'licence.grade', op: 'in', value: ['A', 'B'] }, facts)).toBe(true);
        expect(evaluateGuard({ fact: 'licence.grade', op: 'ne', value: 'C' }, facts)).toBe(true);
        expect(evaluateGuard({ fact: 'payment.receipt', op: 'exists' }, facts)).toBe(false);
    });

    it('combines with all, any and not', () => {
        const g: WorkflowGuard = {
            all: [
                { fact: 'payment.settled', op: 'eq', value: true },
                { any: [{ fact: 'licence.grade', op: 'eq', value: 'A' }, { not: { fact: 'x', op: 'exists' } }] }
            ]
        };
        expect(evaluateGuard(g, facts)).toBe(true);
    });

    it('fails on a missing fact or a type mismatch, and never reads the prototype', () => {
        expect(evaluateGuard({ fact: 'payment.amount', op: 'gt', value: '1' }, facts)).toBe(false);
        expect(evaluateGuard({ fact: 'nothing.here', op: 'eq', value: null }, facts)).toBe(false);
        expect(factAt(facts, 'payment.constructor')).toBeUndefined();
        expect(factAt({}, '__proto__')).toBeUndefined();
    });
});

describe('assignment', () => {
    const region: UnitRef = { id: 'ser', levelKey: 'region' };
    const zone: UnitRef = { id: 'wol', levelKey: 'zone' };
    const town: UnitRef = { id: 'boditi', levelKey: 'town' };
    const chain = [region, zone, town];

    it('assigns the handling unit, its parent ("the zone approves for a town"), the region or a named level', () => {
        expect(assigneeUnit('handling', chain)).toEqual({ ok: true, unit: town });
        expect(assigneeUnit('parent', chain)).toEqual({ ok: true, unit: zone });
        expect(assigneeUnit('region', chain)).toEqual({ ok: true, unit: region });
        expect(assigneeUnit('level:zone', chain)).toEqual({ ok: true, unit: zone });
        expect(assigneeUnit('level:kebele', chain)).toEqual({ ok: false, reason: 'no-level' });
        expect(assigneeUnit('parent', [region])).toEqual({ ok: false, reason: 'no-parent' });
    });

    it('reads ${approval_unit} from the frozen configuration', () => {
        expect(assigneeUnit('${approval_unit}', chain, 'parent')).toEqual({ ok: true, unit: zone });
        expect(assigneeUnit('${approval_unit}', chain)).toEqual({ ok: false, reason: 'no-approval-unit' });
        expect(assigneeUnit('${approval_unit}', chain, '${approval_unit}')).toEqual({
            ok: false,
            reason: 'no-approval-unit'
        });
    });

    it('routes a one-person office’s separated step to its parent, and says so', () => {
        const holders = (id: string) => ({ boditi: ['solo'], wol: ['z1', 'z2'], ser: ['b1'] })[id] ?? [];
        // the only lead in Boditi reviewed the case: the approval goes up to the zone
        expect(routeStep(chain, holders, new Set(['solo']))).toEqual({ unit: zone, hops: 1, eligible: ['z1', 'z2'] });
        expect(routeStep(chain, holders, new Set())).toEqual({ unit: town, hops: 0, eligible: ['solo'] });
        // nobody anywhere: refused, never relaxed
        expect(routeStep(chain, () => ['solo'], new Set(['solo']))).toBeNull();
    });
});
