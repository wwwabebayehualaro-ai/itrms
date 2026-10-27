/**
 * A form's test cases (task 0.18a): values a person could enter, run through the same rules the server runs on a
 * submission, against what the author said must happen. No database: registry lookups and files are checked by shape only.
 * A form is not published while a case fails.
 */
import { testCaseSchema, textLanguageOf } from '@itrms/schemas';

import type { EngineMessageKey } from './messages';
import { engineText } from './messages';
import { fieldsForRoles, readDocument } from './model';
import { getByPath } from './runtime/path';
import { submittedValues } from './values';
import { validateForm } from './validate';

/** The user the cases act as (conditions may read `user.id`): the nil UUID, no real person. */
export const CASE_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export interface TestMismatch {
    /** `valid`, `errors.<path>` or `values.<path>` */
    path: string;
    expected: unknown;
    actual: unknown;
    message: EngineMessageKey;
}

export interface TestCaseResult {
    id: string;
    name: string;
    passed: boolean;
    mismatches: TestMismatch[];
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) || Array.isArray(b))
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        return (
            ka.length === kb.length &&
            ka.every(
                (k) =>
                    Object.hasOwn(b, k) &&
                    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
            )
        );
    }
    return false;
}

/** The text of a mismatch, in a language. */
export const mismatchText = (language: string, m: TestMismatch): string =>
    engineText(language, m.message, { path: m.path.replace(/^(errors|values)\./, '') });

/** Runs every test case of a stored form; a case that is not a valid case fails with that. */
export function runTestCases(raw: unknown): TestCaseResult[] {
    const cases =
        !Array.isArray(raw) && raw && typeof raw === 'object' ? (raw as { testCases?: unknown }).testCases : [];
    if (!Array.isArray(cases)) return [];
    const formLanguage = textLanguageOf(raw);
    return (cases as unknown[]).map((entry, i): TestCaseResult => {
        const parsed = testCaseSchema.safeParse(entry);
        if (!parsed.success) {
            const named = entry && typeof entry === 'object' ? (entry as { id?: unknown; name?: unknown }) : {};
            return {
                id: typeof named.id === 'string' ? named.id : `#${i + 1}`,
                name: typeof named.name === 'string' ? named.name : `#${i + 1}`,
                passed: false,
                mismatches: [
                    {
                        path: 'valid',
                        expected: 'a test case',
                        actual: parsed.error.issues[0]?.message ?? 'invalid',
                        message: 'form-engine.core.tests.invalidCase'
                    }
                ]
            };
        }
        const c = parsed.data;
        const language = c.language ?? formLanguage;
        const roles = c.roles ?? [];
        const fields = fieldsForRoles(readDocument(raw, { language }).fields, roles);
        const scope = { user: { id: CASE_ACTOR_ID, roles: [...roles] } };
        const answers = submittedValues(fields, c.values, scope);
        const errors = validateForm(fields, answers, scope, { language });
        const failed = Object.keys(errors);
        const mismatches: TestMismatch[] = [];

        if (c.expect.valid !== (failed.length === 0))
            mismatches.push({
                path: 'valid',
                expected: c.expect.valid,
                actual: failed.length === 0,
                message: c.expect.valid
                    ? 'form-engine.core.tests.expectedValid'
                    : 'form-engine.core.tests.expectedInvalid'
            });
        const expectedErrors = c.expect.errors;
        if (expectedErrors) {
            for (const [path, want] of Object.entries(expectedErrors)) {
                const got = Object.hasOwn(errors, path) ? errors[path] : undefined;
                if (got === undefined)
                    mismatches.push({
                        path: `errors.${path}`,
                        expected: want,
                        actual: undefined,
                        message: 'form-engine.core.tests.errorMissing'
                    });
                else if (typeof want === 'string' && want !== got)
                    mismatches.push({
                        path: `errors.${path}`,
                        expected: want,
                        actual: got,
                        message: 'form-engine.core.tests.errorDiffers'
                    });
            }
            for (const path of failed)
                if (!Object.hasOwn(expectedErrors, path))
                    mismatches.push({
                        path: `errors.${path}`,
                        expected: undefined,
                        actual: errors[path],
                        message: 'form-engine.core.tests.errorUnexpected'
                    });
        }
        for (const [path, want] of Object.entries(c.expect.values ?? {})) {
            const got = getByPath(answers, path);
            if (!deepEqual(want, got))
                mismatches.push({
                    path: `values.${path}`,
                    expected: want,
                    actual: got,
                    message: 'form-engine.core.tests.valueDiffers'
                });
        }
        return { id: c.id, name: c.name, passed: mismatches.length === 0, mismatches };
    });
}
