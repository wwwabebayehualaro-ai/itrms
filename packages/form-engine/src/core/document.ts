/**
 * Is a stored form one the engine can read? Two layers, both run by the API on every save (and usable by the designer):
 *   - the contract (`formConfigSchema` with this engine's field types): the document's shape, known types, data sources;
 *   - the structure: unique keys, parents that exist, no container inside itself.
 * Forms saved by older builders may carry more keys than the contract names: they are allowed. A bare list of fields (the
 * oldest format) is read as `{ fields: [...] }`.
 */
import { formConfigSchema } from '@itrms/schemas';

import { FIELD_TYPES } from './fieldTypes';
import { checkRuleFormula } from './runtime/formula';

type StoredValidation = {
    requiredWhen?: { expression: string } | null;
    validWhen?: { expression: string }[] | null;
};

export interface DocumentProblem {
    /** where, from the document's root: `fields[2].parentId` */
    path: string;
    message: string;
}

/** At most this many problems are reported (the first ones, by path). */
export const MAX_PROBLEMS = 20;

const contract = formConfigSchema([...FIELD_TYPES]);
// a value is read as `values[key]`: never a key an object inherits (toString, valueOf, __proto__ …); nor a built-in
// column of the submissions, in the API's words or the screens' (a filter on it would filter the built-in)
const BUILTIN_COLUMNS = ['createdAt', 'submittedBy', 'handlingUnit', 'created_at', 'submitted_by', 'handling_unit'];
const RESERVED_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype', ...BUILTIN_COLUMNS]);

const where = (path: readonly PropertyKey[]) =>
    path.map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i ? '.' : ''}${String(p)}`)).join('') || '(document)';

function structure(fields: readonly { id: string; parentId?: string | number | null }[]): DocumentProblem[] {
    const problems: DocumentProblem[] = [];
    const index = new Map<string, number>();
    fields.forEach((f, i) => {
        const key = f.id;
        if (RESERVED_KEYS.has(key))
            problems.push({ path: `fields[${i}].id`, message: `"${key}" cannot be a field key` });
        const first = index.get(key);
        if (first === undefined) index.set(key, i);
        else problems.push({ path: `fields[${i}].id`, message: `The key "${key}" is used by field ${first + 1} too` });
    });
    const parentOf = new Map(
        fields.map((f) => [
            f.id,
            f.parentId === undefined || f.parentId === null || f.parentId === '' ? null : String(f.parentId)
        ])
    );
    fields.forEach((f, i) => {
        const key = f.id;
        const parent = parentOf.get(key);
        if (!parent) return;
        if (!index.has(parent)) {
            problems.push({
                path: `fields[${i}].parentId`,
                message: `"${key}" sits in "${parent}", which is not a field of this form`
            });
            return;
        }
        const seen = new Set([key]);
        for (let at: string | null | undefined = parent; at; at = parentOf.get(at)) {
            if (seen.has(at)) {
                problems.push({
                    path: `fields[${i}].parentId`,
                    message: `"${key}" is inside itself (its containers form a loop)`
                });
                break;
            }
            seen.add(at);
        }
    });
    return problems;
}

/** Two test cases of a form cannot share an id. */
function testCaseProblems(cases: readonly { id: string }[] | undefined): DocumentProblem[] {
    const problems: DocumentProblem[] = [];
    const first = new Map<string, number>();
    (cases ?? []).forEach((c, i) => {
        const at = first.get(c.id);
        if (at === undefined) first.set(c.id, i);
        else
            problems.push({
                path: `testCases[${i}].id`,
                message: `The test case "${c.id}" is used by case ${at + 1} too`
            });
    });
    return problems;
}

/** The problems of a stored form; empty when the engine can read it. */
export function checkDocument(raw: unknown): DocumentProblem[] {
    const doc = Array.isArray(raw) ? { fields: raw } : raw;
    const parsed = contract.safeParse(doc);
    if (!parsed.success)
        return parsed.error.issues
            .map((issue) => {
                const last = issue.path[issue.path.length - 1];
                const unknownType = issue.code === 'invalid_value' && last === 'type';
                const value = unknownType ? valueAt(doc, issue.path) : undefined;
                return {
                    path: where(issue.path),
                    message: unknownType
                        ? `"${String(value)}" is not a field type this version knows`
                        : issue.message.slice(0, 300)
                };
            })
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
            .slice(0, MAX_PROBLEMS);
    return [
        ...structure(parsed.data.fields),
        ...testCaseProblems(parsed.data.testCases),
        ...ruleProblems(parsed.data.fields),
        ...lookupProblems(parsed.data.fields)
    ].slice(0, MAX_PROBLEMS);
}

/** A rule's formula (requiredWhen, validWhen) must parse, call known functions and read only what the server has too. */
function ruleProblems(fields: readonly { behavior?: unknown }[]): DocumentProblem[] {
    const problems: DocumentProblem[] = [];
    fields.forEach((f, i) => {
        const validation = (f.behavior as { validation?: StoredValidation | null } | null | undefined)?.validation;
        const base = `fields[${i}].behavior.validation`;
        const check = (expression: string | undefined, path: string) => {
            const message = expression === undefined ? null : checkRuleFormula(expression);
            if (message) problems.push({ path, message });
        };
        check(validation?.requiredWhen?.expression, `${base}.requiredWhen.expression`);
        validation?.validWhen?.forEach((rule, j) => check(rule.expression, `${base}.validWhen[${j}].expression`));
    });
    return problems;
}

/** A registry lookup must name the provider it reads (whether the provider exists is the server's check). */
function lookupProblems(fields: readonly { type: string; props?: unknown }[]): DocumentProblem[] {
    const problems: DocumentProblem[] = [];
    fields.forEach((f, i) => {
        if (f.type !== 'RegistryLookup') return;
        const provider = (f.props as { provider?: unknown } | null | undefined)?.provider;
        if (typeof provider !== 'string' || provider.trim() === '')
            problems.push({ path: `fields[${i}].props.provider`, message: 'A registry lookup needs a provider' });
    });
    return problems;
}

function valueAt(doc: unknown, path: readonly PropertyKey[]): unknown {
    let at: unknown = doc;
    for (const p of path) at = at && typeof at === 'object' ? (at as Record<PropertyKey, unknown>)[p] : undefined;
    return at;
}
