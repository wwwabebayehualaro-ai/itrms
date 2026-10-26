/**
 * Shared by the forms services: the content hash of a document, the document check as a 422, and what the engine sees of
 * a form on the server (the caller's fields, the scope its conditions read).
 */
import { createHash } from 'node:crypto';

import type { DbContext } from '@itrms/kernel/db';
import { ForbiddenError, ValidationError } from '@itrms/kernel/errors';
import { checkDocument, readDocument, type EngineField, type Scope } from '@itrms/form-engine/core';

/** JSON with every object's keys sorted: the same document always gives the same text (jsonb does not keep key order). */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              )
            : v
    );
}

export const contentHash = (document: unknown) => createHash('sha256').update(canonicalJson(document)).digest('hex');

/** 422 with one entry per problem when the engine cannot read `document`. */
export function assertReadable(document: unknown): void {
    const problems = checkDocument(document);
    if (problems.length)
        throw new ValidationError('validation_failed', {
            detail: 'The form is not one this version can read.',
            errors: problems.map((p) => ({ path: `document.${p.path}`, code: 'invalid_form', message: p.message }))
        });
}

/**
 * 422 when a RegistryLookup field names a provider this installation does not have (a module not installed, or a typo).
 * A field without a provider is the document check's to report. Fields are a flat list (containers name their parent), so
 * nested ones are reached too.
 */
export function assertLookups(document: unknown, lookups: { get(key: string): unknown }): void {
    const list: unknown = Array.isArray(document) ? document : (document as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(list)) return;
    const problems: { path: string; code: string; message: string }[] = [];
    list.forEach((field: unknown, i) => {
        const f = field as { type?: unknown; props?: { provider?: unknown } } | null;
        const provider = f?.type === 'RegistryLookup' ? f.props?.provider : undefined;
        if (typeof provider === 'string' && provider !== '' && !lookups.get(provider))
            problems.push({
                path: `document.fields[${i}].props.provider`,
                code: 'invalid_form',
                message: `The registry "${provider}" is not available in this installation`
            });
    });
    if (problems.length)
        throw new ValidationError('validation_failed', {
            detail: 'The form names a registry this installation does not have.',
            errors: problems
        });
}

/**
 * The fields of a stored form the caller may see: a field with `visibleToRoles` only for those roles. A restricted
 * container takes its children with it (they are no longer reachable from the form's root), so their values are neither
 * shown, taken, nor checked. Texts (labels, options, messages) come resolved in `language`.
 */
export function fieldsFor(document: unknown, roles: readonly string[], language = 'am'): EngineField[] {
    return readDocument(document, { language }).fields.filter(
        (f) => !f.visibleToRoles?.length || f.visibleToRoles.some((r) => roles.includes(r))
    );
}

/** What conditions may read on the server besides the form: the caller (as the browser's `user`). */
export const scopeFor = (ctx: DbContext, roles: readonly string[]): Scope => ({
    user: { id: ctx.userId, roles: [...roles] }
});

/** The unit the caller acts for (a request without one cannot write). */
export function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detail: 'Choose the office you act for.' });
    return value;
}

/** A unique constraint refused the write (the database is the last word on writes at the same moment). */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
}
