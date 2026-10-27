/**
 * The checks a workflow definition passes before a version is stored (architecture.md §8, task 0.19a). DB-free: what is
 * known (roles, effects, step forms) comes in from the caller. Every problem names a message key of the slice's catalogue
 * (`workflow.check.<code>`) and the values it reads, so the API answers in the reader's language.
 *
 * Structure: one start; states and transitions name known states; every state reachable from the start; an end reachable
 * from every state; a task left only by actions, a wait only by events or its timeout, an end never; separation of duties
 * names task (or start) states; a timeout leaves only a wait with an SLA.
 */
import {
    effectKeyOf,
    fromStates,
    workflowDefinitionSchema,
    type WorkflowDefinition,
    type WorkflowState
} from '@itrms/schemas';

import { MAX_DEFINITION_DEPTH, nestsDeeperThan } from '../../contracts';

export const CHECK_CODES = [
    'invalid',
    'duplicate-state',
    'no-start',
    'many-starts',
    'no-end',
    'unknown-state',
    'unreachable',
    'dead-end',
    'end-exit',
    'task-event',
    'wait-action',
    'start-event',
    'duplicate-action',
    'timeout-without-sla',
    'many-timeouts',
    'sod-state',
    'unknown-role',
    'unknown-effect',
    'unknown-step-form'
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export interface CheckProblem {
    code: CheckCode;
    /** where in the definition: `states[2].assignee.role`, `transitions[4].to` */
    path: string;
    /** the values the message reads: `{state}`, `{role}` … */
    values: Record<string, string>;
}

/** What the installation knows: the roles of the installed modules, the effects they registered, the step forms. */
export interface Known {
    roles: ReadonlySet<string>;
    effects: ReadonlySet<string>;
    /** `<form-key>@<number>` of form versions that exist */
    stepForms: ReadonlySet<string>;
}

/** A definition the schema accepted, with its problems; `definition` is null when the schema refused it. */
export interface CheckResult {
    definition: WorkflowDefinition | null;
    problems: CheckProblem[];
}

/** Checks a definition: its shape (the schema), its structure, and, given `known`, its roles, effects and step forms. */
export function checkDefinition(raw: unknown, known?: Known): CheckResult {
    // measured before the schema recurses into it
    if (nestsDeeperThan(raw, MAX_DEFINITION_DEPTH))
        return {
            definition: null,
            problems: [
                { code: 'invalid', path: '', values: { detail: `nested deeper than ${MAX_DEFINITION_DEPTH} levels` } }
            ]
        };
    const parsed = workflowDefinitionSchema.safeParse(raw);
    if (!parsed.success)
        return {
            definition: null,
            problems: parsed.error.issues.slice(0, 50).map((i) => ({
                code: 'invalid',
                path: i.path.map(String).join('.'),
                values: { detail: i.message }
            }))
        };
    const def = parsed.data;
    return { definition: def, problems: [...structureProblems(def), ...(known ? knownProblems(def, known) : [])] };
}

function structureProblems(def: WorkflowDefinition): CheckProblem[] {
    const out: CheckProblem[] = [];
    const add = (code: CheckCode, path: string, values: Record<string, string> = {}) =>
        out.push({ code, path, values });
    const byKey = new Map<string, WorkflowState>();
    def.states.forEach((s, i) => {
        if (byKey.has(s.key)) add('duplicate-state', `states[${i}].key`, { state: s.key });
        else byKey.set(s.key, s);
    });
    const starts = def.states.filter((s) => s.kind === 'start');
    if (starts.length === 0) add('no-start', 'states');
    if (starts.length > 1) add('many-starts', 'states', { states: starts.map((s) => s.key).join(', ') });
    if (!def.states.some((s) => s.kind === 'end')) add('no-end', 'states');

    // edges between known states; each transition's shape against the kind of state it leaves
    const next = new Map<string, Set<string>>();
    const unguarded = new Set<string>();
    def.transitions.forEach((t, i) => {
        const at = `transitions[${i}]`;
        if (!byKey.has(t.to)) add('unknown-state', `${at}.to`, { state: t.to });
        fromStates(t).forEach((from, j) => {
            const state = byKey.get(from);
            const path = Array.isArray(t.from) ? `${at}.from[${j}]` : `${at}.from`;
            if (!state) return add('unknown-state', path, { state: from });
            if (state.kind === 'end') add('end-exit', path, { state: from });
            if (state.kind === 'task' && t.on) add('task-event', `${at}.on`, { state: from });
            if (state.kind === 'start' && t.on) add('start-event', `${at}.on`, { state: from });
            if (state.kind === 'wait' && t.action) add('wait-action', `${at}.action`, { state: from });
            if (t.on === 'timeout' && state.kind === 'wait' && !state.sla)
                add('timeout-without-sla', `${at}.on`, { state: from });
            // on one trigger out of one state the first transition whose guard holds is taken: one after an unguarded
            // one could never be taken (a last unguarded one is the fallback)
            const trigger = `${from}\u0000${t.action ?? t.on ?? ''}`;
            if (unguarded.has(trigger))
                add(t.on === 'timeout' ? 'many-timeouts' : 'duplicate-action', `${at}.${t.action ? 'action' : 'on'}`, {
                    state: from,
                    action: t.action ?? t.on ?? ''
                });
            if (!t.guard) unguarded.add(trigger);
            if (byKey.has(t.to)) next.set(from, (next.get(from) ?? new Set()).add(t.to));
        });
    });

    // reachable from the start
    const start = starts[0];
    if (start) {
        const reached = walk(start.key, next);
        def.states.forEach((s, i) => {
            if (!reached.has(s.key)) add('unreachable', `states[${i}]`, { state: s.key });
        });
    }
    // an end reachable from every state (no loop without a way out, no task or wait without an exit)
    const back = new Map<string, Set<string>>();
    for (const [from, tos] of next) for (const to of tos) back.set(to, (back.get(to) ?? new Set()).add(from));
    const canEnd = new Set<string>();
    for (const s of def.states) if (s.kind === 'end') for (const k of walk(s.key, back)) canEnd.add(k);
    def.states.forEach((s, i) => {
        if (s.kind !== 'end' && !canEnd.has(s.key)) add('dead-end', `states[${i}]`, { state: s.key });
    });

    // separation of duties names states people act on
    def.states.forEach((s, i) =>
        s.separationOfDuties?.forEach((k, j) => {
            const other = byKey.get(k);
            if (!other || (other.kind !== 'task' && other.kind !== 'start') || k === s.key)
                add('sod-state', `states[${i}].separationOfDuties[${j}]`, { state: s.key, other: k });
        })
    );
    return out;
}

function knownProblems(def: WorkflowDefinition, known: Known): CheckProblem[] {
    const out: CheckProblem[] = [];
    def.states.forEach((s, i) => {
        if (s.assignee && !known.roles.has(s.assignee.role))
            out.push({ code: 'unknown-role', path: `states[${i}].assignee.role`, values: { role: s.assignee.role } });
        if (s.stepForm && !known.stepForms.has(s.stepForm))
            out.push({ code: 'unknown-step-form', path: `states[${i}].stepForm`, values: { form: s.stepForm } });
    });
    def.transitions.forEach((t, i) => {
        t.rejectRoles?.forEach((r, j) => {
            if (!known.roles.has(r))
                out.push({ code: 'unknown-role', path: `transitions[${i}].rejectRoles[${j}]`, values: { role: r } });
        });
        t.effects?.forEach((e, j) => {
            if (!known.effects.has(effectKeyOf(e)))
                out.push({ code: 'unknown-effect', path: `transitions[${i}].effects[${j}]`, values: { effect: e } });
        });
    });
    return out;
}

/** Every state reachable from `from` along `edges`, `from` included. */
function walk(from: string, edges: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
    const reached = new Set([from]);
    const queue = [from];
    for (let k = queue.shift(); k !== undefined; k = queue.shift())
        for (const n of edges.get(k) ?? [])
            if (!reached.has(n)) {
                reached.add(n);
                queue.push(n);
            }
    return reached;
}
