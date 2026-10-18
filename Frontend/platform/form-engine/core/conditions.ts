/**
 * Visibility / enablement rules (`behavior.visibilityConditions`, `enabledConditions`, data source `enabledWhen`).
 * A condition compares a value with a constant (which may be a `{{binding}}`); conditions in one list are combined with the
 * list's `logic` (taken from its first entry: `and` by default, `or`, `xor`), a condition with nested `conditions` is a
 * group (`operator: 'not'` negates it). No author code runs: operators are a fixed set.
 */
import type { VisibilityCondition } from './storedTypes';
import { getByPath, resolveBindings } from '../Runtime/expression';

export type Scope = Record<string, unknown>;

/** The value a condition looks at: a field of the current values (row or form), a scope entry, or a dotted path (`data.customer.type`, `user.role`, `root.total`). */
function subject(field: string, values: Record<string, unknown>, scope: Scope): unknown {
    if (!field) return undefined;
    if (field in values) return values[field];
    if (field in scope) return scope[field];
    return field.includes('.') ? getByPath({ form: values, ...scope }, field) : undefined;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function test(c: VisibilityCondition, values: Record<string, unknown>, scope: Scope): boolean {
    const actual = subject(c.field, values, scope) as never;
    const expected = resolveBindings(c.value, { form: values, ...scope }) as never;
    switch (c.operator) {
        case 'eq':
            return actual === expected;
        case 'neq':
            return actual !== expected;
        case 'gt':
            return actual > expected;
        case 'lt':
            return actual < expected;
        case 'gte':
            return actual >= expected;
        case 'lte':
            return actual <= expected;
        case 'contains':
            return Array.isArray(actual) ? (actual as unknown[]).includes(expected) : String(actual).includes(String(expected));
        case 'startsWith':
            return String(actual).startsWith(String(expected));
        case 'endsWith':
            return String(actual).endsWith(String(expected));
        case 'empty':
            return isEmpty(actual);
        case 'notEmpty':
            return !isEmpty(actual);
        case 'regex':
            try {
                return String(expected).length <= 200 && new RegExp(String(expected)).test(String(actual));
            } catch {
                return false;
            }
        case 'in':
            return Array.isArray(expected) ? (expected as unknown[]).includes(actual) : false;
        case 'notIn':
            return Array.isArray(expected) ? !(expected as unknown[]).includes(actual) : true;
        default:
            return true; // an operator this engine does not know never hides a field
    }
}

function evaluateOne(c: VisibilityCondition, values: Record<string, unknown>, scope: Scope): boolean {
    if (c.conditions?.length) {
        const nested = evaluateAll(c.conditions, values, scope);
        return c.operator === 'not' ? !nested : nested;
    }
    return test(c, values, scope);
}

const applies = (c: VisibilityCondition) => !((c.clientOnly && typeof window === 'undefined') || (c.serverOnly && typeof window !== 'undefined'));

/** True when the list holds (an empty list always holds). */
export function evaluateAll(conditions: VisibilityCondition[] | undefined, values: Record<string, unknown>, scope: Scope = {}): boolean {
    const list = (conditions ?? []).filter(applies);
    if (list.length === 0) return true;
    const results = list.map((c) => evaluateOne(c, values, scope));
    switch (list[0].logic ?? 'and') {
        case 'or':
            return results.some(Boolean);
        case 'xor':
            return results.filter(Boolean).length === 1;
        default:
            return results.every(Boolean);
    }
}

/** Every value a list of conditions reads (field ids and dotted paths), for subscriptions. */
export function conditionReferences(conditions: VisibilityCondition[] | undefined, acc: Set<string> = new Set()): Set<string> {
    for (const c of conditions ?? []) {
        if (c.field) acc.add(c.field.replace(/^form\./, ''));
        if (c.conditions) conditionReferences(c.conditions, acc);
    }
    return acc;
}
