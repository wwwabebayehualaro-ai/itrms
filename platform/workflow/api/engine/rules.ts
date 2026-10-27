/**
 * The engine's rules (architecture.md §8, task 0.19a), as pure functions over a checked definition. The transition runner
 * (0.19b) gathers the facts (the actor's roles in the task's unit, who acted on which step, the case's facts, the unit tree)
 * and asks these; nothing here reads the database.
 *
 * - A person takes an action out of a task (or the start) when they hold the step's role in its unit. `reject` is the
 *   exception: only `rejectRoles` may take it, the step's own role included only if listed (a cashier does not reject).
 * - A wait is left only by its event, taken by the transition's system actor, or by its timeout.
 * - Separation of duties: whoever acted on a listed step (or started the case) does not act on this one.
 * - Of the transitions a trigger matches, the first whose guard holds is taken.
 */
import {
    fromStates,
    type GuardOperator,
    type WorkflowDefinition,
    type WorkflowGuard,
    type WorkflowState,
    type WorkflowTransition,
    type WorkflowUnitRule
} from '@itrms/schemas';

export const REFUSALS = [
    'unknown-state',
    'final-state',
    'not-an-action',
    'not-an-event',
    'unknown-action',
    'role-required',
    'reject-not-allowed',
    'wrong-system-actor',
    'separation-of-duties',
    'guard-failed',
    'comment-required'
] as const;
export type Refusal = (typeof REFUSALS)[number];

export type Decision = { ok: true; transition: WorkflowTransition } | { ok: false; refusal: Refusal };

/** A person acting: the roles they hold in the unit the step is assigned to, and who they are. */
export interface PersonActor {
    kind: 'person';
    userId: string;
    rolesInUnit: ReadonlySet<string>;
}
/** An adapter acting on an event or a timeout (`system:national-driver-platform`, `system:timer`). */
export interface SystemActor {
    kind: 'system';
    id: string;
}

/** Who acted on which step of the case so far (the start: whoever started it). */
export interface StepHistory {
    state: string;
    userId: string;
}

export const stateOf = (def: WorkflowDefinition, key: string): WorkflowState | undefined =>
    def.states.find((s) => s.key === key);

const leaving = (def: WorkflowDefinition, state: string, match: (t: WorkflowTransition) => boolean) =>
    def.transitions.filter((t) => fromStates(t).includes(state) && match(t));

/** The actions a person could take out of `state` (before guards and separation of duties). */
export function actionsFor(def: WorkflowDefinition, state: string, actor: PersonActor): string[] {
    const s = stateOf(def, state);
    if (!s || (s.kind !== 'task' && s.kind !== 'start')) return [];
    const actions = new Set<string>();
    for (const t of leaving(def, state, (x) => x.action !== undefined))
        if (t.action && mayTake(s, t, actor)) actions.add(t.action);
    return [...actions];
}

function mayTake(state: WorkflowState, t: WorkflowTransition, actor: PersonActor): boolean {
    if (t.action === 'reject') return (t.rejectRoles ?? []).some((r) => actor.rolesInUnit.has(r));
    // the start is taken by whoever started the case (the runner checks it); a task by the step's role
    return state.kind === 'start' || (state.assignee !== undefined && actor.rolesInUnit.has(state.assignee.role));
}

/**
 * Decides a person's action out of `state`. `history` is who acted on which step; `facts` are the case's facts the guards
 * read; `comment` whether the actor wrote one.
 */
export function decideAction(
    def: WorkflowDefinition,
    state: string,
    action: string,
    actor: PersonActor,
    ctx: { history: readonly StepHistory[]; facts: unknown; comment: boolean }
): Decision {
    const s = stateOf(def, state);
    if (!s) return { ok: false, refusal: 'unknown-state' };
    if (s.kind === 'end') return { ok: false, refusal: 'final-state' };
    if (s.kind === 'wait') return { ok: false, refusal: 'not-an-action' };
    const candidates = leaving(def, state, (t) => t.action === action);
    if (!candidates.length) return { ok: false, refusal: 'unknown-action' };
    // the same action has the same roles wherever it leads (a reject is a reject)
    const first = candidates[0];
    if (!first || !mayTake(s, first, actor))
        return { ok: false, refusal: action === 'reject' ? 'reject-not-allowed' : 'role-required' };
    if (violatesSeparation(s, actor.userId, ctx.history)) return { ok: false, refusal: 'separation-of-duties' };
    const taken = candidates.find((t) => !t.guard || evaluateGuard(t.guard, ctx.facts));
    if (!taken) return { ok: false, refusal: 'guard-failed' };
    if (taken.commentRequired && !ctx.comment) return { ok: false, refusal: 'comment-required' };
    return { ok: true, transition: taken };
}

/** Decides an event (`event:<name>`) or the timeout out of a wait state, taken by a system actor. */
export function decideEvent(
    def: WorkflowDefinition,
    state: string,
    on: string,
    actor: SystemActor,
    facts: unknown
): Decision {
    const s = stateOf(def, state);
    if (!s) return { ok: false, refusal: 'unknown-state' };
    if (s.kind === 'end') return { ok: false, refusal: 'final-state' };
    if (s.kind !== 'wait') return { ok: false, refusal: 'not-an-event' };
    const candidates = leaving(def, state, (t) => t.on === on);
    if (!candidates.length) return { ok: false, refusal: 'unknown-action' };
    // an event is taken by the adapter the transition names; the timeout by the timer
    const allowed = candidates.filter((t) => (on === 'timeout' ? actor.id === SYSTEM_TIMER : t.actor === actor.id));
    if (!allowed.length) return { ok: false, refusal: 'wrong-system-actor' };
    const taken = allowed.find((t) => !t.guard || evaluateGuard(t.guard, facts));
    return taken ? { ok: true, transition: taken } : { ok: false, refusal: 'guard-failed' };
}

