/**
 * Is a stored form one the engine can read? Two layers, both run by the API on every save (and usable by the designer):
 *   - the contract (`formConfigSchema` with this engine's field types): the document's shape, known types, data sources;
 *   - the structure: unique keys, parents that exist, no container inside itself.
 * Forms saved by older builders may carry more keys than the contract names: they are allowed. A bare list of fields (the
 * oldest format) is read as `{ fields: [...] }`.
 */
import { formConfigSchema } from '@itrms/schemas';

import { FIELD_TYPES } from './fieldTypes';

export interface DocumentProblem {
    /** where, from the document's root: `fields[2].parentId` */
    path: string;
    message: string;
}

/** At most this many problems are reported (the first ones, by path). */
export const MAX_PROBLEMS = 20;

const contract = formConfigSchema([...FIELD_TYPES]);
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const where = (path: readonly PropertyKey[]) =>
    path.map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i ? '.' : ''}${String(p)}`)).join('') || '(document)';

function structure(fields: readonly { id: string; parentId?: string | number | null }[]): DocumentProblem[] {
    const problems: DocumentProblem[] = [];
    const index = new Map<string, number>();
    fields.forEach((f, i) => {
        const key = f.id;
        // a value is stored under its field's key: never one an object inherits
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
    return structure(parsed.data.fields).slice(0, MAX_PROBLEMS);
}

function valueAt(doc: unknown, path: readonly PropertyKey[]): unknown {
    let at: unknown = doc;
    for (const p of path) at = at && typeof at === 'object' ? (at as Record<PropertyKey, unknown>)[p] : undefined;
    return at;
}
