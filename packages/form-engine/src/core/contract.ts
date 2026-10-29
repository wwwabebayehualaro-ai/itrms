/**
 * An effect's input contract against a form (form-platform.md §3; task 0.21d), UI-free: the API checks it when a service
 * version is published and when a form a service's effects read gets a new version; the builder shows what it locks.
 *
 * A required contract field must be one the server's own filing always requires and keeps: a top-level field of the
 * form (never inside a repeating section, never under a container taken out of the form), of the kind asked, required
 * and validated, and never hidden, disabled or kept from some roles (its own condition or a container's): each of those
 * would let a request be filed without it. The same rules as the server's validation, read from the same model.
 */
import type { ContractKind, ContractProblem, EffectContract } from '@itrms/schemas';

import { isIsoDay } from './dates';
import { valueKindOf } from './kinds';
import { isFormArray, readDocument, rowScopedIds, type EngineField } from './model';

/** The form key a contract path reads (the service version's mapping, else the same key). */
export const keyOf = (path: string, map?: Readonly<Record<string, string>>): string => map?.[path] ?? path;

/** The field and the containers it sits in, nearest first. */
function* chainOf(field: EngineField, byId: ReadonlyMap<string, EngineField>): Generator<EngineField> {
    for (let f: EngineField | undefined = field; f; f = f.parentId ? byId.get(f.parentId) : undefined) yield f;
}

/** What the form lacks for the contract: empty when the form meets it. */
export function checkContract(
    contract: EffectContract,
    document: unknown,
    map?: Readonly<Record<string, string>>
): ContractProblem[] {
    // every field, removed ones too: a field under a removed container is gone from the form with it
    const fields = readDocument(document).fields;
    const byId = new Map(fields.map((f) => [f.id, f]));
    const inRows = rowScopedIds(fields);
    const problems: ContractProblem[] = [];
    for (const [path, want] of Object.entries(contract)) {
        const key = keyOf(path, map);
        const field = byId.get(key);
        const required = want.required ?? true;
        const chain = field ? [...chainOf(field, byId)] : [];
        if (!field || chain.some((f) => f.removed) || (inRows.has(field.id) && want.kind !== 'rows')) {
            // an optional field may be absent: the effect copes without it
            if (required) problems.push({ path, key, code: 'missing' });
            continue;
        }
        const kind = valueKindOf(field);
        if (kind !== want.kind) {
            problems.push({ path, key, code: 'wrong_kind', expected: want.kind, actual: kind });
            continue;
        }
        if (!required) continue;
        const enforced = isFormArray(field) ? field.rules.required || field.rules.minItems > 0 : field.rules.required;
        if (!field.validated || !enforced) problems.push({ path, key, code: 'not_required' });
        else if (chain.some((f) => (f.visibleToRoles?.length ?? 0) > 0))
            problems.push({ path, key, code: 'restricted' });
        else if (chain.some((f) => f.visibleWhen.length > 0 || f.enabledWhen.length > 0))
            problems.push({ path, key, code: 'conditional' });
    }
    return problems;
}

/** The fields a contract locks in a form: by form key, what it asks for. */
export function contractLocks(
    contract: EffectContract,
    map?: Readonly<Record<string, string>>
): { key: string; path: string; kind: ContractKind; required: boolean }[] {
    return Object.entries(contract).map(([path, want]) => ({
        key: keyOf(path, map),
        path,
        kind: want.kind,
        required: want.required ?? true
    }));
}

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Whether a stored value has the shape of a kind (what the effect may rely on, whatever filed it). */
export function valueOfKind(kind: ContractKind, v: unknown): boolean {
    switch (kind) {
        case 'text':
            return typeof v === 'string';
        case 'number':
            return typeof v === 'number' && Number.isFinite(v);
        case 'boolean':
            return typeof v === 'boolean';
        case 'date':
        case 'ethdate':
            return typeof v === 'string' && isIsoDay(v);
        case 'datetime':
            return typeof v === 'string' && !Number.isNaN(new Date(v).getTime());
        case 'choice':
            return isScalar(v);
        case 'multi':
            return Array.isArray(v) && v.every(isScalar);
        case 'range':
            return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');
        case 'files':
        case 'rows':
            return Array.isArray(v);
        case 'ref':
            return typeof v === 'string' && UUID.test(v);
    }
}

/**
 * The effect's input from a submission's answers, by contract path: the values of the keys the contract reads, each of its
 * kind. The paths a required value lacks, and those whose value is not of the kind asked, are named: the answers were
 * validated on their form when filed, but the contract may have changed since, or a computed field filled one.
 */
export function contractInput(
    contract: EffectContract,
    answers: Readonly<Record<string, unknown>>,
    map?: Readonly<Record<string, string>>
): { input: Record<string, unknown>; missing: string[]; invalid: string[] } {
    const input: Record<string, unknown> = {};
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const [path, want] of Object.entries(contract)) {
        const value = answers[keyOf(path, map)];
        if (blank(value)) {
            if (want.required ?? true) missing.push(path);
            continue;
        }
        if (!valueOfKind(want.kind, value)) {
            invalid.push(path);
            continue;
        }
        input[path] = value;
    }
    return { input, missing, invalid };
}