/** The actor that takes timeouts (0.20's SLA timers). */
export const SYSTEM_TIMER = 'system:timer';

/** Whether `userId` acted on a step this one keeps apart from (or started the case, when `start` is listed). */
export function violatesSeparation(state: WorkflowState, userId: string, history: readonly StepHistory[]): boolean {
    const apart = new Set(state.separationOfDuties ?? []);
    return apart.size > 0 && history.some((h) => apart.has(h.state) && h.userId === userId);
}

/** The people separation of duties keeps off `state`. */
export function excludedBySeparation(state: WorkflowState, history: readonly StepHistory[]): Set<string> {
    const apart = new Set(state.separationOfDuties ?? []);
    return new Set(history.filter((h) => apart.has(h.state)).map((h) => h.userId));
}

// --- guards -------------------------------------------------------------------------------------------------------

/** A fact by its dotted path; own properties only (never the prototype's). */
export function factAt(facts: unknown, path: string): unknown {
    let at: unknown = facts;
    for (const part of path.split('.')) {
        if (at === null || typeof at !== 'object' || !Object.prototype.hasOwnProperty.call(at, part)) return undefined;
        at = (at as Record<string, unknown>)[part];
    }
    return at;
}

const comparable = (a: unknown, b: unknown): boolean =>
    (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');

function compare(op: GuardOperator, actual: unknown, value: unknown): boolean {
    switch (op) {
        case 'exists':
            return actual !== undefined && actual !== null;
        case 'eq':
            return actual === value;
        case 'ne':
            return actual !== value;
        case 'in':
            return Array.isArray(value) && value.some((v) => v === actual);
        case 'gt':
            return comparable(actual, value) && (actual as number) > (value as number);
        case 'gte':
            return comparable(actual, value) && (actual as number) >= (value as number);
        case 'lt':
            return comparable(actual, value) && (actual as number) < (value as number);
        case 'lte':
            return comparable(actual, value) && (actual as number) <= (value as number);
    }
}

/** Whether a guard holds on the case's facts. A missing fact fails every comparison but `ne`. */
export function evaluateGuard(guard: WorkflowGuard, facts: unknown): boolean {
    if ('all' in guard) return guard.all.every((g) => evaluateGuard(g, facts));
    if ('any' in guard) return guard.any.some((g) => evaluateGuard(g, facts));
    if ('not' in guard) return !evaluateGuard(guard.not, facts);
    return compare(guard.op, factAt(facts, guard.fact), guard.value);
}

// --- assignment -----------------------------------------------------------------------------------------------------

/** A unit on the way from the region down to the handling unit. */
export interface UnitRef {
    id: string;
    levelKey: string;
}

export type Assignment =
    { ok: true; unit: UnitRef } | { ok: false; reason: 'no-parent' | 'no-level' | 'no-approval-unit' };

/**
 * The unit a task is assigned to. `chain` runs from the region down to the handling unit; `approvalUnit` is the service's
 * frozen `approval_unit` (a rule itself, never `${approval_unit}`).
 */
export function assigneeUnit(
    rule: WorkflowUnitRule,
    chain: readonly UnitRef[],
    approvalUnit?: WorkflowUnitRule
): Assignment {
    const handling = chain[chain.length - 1];
    if (!handling) return { ok: false, reason: 'no-parent' };
    if (rule === '${approval_unit}')
        return approvalUnit && approvalUnit !== '${approval_unit}'
            ? assigneeUnit(approvalUnit, chain)
            : { ok: false, reason: 'no-approval-unit' };
    if (rule === 'handling') return { ok: true, unit: handling };
    if (rule === 'region') return { ok: true, unit: chain[0] ?? handling };
    if (rule === 'parent') {
        const parent = chain[chain.length - 2];
        return parent ? { ok: true, unit: parent } : { ok: false, reason: 'no-parent' };
    }
    const level = rule.slice('level:'.length);
    for (let i = chain.length - 1; i >= 0; i--) {
        const unit = chain[i];
        if (unit?.levelKey === level) return { ok: true, unit };
    }
    return { ok: false, reason: 'no-level' };
}

export interface Routing {
    unit: UnitRef;
    /** how many levels up from the assigned unit (0: the unit itself) */
    hops: number;
    /** the people who may take it there */
    eligible: string[];
}

/**
 * Where a step goes when separation of duties leaves no one to take it in its unit: up the tree until a unit has an
 * eligible holder of the role (a one-person office's step goes to its parent). `chain` runs from the region down to the
 * assigned unit; `holders` lists who holds the role in a unit. Null when no unit up to the region has anyone: the runner
 * refuses the transition rather than relax the rule.
 */
export function routeStep(
    chain: readonly UnitRef[],
    holders: (unitId: string) => readonly string[],
    excluded: ReadonlySet<string>
): Routing | null {
    for (let i = chain.length - 1, hops = 0; i >= 0; i--, hops++) {
        const unit = chain[i];
        if (!unit) continue;
        const eligible = holders(unit.id).filter((u) => !excluded.has(u));
        if (eligible.length) return { unit, hops, eligible };
    }
    return null;
}
