/**
 * Key stability (task 0.18a). A field's key is its name in every answer ever submitted, in views, reports and formulas, so
 * the published form holds every key it ever published: a key leaves a form only flagged `removed` (the engine then neither
 * shows, takes nor checks it, and old answers stay readable). These helpers compare a candidate document with the published
 * one; the API and the builder both run them.
 */
import { storedFieldsOf, type FormField } from '@itrms/schemas';

import { valueKindOf } from './kinds';
import type { LintProblem } from './lint';
import { isFormArray, readDocument } from './model';
import { holdsValue } from './values';

export interface PublishedKey {
    /** The kind of value (`text`, `choice` …; `ref:<provider>` for a registry lookup): a key keeps its kind. */
    kind: string;
    /** The repeatable section the key sits in (its answers live in the rows), else null. Panels do not count. */
    scope: string | null;
    label: string;
    type: string;
}

/** The value-holding fields of a stored form by key (removed ones too: a flagged key is still a published key). */
export function publishedKeysOf(raw: unknown): Map<string, PublishedKey> {
    const { fields } = readDocument(raw);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out = new Map<string, PublishedKey>();
    for (const f of fields) {
        if (!holdsValue(f)) continue;
        const provider = f.props.provider;
        const kind =
            f.type === 'RegistryLookup'
                ? `ref:${typeof provider === 'string' ? provider : ''}`
                : (valueKindOf(f) ?? 'unknown');
        let scope: string | null = null;
        const seen = new Set([f.id]);
        let parent = f.parentId ? byId.get(f.parentId) : undefined;
        while (parent && !seen.has(parent.id)) {
            seen.add(parent.id);
            if (isFormArray(parent)) {
                scope = parent.id;
                break;
            }
            parent = parent.parentId ? byId.get(parent.parentId) : undefined;
        }
        out.set(f.id, { kind, scope, label: f.label, type: f.type });
    }
    return out;
}

const indexOfKey = (raw: unknown, key: string) =>
    Math.max(
        0,
        storedFieldsOf(raw).findIndex((f) => String(f.id) === key)
    );

/**
 * What a candidate document breaks of the base document's keys: a key that is gone (mark it removed instead), whose kind
 * changed (a text may become a text area; a single choice may not become a multiple one) or that moved into or out of a
 * repeatable section. Clearing `removed` (a restore) is allowed.
 */
export function checkKeyStability(base: unknown, candidate: unknown): LintProblem[] {
    const before = publishedKeysOf(base);
    const after = publishedKeysOf(candidate);
    const out: LintProblem[] = [];
    for (const [key, was] of before) {
        const now = after.get(key);
        if (!now)
            out.push({
                rule: 'key-missing',
                severity: 'error',
                fieldId: key,
                path: 'fields',
                message: 'form-engine.core.lint.key-missing',
                values: { key, label: was.label }
            });
        else if (now.kind !== was.kind)
            out.push({
                rule: 'key-retyped',
                severity: 'error',
                fieldId: key,
                path: `fields[${indexOfKey(candidate, key)}].type`,
                message: 'form-engine.core.lint.key-retyped',
                values: { key, was: was.kind, now: now.kind }
            });
        else if (now.scope !== was.scope)
            out.push({
                rule: 'key-moved',
                severity: 'error',
                fieldId: key,
                path: `fields[${indexOfKey(candidate, key)}].parentId`,
                message: 'form-engine.core.lint.key-moved',
                values: { key }
            });
    }
    return out;
}

/**
 * The document with every key of the published one it lacks, copied from the published one and flagged `removed` (inside its
 * container if that is still there, else at the top). Restoring an old version uses it: the result still holds every key.
 */
export function keepPublishedKeys(raw: unknown, publishedRaw: unknown): unknown {
    const fields: FormField[] = [...storedFieldsOf(raw)];
    const present = new Set(fields.map((f) => String(f.id)));
    const wanted = publishedKeysOf(publishedRaw);
    for (const f of storedFieldsOf(publishedRaw)) {
        const id = String(f.id);
        if (!wanted.has(id) || present.has(id)) continue;
        const parent = f.parentId === undefined || f.parentId === null ? null : String(f.parentId);
        fields.push({
            ...structuredClone(f),
            parentId: parent !== null && present.has(parent) ? parent : null,
            removed: true
        });
        present.add(id);
    }
    if (Array.isArray(raw)) return fields;
    return { ...(raw && typeof raw === 'object' ? raw : {}), fields };
}
