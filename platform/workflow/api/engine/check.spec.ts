// The checks a definition passes before a version is stored (task 0.19a).
import { describe, expect, it } from 'vitest';

import { checkDefinition, type CheckProblem } from './check';
import { KNOWN, LICENCE } from './fixtures';

const clone = () => structuredClone(LICENCE);
const codes = (problems: CheckProblem[]) => problems.map((p) => p.code);

describe('checkDefinition', () => {
    it('accepts the licence workflow', () => {
        const { definition, problems } = checkDefinition(LICENCE, KNOWN);
        expect(problems).toEqual([]);
        expect(definition?.states).toHaveLength(8);
    });

    it('refuses a shape the schema does not take, saying where', () => {
        const bad = {
            ...clone(),
            states: [
                { key: 'Draft', kind: 'start' },
                { key: 'x', kind: 'task' }
            ]
        };
        const { definition, problems } = checkDefinition(bad);
        expect(definition).toBeNull();
        expect(problems.every((p) => p.code === 'invalid')).toBe(true);
        expect(problems.map((p) => p.path)).toEqual(expect.arrayContaining(['states.0.key', 'states.1.assignee']));
    });

    it('refuses a transition with both an action and an event, a reject without its roles, an event without its actor', () => {
        const d = clone();
        d.transitions.push(
            { from: 'review', to: 'exam', action: 'x', on: 'timeout' },
            { from: 'review', to: 'rejected', action: 'reject' },
            { from: 'national', to: 'issued', on: 'event:a.b' }
        );
        const paths = checkDefinition(d).problems.map((p) => p.path);
        expect(paths).toEqual(
            expect.arrayContaining(['transitions.10.action', 'transitions.11.rejectRoles', 'transitions.12.actor'])
        );
    });

    it('changes the request only on a person’s action, never with a step form of its own (task 0.21e)', () => {
        const d = clone();
        d.transitions.push(
            { from: 'review', to: 'review', action: 'correct', amendsRequest: true },
            { from: 'exam', to: 'exam', action: 'correct', amendsRequest: true }
        );
        const { problems } = checkDefinition(d, KNOWN);
        // review has no step form: its correction is fine; exam's would file two forms
        expect(problems).toEqual([
            { code: 'amend-step-form', path: 'transitions[11].amendsRequest', values: { state: 'exam' } }
        ]);
        // a step form's state may still send the request back to its start, where nothing is filed
        const back = clone();
        back.transitions.push({ from: 'exam', to: 'draft', action: 'reopen', amendsRequest: true });
        expect(codes(checkDefinition(back, KNOWN).problems)).toEqual([]);

        const wrong = clone();
        wrong.transitions.push(
            { from: 'national', to: 'approval', on: 'event:x.y', actor: 'system:x', amendsRequest: true },
            { from: 'review', to: 'rejected', action: 'reject', rejectRoles: ['competency.lead'], amendsRequest: true }
        );
        expect(checkDefinition(wrong).problems.map((p) => p.path)).toEqual([
            'transitions.10.amendsRequest',
            'transitions.11.amendsRequest'
        ]);
    });

    it('finds a state no transition reaches', () => {
        const d = clone();
        d.states.push({ key: 'orphan', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } });
        d.transitions.push({ from: 'orphan', to: 'issued', action: 'go' });
        expect(checkDefinition(d, KNOWN).problems).toEqual([
            { code: 'unreachable', path: 'states[8]', values: { state: 'orphan' } }
        ]);
    });

    it('finds states with no way to an end: a task without an exit, a loop without one', () => {
        const d = clone();
        d.states.push(
            { key: 'stuck', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } },
            { key: 'a', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } },
            { key: 'b', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } }
        );
        d.transitions.push(
            { from: 'review', to: 'stuck', action: 'hold' },
            { from: 'review', to: 'a', action: 'loop' },
            { from: 'a', to: 'b', action: 'next' },
            { from: 'b', to: 'a', action: 'back' }
        );
        const dead = checkDefinition(d, KNOWN).problems.filter((p) => p.code === 'dead-end');
        expect(dead.map((p) => p.values.state)).toEqual(['stuck', 'a', 'b']);
    });

    it('needs one start and an end', () => {
        const d = clone();
        d.states = d.states.map((s) =>
            s.kind === 'end' ? { ...s, kind: 'task', assignee: { role: 'cashier', unit: 'handling' } } : s
        );
        d.states.push({ key: 'second', kind: 'start' });
        const found = codes(checkDefinition(d).problems);
        expect(found).toEqual(expect.arrayContaining(['no-end', 'many-starts']));
        const none = clone();
        none.states[0] = { key: 'draft', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } };
        expect(codes(checkDefinition(none).problems)).toContain('no-start');
    });

    it('names unknown states in transitions', () => {
        const d = clone();
        d.transitions.push({ from: ['review', 'nowhere'], to: 'limbo', action: 'jump' });
        expect(checkDefinition(d).problems.filter((p) => p.code === 'unknown-state')).toEqual([
            { code: 'unknown-state', path: 'transitions[10].to', values: { state: 'limbo' } },
            { code: 'unknown-state', path: 'transitions[10].from[1]', values: { state: 'nowhere' } }
        ]);
    });

    it('keeps a wait for events and its timeout, a task for actions, an end final', () => {
        const d = clone();
        d.transitions.push(
            { from: 'national', to: 'issued', action: 'force' },
            { from: 'review', to: 'issued', on: 'timeout' },
            { from: 'issued', to: 'review', action: 'reopen' },
            { from: 'draft', to: 'review', on: 'event:intake.done', actor: 'system:intake' }
        );
        expect(codes(checkDefinition(d).problems)).toEqual(
            expect.arrayContaining(['wait-action', 'task-event', 'end-exit', 'start-event'])
        );
    });

    it('refuses a timeout out of a wait with no SLA, and two timeouts', () => {
        const d = clone();
        const national = d.states.find((s) => s.key === 'national');
        if (national) delete national.sla;
        d.transitions.push({ from: 'national', to: 'issued', on: 'timeout' });
        const found = codes(checkDefinition(d).problems);
        expect(found).toContain('timeout-without-sla');
        expect(found).toContain('many-timeouts');
    });

    it('refuses a transition that could never be taken: one after an unguarded one on the same action', () => {
        const d = clone();
        d.transitions.push({ from: 'review', to: 'rejected', action: 'approve' });
        expect(codes(checkDefinition(d).problems)).toContain('duplicate-action');
        // guarded ones first, an unguarded one last: the fallback (if … else)
        const fallback = clone();
        fallback.transitions[1] = {
            from: 'review',
            to: 'rejected',
            action: 'approve',
            guard: { fact: 'x', op: 'eq', value: 1 }
        };
        fallback.transitions.push({ from: 'review', to: 'exam', action: 'approve' });
        expect(codes(checkDefinition(fallback).problems)).not.toContain('duplicate-action');
        // the fallback first leaves the guarded one unreachable
        const reversed = clone();
        reversed.transitions.push({
            from: 'review',
            to: 'rejected',
            action: 'approve',
            guard: { fact: 'x', op: 'eq', value: 1 }
        });
        expect(codes(checkDefinition(reversed).problems)).toContain('duplicate-action');
    });

    it('keeps separation of duties to steps people act on', () => {
        const d = clone();
        const approval = d.states.find((s) => s.key === 'approval');
        if (approval) approval.separationOfDuties = ['review', 'national', 'approval', 'gone'];
        expect(
            checkDefinition(d)
                .problems.filter((p) => p.code === 'sod-state')
                .map((p) => p.values.other)
        ).toEqual(['national', 'approval', 'gone']);
    });

    it('names unknown roles, effects and step forms', () => {
        const known = { roles: new Set(['cashier']), effects: new Set<string>(), stepForms: new Set<string>() };
        const problems = checkDefinition(LICENCE, known).problems;
        expect(problems.filter((p) => p.code === 'unknown-role').map((p) => p.values.role)).toEqual([
            'competency.officer',
            'competency.examiner',
            'competency.lead',
            'competency.officer',
            'competency.lead'
        ]);
        expect(problems.find((p) => p.code === 'unknown-step-form')).toEqual({
            code: 'unknown-step-form',
            path: 'states[2].stepForm',
            values: { form: 'exam-result@2' }
        });
        // an effect is known by its key; its argument (licence-card) is the effect's business
        expect(problems.filter((p) => p.code === 'unknown-effect').map((p) => p.values.effect)).toContain(
            'documents.issue:licence-card'
        );
    });

    it('refuses a hostile nesting before the schema recurses into it', () => {
        let guard: unknown = { fact: 'a', op: 'eq', value: 1 };
        for (let i = 0; i < 20_000; i++) guard = { not: guard };
        const d = clone();
        d.transitions[0] = { ...d.transitions[0], guard } as never;
        const { definition, problems } = checkDefinition(d);
        expect(definition).toBeNull();
        expect(problems).toEqual([{ code: 'invalid', path: '', values: { detail: 'nested deeper than 32 levels' } }]);
    });

    it('refuses guards nested too deep and comparisons without values', () => {
        let guard: unknown = { fact: 'a', op: 'eq', value: 1 };
        for (let i = 0; i < 7; i++) guard = { not: guard };
        const d = clone();
        d.transitions[0] = { ...d.transitions[0], guard } as never;
        expect(checkDefinition(d).definition).toBeNull();
        const noValue = clone();
        noValue.transitions[0] = { ...noValue.transitions[0], guard: { fact: 'a', op: 'gt' } } as never;
        expect(checkDefinition(noValue).problems[0]?.path).toContain('guard');
    });
});
