/**
 * An effect's input contract against a form (form-platform.md §3; task 0.21d), UI-free: the API checks it when a service
 * version is published and when a form a service's effects read gets a new version; the builder shows what it locks.
 * A required contract field must be a top-level field of the form (never inside a repeating section, unless it asks for the rows),
 * of the kind asked, required when the contract requires it, and then never hidden by a condition (its own or a
 * container's) that could leave the effect without it.
 */
import type { ContractKind, ContractProblem, EffectContract } from '@itrms/schemas';

import { valueKindOf } from './kinds';
import { readDocument, rowScopedIds, type EngineField } from './model';

/** The form key a contract path reads (the service version's mapping, else the same key). */
export const keyOf = (path: string, map?: Readonly<Record<string, string>>): string => map?.[path] ?? path;

/** Whether the field, or a container it sits in, has a visibility condition. */
function conditional(field: EngineField, byId: ReadonlyMap<string, EngineField>): boolean {
    for (let f: EngineField | undefined = field; f; f = f.parentId ? byId.get(f.parentId) : undefined)
        if (f.visibleWhen.length > 0) return true;
    return false;
}

/** What the form lacks for the contract: empty when the form meets it. */
export function checkContract(
    contract: EffectContract,
    document: unknown,
    map?: Readonly<Record<string, string>>
): ContractProblem[] {
    const fields = readDocument(document).fields.filter((f) => !f.removed);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const inRows = rowScopedIds(fields);
    const problems: ContractProblem[] = [];
    for (const [path, want] of Object.entries(contract)) {
        const key = keyOf(path, map);
        const field = byId.get(key);
        const required = want.required ?? true;
        if (!field || inRows.has(field.id)) {
            // an optional field may be absent: the effect copes without it
            if (required) problems.push({ path, key, code: 'missing' });
            continue;
        }
        const kind = valueKindOf(field);
        if (kind !== want.kind) {
            problems.push({ path, key, code: 'wrong_kind', expected: want.kind, actual: kind });
            continue;
        }
        if (required && !field.rules.required) problems.push({ path, key, code: 'not_required' });
        else if (required && conditional(field, byId)) problems.push({ path, key, code: 'conditional' });
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

/**
 * The effect's input from a submission's answers, by contract path: the values of the keys the contract reads. The paths a
 * required field lacks are named (the answers were validated on their form when filed; this is the effect's own guard).
 */
export function contractInput(
    contract: EffectContract,
    answers: Readonly<Record<string, unknown>>,
    map?: Readonly<Record<string, string>>
): { input: Record<string, unknown>; missing: string[] } {
    const input: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const [path, want] of Object.entries(contract)) {
        const value = answers[keyOf(path, map)];
        if (blank(value)) {
            if (want.required ?? true) missing.push(path);
            continue;
        }
        input[path] = value;
    }
    return { input, missing };
}
