/**
 * Form governance (task 0.18a): what a document must satisfy before it can go live (key stability, lint, test cases), what
 * a publication changes (the diff) and whom it affects (saved views that use a changed key).
 */
import { Logger } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import {
    checkKeyStability,
    diffDocuments,
    engineText,
    lintDocument,
    mismatchText,
    runTestCases,
    type LintProblem
} from '@itrms/form-engine/core';
import { type Tx } from '@itrms/kernel/db';
import { ValidationError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';

import {
    DATA_SOURCE_ALLOWLIST,
    type IMPACT_REASONS,
    viewConfigSchema,
    type CheckProblem,
    type ImpactView,
    type PublishCheck,
    type QueryGroup
} from '../contracts';
import { formVersions, savedViews, type formDefinitions } from './forms.table';

type DefinitionRow = typeof formDefinitions.$inferSelect;
type Reason = (typeof IMPACT_REASONS)[number];

const log = new Logger('FormsGovernance');
const IMPACT_LIMIT = 500;
const KEY_RULES = new Set<string>(['key-missing', 'key-retyped', 'key-moved']);
/** The change areas that can break a saved view's use of a key. */
const VIEW_BREAKING_AREAS = new Set<string>(['type', 'kind', 'parent', 'options', 'filterable']);

interface VersionRef {
    id: string;
    number: number;
    document: unknown;
}

interface Candidate {
    id: string | null;
    number: number | null;
    document: unknown;
}

/** The form's published version, or null when nothing was published yet. */
async function publishedVersion(tx: Tx, form: Pick<DefinitionRow, 'publishedVersionId'>): Promise<VersionRef | null> {
    if (!form.publishedVersionId) return null;
    const [row] = await tx
        .select({ id: formVersions.id, number: formVersions.number, document: formVersions.document })
        .from(formVersions)
        .where(eq(formVersions.id, form.publishedVersionId));
    return row ?? null;
}

/** The document of the form's published version, or null when nothing was published yet. */
export async function publishedDocument(tx: Tx, form: Pick<DefinitionRow, 'publishedVersionId'>): Promise<unknown> {
    return (await publishedVersion(tx, form))?.document ?? null;
}

const problemOf = (p: LintProblem, language: string): CheckProblem => ({
    code: p.rule,
    severity: p.severity,
    fieldId: p.fieldId,
    path: `document.${p.path}`,
    message: engineText(language, p.message, p.values)
});

/** The key-stability errors of a candidate against the published document (none when nothing was published). */
const keyProblems = (published: unknown, candidate: unknown): LintProblem[] =>
    published === null ? [] : checkKeyStability(published, candidate);

/** 422 when the candidate drops, retypes or moves a key the published version holds (it must be flagged removed instead). */
export function assertKeysStable(published: unknown, candidate: unknown, language: string): void {
    const problems = keyProblems(published, candidate);
    if (problems.length)
        throw new ValidationError('validation_failed', {
            detail: 'The form drops, retypes or moves a field that was already published: mark it removed instead.',
            errors: problems.map((p) => ({
                path: `document.${p.path}`,
                code: 'key_stability',
                message: engineText(language, p.message, p.values)
            }))
        });
}

/** What a candidate document changes against the published version, and whether it may go live. */
export async function publishCheck(
    tx: Tx,
    userId: string | undefined,
    form: Pick<DefinitionRow, 'id' | 'publishedVersionId'>,
    candidate: Candidate,
    language: string
): Promise<PublishCheck> {
    const base = await publishedVersion(tx, form);
    const lint = lintDocument(candidate.document, { dataSources: DATA_SOURCE_ALLOWLIST });
    const problems = [...keyProblems(base?.document ?? null, candidate.document), ...lint].map((p) =>
        problemOf(p, language)
    );
    const tests = runTestCases(candidate.document).map((t) => ({
        id: t.id,
        name: t.name,
        passed: t.passed,
        mismatches: t.mismatches.map((m) => ({ path: m.path, expected: m.expected, actual: m.actual }))
    }));
    const diff = diffDocuments(base?.document ?? { fields: [] }, candidate.document);
    // keys a view may no longer find or read the same way: gone, retyped, moved or with other choices
    const changed = new Set(diff.removed.map((f) => f.key));
    for (const c of diff.changed) if (c.changes.some((x) => VIEW_BREAKING_AREAS.has(x.area))) changed.add(c.key);
    return {
        canPublish: !problems.some((p) => p.severity === 'error') && tests.every((t) => t.passed),
        base: base ? { id: base.id, number: base.number } : null,
        candidate: { id: candidate.id, number: candidate.number },
        problems,
        tests,
        diff,
        impact: { views: await impact(tx, userId, form.id, changed) }
    };
}

/**
 * 422 when the candidate cannot go live: a key of the published version dropped, retyped or moved, a lint error, or a
 * failing test case (warnings never block). Each entry names where: `document.fields[2].type`, `document.testCases[0]`.
 */
export async function assertPublishable(
    tx: Tx,
    userId: string | undefined,
    form: Pick<DefinitionRow, 'id' | 'publishedVersionId'>,
    candidate: Candidate,
    language: string
): Promise<PublishCheck> {
    const check = await publishCheck(tx, userId, form, candidate, language);
    const errors = check.problems.filter((p) => p.severity === 'error');
    const failed = check.tests.filter((t) => !t.passed);
    log.log({
        msg: 'form publish check',
        formId: form.id,
        errors: errors.length,
        warnings: check.problems.length - errors.length,
        failedTests: failed.length
    });
    if (errors.length === 0 && failed.length === 0) return check;
    throw new ValidationError('validation_failed', {
        detail: 'The form cannot be published: fix what is listed.',
        errors: [
            ...errors.map((p) => ({
                path: p.path,
                code: KEY_RULES.has(p.code) ? 'key_stability' : `lint.${p.code}`,
                message: p.message
            })),
            ...runTestCases(candidate.document).flatMap((r, i) => {
                const mismatch = r.mismatches[0];
                return r.passed
                    ? []
                    : [
                          {
                              path: `document.testCases[${i}]`,
                              code: 'test_case',
                              message: mismatch ? `${r.name}: ${mismatchText(language, mismatch)}` : r.name
                          }
                      ];
            })
        ]
    });
}

/** Every string at any depth of a view's mode options. */
function stringsOf(value: unknown, out: Set<string>, depth = 0): void {
    if (depth > 12) return;
    if (typeof value === 'string') out.add(value);
    else if (Array.isArray(value)) for (const v of value) stringsOf(v, out, depth + 1);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out, depth + 1);
}

/** The keys a view's filter names, at any nesting. */
function filterKeys(group: QueryGroup, out: Set<string>): void {
    for (const item of group.items) {
        if ('items' in item) filterKeys(item, out);
        else out.add(item.field);
    }
}

/**
 * The saved views of the form that use one of `changedKeys`: the unit's shared views and the caller's own private ones
 * (others' private views are never listed or counted: their existence is their owner's alone). Under RLS, so only views
 * of units the caller can see.
 */
export async function impact(
    tx: Tx,
    userId: string | undefined,
    formId: string,
    changedKeys: ReadonlySet<string>
): Promise<ImpactView[]> {
    if (changedKeys.size === 0) return [];
    const rows = await tx
        .select()
        .from(savedViews)
        .where(
            and(
                eq(savedViews.formId, formId),
                userId
                    ? or(eq(savedViews.visibility, 'unit'), eq(savedViews.createdBy, userId))
                    : eq(savedViews.visibility, 'unit')
            )
        )
        .orderBy(savedViews.name, savedViews.id)
        .limit(IMPACT_LIMIT);
    const units = await unitRefs(
        tx,
        rows.map((r) => r.unitId)
    );
    const out: ImpactView[] = [];
    for (const row of rows) {
        const config = viewConfigSchema.safeParse(row.config);
        if (!config.success) continue;
        const used = new Map<string, Set<Reason>>();
        const note = (key: string, reason: Reason) => {
            if (!changedKeys.has(key)) return;
            const reasons = used.get(key) ?? new Set<Reason>();
            reasons.add(reason);
            used.set(key, reasons);
        };
        const inFilter = new Set<string>();
        if (config.data.filter) filterKeys(config.data.filter, inFilter);
        for (const k of inFilter) note(k, 'filter');
        for (const s of config.data.sort) note(s.field, 'sort');
        for (const c of config.data.columns) note(c, 'column');
        const inOptions = new Set<string>();
        stringsOf(config.data.options, inOptions);
        for (const k of inOptions) note(k, 'option');
        if (used.size === 0) continue;
        out.push({
            id: row.id,
            name: row.name,
            visibility: row.visibility,
            unit: units.get(row.unitId) ?? { id: row.unitId, code: '', name: {} },
            mine: row.createdBy === userId,
            keys: [...used].map(([key, reasons]) => ({ key, reasons: [...reasons] }))
        });
    }
    return out;
}
