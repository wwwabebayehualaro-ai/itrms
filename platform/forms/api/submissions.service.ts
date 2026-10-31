/**
 * Submissions (task 0.16a; form-platform.md G1, security.md SEC-IN-4): answers are checked on the server with the same
 * engine the browser runs (`@itrms/form-engine/core`), on the version the person filled in, which must still be the
 * published one. Only the form's own fields are kept and hidden fields' values are dropped before the rules run; what is
 * stored is what was checked. A submission keeps its version for good: publishing a newer one never touches it.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { users } from '@itrms/kernel/tables';
import { auditLog, canonicalJson, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { linkFile } from '@itrms/kernel/files';
import { ConflictError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import {
    knownValues,
    answerDerived,
    holdsValue,
    initialValueOf,
    isFormArray,
    maskSensitive,
    onlySensitive,
    readDocument,
    rowScopedIds,
    submittedValues,
    validateForm,
    type EngineField
} from '@itrms/form-engine/core';
import type { z } from 'zod';

import type { HistoryEntry, Submission, submissionCreateSchema, submissionListQuerySchema } from '../contracts';
import { formDefinitions, formVersions, submissionRevisions, submissions } from './forms.table';
import type { RegistryLookups } from './lookups';
import { fileDraft } from './drafts.service';
import { namesOf, unitOf } from './forms.service';
import { checkReferences, resolveFiles, type AnswerProblem } from './submission-refs';
import { clearSubmissionValues, lockFormShared, valueRows, writeValues, type Owner } from './submission-values';
import { approvedVersions, documentFor, fieldsFor, openFieldsFor, required, scopeFor } from './support';
import { filterableKinds, MAX_INDEXED_CHOICES } from './view-fields';

import am from '../messages/am.json';
import en from '../messages/en.json';

/** The 422 message of a field with more choices than the filterable values keep, in the caller's language. */
const sectionKept = (language: string): string =>
    (language === 'en' ? en : am)['forms.validation.sectionHasHiddenAnswers'];
const notEditable = (language: string): string => (language === 'en' ? en : am)['forms.validation.notEditable'];

/** No answer: what a form sends for a field left empty. */
const blank = (v: unknown): boolean =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** A section's rows without their empty answers (a form sends a column left empty in several ways). */
function withoutBlanks(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutBlanks);
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, v]) => !blank(v))
                .map(([k, v]) => [k, withoutBlanks(v)])
        );
    return value;
}

/**
 * Whether a section's stored rows hold an answer of a column `hidden` names (one the caller may not see or change),
 * at any depth: a column inside a layout container of the section sits in its rows too, a nested section's in its own.
 */
function holdsHidden(
    fields: readonly EngineField[],
    section: EngineField,
    stored: unknown,
    hidden: (f: EngineField) => boolean,
    defaultOf: (f: EngineField) => unknown
): boolean {
    if (!Array.isArray(stored)) return false;
    const byId = new Map(fields.map((f) => [f.id, f]));
    const inSection = (f: EngineField): boolean => {
        for (
            let p = f.parentId ? byId.get(f.parentId) : undefined;
            p;
            p = p.parentId ? byId.get(p.parentId) : undefined
        ) {
            if (p.id === section.id) return true;
            if (isFormArray(p)) return false;
        }
        return false;
    };
    const columns = new Map(fields.filter(inSection).map((f) => [f.id, f]));
    return stored.some(
        (row) =>
            row !== null &&
            typeof row === 'object' &&
            Object.entries(row as Record<string, unknown>).some(([key, v]) => {
                const column = columns.get(key);
                if (!column || blank(v)) return false;
                const initial = defaultOf(column);
                if (initial !== undefined && canonicalJson(v) === canonicalJson(initial)) return false;
                return hidden(column) || (isFormArray(column) && holdsHidden(fields, column, v, hidden, defaultOf));
            })
    );
}

const tooManyChoices = (language: string): string =>
    (language === 'en' ? en : am)['forms.validation.tooManyChoices'].replace('{max}', String(MAX_INDEXED_CHOICES));

export type SubmissionRow = typeof submissions.$inferSelect;

@Injectable()
export class SubmissionsService {
    async create(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        input: z.infer<typeof submissionCreateSchema>,
        /** the registries a RegistryLookup field points into */
        lookups: RegistryLookups,
        /** the language of the author's own messages in a 422 */
        language = 'am',
        /**
         * A workflow step's answers (task 0.19b): filed on the case, on the version the step names (approved, though maybe
         * no longer the published one).
         */
        step?: { caseId: string; handlingUnitId: string }
    ): Promise<Submission> {
        // first: a fill completing the form's filterable keys waits for this submission, or this reads its version
        await lockFormShared(tx, input.formId);
        const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, input.formId));
        if (!form) throw new NotFoundError();
        if (!form.active) throw new ConflictError('invalid_transition', { detail: 'This form takes no submissions.' });
        // a step's version is the workflow's (checked when it was stored); a person's request is on the published one
        if (!step && !form.publishedVersionId)
            throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        if (!step && input.formVersionId !== form.publishedVersionId)
            throw new ConflictError('stale_version', {
                detail: 'A newer version of this form was published: reload it and fill it in again.'
            });
        const [version] = await tx
            .select({ id: formVersions.id, document: formVersions.document })
            .from(formVersions)
            .where(and(eq(formVersions.id, input.formVersionId), eq(formVersions.formId, form.id)));
        if (!version) throw new NotFoundError();
        // a step's version need not be the published one, but a second person approved it (SEC-AC-6)
        if (
            step &&
            version.id !== form.publishedVersionId &&
            !(await approvedVersions(tx, [version.id])).has(version.id)
        )
            throw new ConflictError('not_configured', { detail: 'This version of the form was never approved.' });

        const { answers, files, values } = await this.checked(
            tx,
            ctx,
            roles,
            version.document,
            input.answers,
            lookups,
            language
        );

        const row = await insertAudited(tx, submissions, {
            regionId: required(ctx.regionId),
            // a step's answers belong with the case (the actor may be an office above it)
            handlingUnitId: step?.handlingUnitId ?? required(ctx.unitId),
            formId: form.id,
            formVersionId: version.id,
            caseId: step?.caseId ?? null,
            answers
        });
        // in the same transaction, whoever filled them in
        await writeValues(
            tx,
            values({
                submissionId: row.id,
                formId: form.id,
                regionId: row.regionId,
                handlingUnitId: row.handlingUnitId
            }).rows
        );
        // the files now belong to the submission: they no longer expire
        for (const file of files)
            await linkFile(tx, file.id, {
                table: 'forms.submissions',
                id: row.id,
                ...(file.documentType ? { documentType: file.documentType } : {})
            });
        // the draft it was filled from is done with (task 0.20c)
        if (input.draftId) await fileDraft(tx, ctx, input.draftId, form.id);
        // a step's answers go on to the workflow's effects in clear; a person's request answers as it is shown
        return (await this.present(tx, roles, [row], { clear: !!step }))[0] as Submission;
    }

    /**
     * The answers as the server keeps them, checked with the engine on the version's fields the caller may see (G1): the
     * files read from their rows first (validation then sees real names and sizes), the references last; 422 with every
     * problem. With the rows of the filterable fields' values to write (ADR-0035).
     */
    private async checked(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        document: unknown,
        raw: Record<string, unknown>,
        lookups: RegistryLookups,
        language: string
    ) {
        const fields = fieldsFor(document, roles, language);
        const scope = scopeFor(ctx, roles);
        const submitted = await resolveFiles(tx, fields, submittedValues(fields, raw, scope), language, ctx.userId);
        const problems: AnswerProblem[] = [...submitted.problems];
        for (const [path, message] of Object.entries(validateForm(fields, submitted.answers, scope, { language })))
            if (!problems.some((p) => p.path === path)) problems.push({ path, code: 'invalid', message });
        problems.push(
            ...(await checkReferences(
                tx,
                lookups,
                fields,
                submitted.answers,
                scope,
                language,
                new Set(problems.map((p) => p.path))
            ))
        );
        return this.finished(document, submitted, problems, language);
    }

    /**
     * Checked answers with their filterable fields' values (ADR-0035), from the version's fields nobody is restricted
     * from, never a Sensitive one (no copy of it in clear: nothing may query it, task 0.20d); or 422 with every problem.
     */
    private finished(
        document: unknown,
        submitted: { answers: Record<string, unknown>; files: { id: string; documentType: string | null }[] },
        problems: AnswerProblem[],
        language: string
    ) {
        const open = openFieldsFor(document, []);
        const values = (all: Record<string, unknown>, owner: Owner) =>
            valueRows(open, filterableKinds(open), all, owner);
        for (const key of values(submitted.answers, { submissionId: '', formId: '', regionId: '', handlingUnitId: '' })
            .overflow)
            if (!problems.some((p) => p.path === key))
                problems.push({ path: key, code: 'invalid', message: tooManyChoices(language) });
        if (problems.length)
            throw new ValidationError('validation_failed', {
                detail: 'Some answers are not valid.',
                errors: problems
            });
        return {
            answers: submitted.answers,
            files: submitted.files,
            values: (owner: Owner, all: Record<string, unknown> = submitted.answers) => values(all, owner)
        };
    }

    /**
     * Changes a case's request (task 0.21e): only through its workflow (an action that `amendsRequest`), on the version it
     * was filed on. A change is a patch: what the caller changed, of the fields they may see and change, settled and
     * checked as a filing's answers are; every other answer stays exactly as it was filed (other roles' fields, Sensitive
     * answers, what the caller's own rules hide or close to them, a repeating section holding answers they may not see),
     * and a field derived from the answers alone is computed again. A field they may see but not change, sent changed, is
     * refused by name; a field they may not see is no answer of theirs (dropped, as when filing). A problem is reported
     * only where the caller can fix it. The answers it replaces go to `submission_revisions` first, and the filterable
     * values are written again, in the caller's transaction. Answers the names of the fields whose answers changed, never
     * their values.
     */
    async amend(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        input: { submissionId: string; answers: Record<string, unknown> },
        lookups: RegistryLookups,
        language = 'am'
    ): Promise<{ submission: Submission; changed: string[] }> {
        await lockFormShared(tx, (await this.rowOf(tx, input.submissionId)).formId);
        const [before] = await tx
            .select()
            .from(submissions)
            .where(eq(submissions.id, input.submissionId))
            .for('update');
        if (!before) throw new NotFoundError();
        const [version] = await tx
            .select({ document: formVersions.document })
            .from(formVersions)
            .where(eq(formVersions.id, before.formVersionId));
        if (!version) throw new NotFoundError();
        const stored = before.answers;
        // every field; the caller's are those they may see with every container around them
        const all = readDocument(version.document, { language }).fields;
        const byId = new Map(all.map((f) => [f.id, f]));
        const visible = fieldsFor(version.document, roles, language);
        const seen = new Set(visible.map((f) => f.id));
        const chain = (f: EngineField): EngineField[] => {
            const out: EngineField[] = [];
            for (let p: EngineField | undefined = f; p; p = p.parentId ? byId.get(p.parentId) : undefined) out.push(p);
            return out;
        };
        const mine = (f: EngineField): boolean => chain(f).every((p) => seen.has(p.id));
        const sensitive = (f: EngineField): boolean => chain(f).some((p) => p.classification === 'sensitive');
        const inRows = rowScopedIds(all);
        const scope = scopeFor(ctx, roles);
        const masked = new Set(maskSensitive(visible, knownValues(visible, stored)).masked);
        // the stored answers as the caller's own rules settle them: one they drop or reset is shown or open to other roles
        const settledBefore = submittedValues(all, stored, scope);
        const ruledOut = (id: string) => canonicalJson(settledBefore[id] ?? null) !== canonicalJson(stored[id] ?? null);
        // a section as the caller's form shows it, through the same rules (what they send back when they change nothing)
        const shownAs = (id: string, value: unknown) =>
            withoutBlanks(
                maskSensitive(visible, knownValues(visible, submittedValues(all, { ...stored, [id]: value }, scope)))
                    .values[id]
            ) ?? null;
        const hidesAnswers = (f: EngineField) =>
            isFormArray(f) &&
            holdsHidden(
                all,
                f,
                stored[f.id],
                (c) => !mine(c) || sensitive(c),
                (c) => initialValueOf(c, all)
            );
        // a field the caller sees but may not change: a Sensitive answer (shown masked); one their own rules hide or close
        // to them; a repeating section holding answers they may not see or change (its rows have no identity to merge
        // them by). A computed field is the server's: whatever is sent for it is no answer, as when filing.
        const locked = (f: EngineField): boolean => masked.has(f.id) || ruledOut(f.id) || hidesAnswers(f);
        // the nearest repeating section a column's answers sit in
        const sectionOf = (c: EngineField): string | undefined =>
            chain(c)
                .slice(1)
                .find((p) => isFormArray(p))?.id;
        // a section's columns (its own rows', not a nested section's) the caller may not see or change
        const guarded = (section: EngineField): EngineField[] =>
            all.filter((c) => holdsValue(c) && sectionOf(c) === section.id && (!mine(c) || sensitive(c)));
        // what the caller sends back as it was shown is no change; so is a form's default for a locked answer never given
        const unchanged = (f: EngineField, value: unknown): boolean => {
            if (masked.has(f.id)) return blank(value);
            if (isFormArray(f))
                return canonicalJson(shownAs(f.id, value)) === canonicalJson(shownAs(f.id, stored[f.id]));
            if (canonicalJson(value ?? null) === canonicalJson(stored[f.id] ?? null)) return true;
            if (Object.hasOwn(stored, f.id)) return false;
            return (
                blank(value) || (locked(f) && canonicalJson(value) === canonicalJson(initialValueOf(f, all) ?? null))
            );
        };
        // rows that give a Sensitive column an answer (other than its default), at any depth: a Sensitive answer changed
        const givesSensitive = (section: EngineField, value: unknown): boolean =>
            Array.isArray(value) &&
            value.some(
                (row) =>
                    row !== null &&
                    typeof row === 'object' &&
                    all.some((c) => {
                        if (!holdsValue(c) || sectionOf(c) !== section.id) return false;
                        const v = (row as Record<string, unknown>)[c.id];
                        if (isFormArray(c)) return givesSensitive(c, v);
                        return (
                            sensitive(c) &&
                            !blank(v) &&
                            canonicalJson(v) !== canonicalJson(initialValueOf(c, all) ?? null)
                        );
                    })
            );
        const patch: Record<string, unknown> = {};
        const refused: AnswerProblem[] = [];
        for (const [key, value] of Object.entries(input.answers)) {
            const f = byId.get(key);
            if (!f || inRows.has(key) || !holdsValue(f) || !mine(f) || f.computed?.readOnly === true) continue;
            if (unchanged(f, value)) continue;
            if (hidesAnswers(f)) refused.push({ path: key, code: 'hidden_answers', message: sectionKept(language) });
            else if (locked(f) || (isFormArray(f) && givesSensitive(f, value)))
                refused.push({ path: key, code: 'not_editable', message: notEditable(language) });
            else patch[key] = value;
        }
        if (refused.length)
            throw new ValidationError('validation_failed', { detail: 'Some answers are not valid.', errors: refused });

        // the patch settled as a filing's answers are; every other answer as filed
        const settled = submittedValues(all, { ...stored, ...knownValues(visible, patch) }, scope);
        const merged: Record<string, unknown> = { ...stored };
        const take = (id: string) => {
            if (Object.hasOwn(settled, id)) merged[id] = settled[id];
            else delete merged[id];
        };
        // a patched section's rows get back the columns the caller may not see or change at their defaults (it was
        // patchable only because those held nothing else)
        const withDefaults = (section: EngineField, rows: unknown): unknown =>
            Array.isArray(rows)
                ? rows.map((row: unknown) => {
                      if (row === null || typeof row !== 'object') return row;
                      const out = { ...(row as Record<string, unknown>) };
                      for (const c of all.filter((x) => holdsValue(x) && sectionOf(x) === section.id)) {
                          if (isFormArray(c)) {
                              if (Object.hasOwn(out, c.id)) out[c.id] = withDefaults(c, out[c.id]);
                          } else if (guarded(section).some((g) => g.id === c.id)) {
                              const initial = initialValueOf(c, all);
                              if (initial === undefined) delete out[c.id];
                              else out[c.id] = initial;
                          }
                      }
                      return out;
                  })
                : rows;
        for (const key of Object.keys(patch)) {
            take(key);
            const f = byId.get(key);
            if (f && isFormArray(f) && Object.hasOwn(merged, key)) merged[key] = withDefaults(f, merged[key]);
        }
        // a field derived from the answers alone is computed again (one the caller's rules leave alone), and so are the
        // derived columns of the rows the patch left as they were (their rows stand where they stood)
        const derivedRows = (section: EngineField, rows: unknown, again: unknown): unknown => {
            if (!Array.isArray(rows) || !Array.isArray(again) || rows.length !== again.length) return rows;
            return rows.map((row: unknown, i) => {
                const fresh = again[i] as Record<string, unknown> | undefined;
                if (row === null || typeof row !== 'object' || !fresh || typeof fresh !== 'object') return row;
                const out = { ...(row as Record<string, unknown>) };
                for (const c of all.filter((x) => sectionOf(x) === section.id)) {
                    if (isFormArray(c)) out[c.id] = derivedRows(c, out[c.id], fresh[c.id]);
                    else if (answerDerived(c)) {
                        if (Object.hasOwn(fresh, c.id)) out[c.id] = fresh[c.id];
                        else delete out[c.id];
                    }
                }
                return out;
            });
        };
        for (const f of all) {
            if (inRows.has(f.id) || ruledOut(f.id)) continue;
            if (answerDerived(f)) take(f.id);
            else if (isFormArray(f) && !Object.hasOwn(patch, f.id) && Object.hasOwn(merged, f.id))
                merged[f.id] = derivedRows(f, merged[f.id], settled[f.id]);
        }

        // a file the request holds stays usable only where it is held (never moved to another field)
        const heldFiles = new Map<string, Set<string>>();
        const collectFiles = (values: unknown) => {
            if (Array.isArray(values)) for (const row of values) collectFiles(row);
            else if (values !== null && typeof values === 'object')
                for (const [key, v] of Object.entries(values as Record<string, unknown>)) {
                    const f = byId.get(key);
                    if (f?.type === 'FileUpload' && Array.isArray(v))
                        for (const entry of v)
                            if (
                                entry &&
                                typeof entry === 'object' &&
                                typeof (entry as { file_id?: unknown }).file_id === 'string'
                            )
                                heldFiles.set(
                                    key,
                                    (heldFiles.get(key) ?? new Set()).add((entry as { file_id: string }).file_id)
                                );
                    if (f && isFormArray(f)) collectFiles(v);
                }
        };
        collectFiles(stored);
        const submitted = await resolveFiles(tx, all, merged, language, ctx.userId, {
            table: 'forms.submissions',
            id: before.id,
            holds: (fieldId, fileId) => heldFiles.get(fieldId)?.has(fileId) === true
        });
        const rootOf = (path: string) => /^[^.[]+/.exec(path)?.[0] ?? path;
        // the caller's to fix: what they changed (files, references), or a field they may change that is wanting now
        const theirs = (path: string): boolean => {
            const names = path.split(/[.[\]]/).filter((s) => s !== '' && !/^\d+$/.test(s));
            const root = byId.get(names[0] ?? '');
            const leaf = byId.get(names[names.length - 1] ?? '');
            return root !== undefined && leaf !== undefined && mine(leaf) && mine(root) && !locked(root);
        };
        const problems: AnswerProblem[] = submitted.problems.filter((p) => Object.hasOwn(patch, rootOf(p.path)));
        for (const [path, message] of Object.entries(validateForm(all, submitted.answers, scope, { language })))
            if (theirs(path) && !problems.some((p) => p.path === path))
                problems.push({ path, code: 'invalid', message });
        problems.push(
            ...(
                await checkReferences(
                    tx,
                    lookups,
                    all,
                    submitted.answers,
                    scope,
                    language,
                    new Set(problems.map((p) => p.path))
                )
            ).filter((p) => Object.hasOwn(patch, rootOf(p.path)))
        );
        const checked = this.finished(version.document, submitted, problems, language);
        const answers = checked.answers;
        const changed = [...new Set([...Object.keys(before.answers), ...Object.keys(answers)])]
            .filter((k) => canonicalJson(before.answers[k] ?? null) !== canonicalJson(answers[k] ?? null))
            .sort();
        // the workflow's effects read the request in clear, whether it changed or not
        if (changed.length === 0)
            return { submission: (await this.present(tx, roles, [before], { clear: true }))[0] as Submission, changed };
        await insertAudited(tx, submissionRevisions, {
            regionId: before.regionId,
            handlingUnitId: before.handlingUnitId,
            submissionId: before.id,
            revision: before.rowVersion,
            formVersionId: before.formVersionId,
            answers: before.answers
        });
        const after = await updateAudited(tx, submissions, before.id, before.rowVersion, { answers });
        await clearSubmissionValues(tx, before.id);
        await writeValues(
            tx,
            checked.values(
                {
                    submissionId: after.id,
                    formId: after.formId,
                    regionId: after.regionId,
                    handlingUnitId: after.handlingUnitId
                },
                answers
            ).rows
        );
        for (const file of checked.files)
            await linkFile(tx, file.id, {
                table: 'forms.submissions',
                id: after.id,
                ...(file.documentType ? { documentType: file.documentType } : {})
            });
        return { submission: (await this.present(tx, roles, [after], { clear: true }))[0] as Submission, changed };
    }

    private async rowOf(tx: Tx, id: string): Promise<SubmissionRow> {
        const [row] = await tx.select().from(submissions).where(eq(submissions.id, id));
        if (!row) throw new NotFoundError();
        return row;
    }

    /**
     * What a reveal of a submission would show (task 0.20d, SEC-PD-2): the ids of its Sensitive fields the caller may see
     * (each field, rows' too), read without their values so the reveal is on record with them before anything is shown.
     * Null when the caller does not see the submission.
     */
    async sensitiveOf(tx: Tx, roles: readonly string[], id: string): Promise<string[] | null> {
        const [row] = await tx.select().from(submissions).where(eq(submissions.id, id));
        if (!row) return null;
        const fields = await this.fieldsOfVersion(tx, roles, row.formVersionId);
        return maskSensitive(fields, knownValues(fields, row.answers)).masked.sort();
    }

    /** A submission's Sensitive answers (the reveal's read, after it is on record). */
    async revealed(tx: Tx, roles: readonly string[], id: string): Promise<{ answers: Record<string, unknown> }> {
        const [row] = await tx.select().from(submissions).where(eq(submissions.id, id));
        if (!row) throw new NotFoundError();
        const fields = await this.fieldsOfVersion(tx, roles, row.formVersionId);
        return { answers: onlySensitive(fields, knownValues(fields, row.answers)) };
    }

    private async fieldsOfVersion(tx: Tx, roles: readonly string[], versionId: string): Promise<EngineField[]> {
        const [version] = await tx
            .select({ document: formVersions.document })
            .from(formVersions)
            .where(eq(formVersions.id, versionId));
        return fieldsFor(version?.document, roles);
    }

    async get(tx: Tx, roles: readonly string[], id: string): Promise<Submission> {
        const [row] = await tx.select().from(submissions).where(eq(submissions.id, id));
        if (!row) throw new NotFoundError();
        return (await this.present(tx, roles, [row]))[0] as Submission;
    }

    /**
     * Who did what to a submission and when, newest first (task 0.16d), from the audit log as far as the caller's scope
     * reads it. The answers are in the log only as an HMAC: a change of them shows as "answers", never their values.
     */
    async history(tx: Tx, id: string): Promise<{ items: HistoryEntry[]; truncated: boolean }> {
        const [row] = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.id, id));
        if (!row) throw new NotFoundError();
        const entries = await tx
            .select({
                id: auditLog.id,
                action: auditLog.action,
                eventType: auditLog.eventType,
                at: auditLog.at,
                actorId: auditLog.actorId,
                diff: auditLog.diff
            })
            .from(auditLog)
            .where(and(eq(auditLog.tableName, 'forms.submissions'), eq(auditLog.rowId, id)))
            .orderBy(desc(auditLog.at), desc(auditLog.id))
            .limit(HISTORY_LIMIT + 1);
        const truncated = entries.length > HISTORY_LIMIT;
        entries.length = Math.min(entries.length, HISTORY_LIMIT);
        const actors = [...new Set(entries.map((e) => e.actorId).filter((a): a is string => Boolean(a)))];
        const names = actors.length
            ? new Map(
                  (
                      await tx
                          .select({ id: users.id, name: users.displayName })
                          .from(users)
                          .where(inArray(users.id, actors))
                  ).map((u) => [u.id, u.name])
              )
            : new Map<string, string>();
        const items = entries.map((e) => ({
            id: e.id,
            action: e.action === 'event' ? `event:${e.eventType ?? ''}` : e.action,
            at: e.at.toISOString(),
            actorId: e.actorId,
            actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
            changes: e.action === 'update' ? changedColumns(e.diff) : []
        }));
        return { items, truncated };
    }

    /**
     * A case's step forms (task 0.20b), in the order they were filed: each as the caller may see it, with its version's
     * document for the printed view, without the fields of other roles.
     */
    async ofCase(tx: Tx, roles: readonly string[], caseId: string): Promise<(Submission & { document: unknown })[]> {
        const rows = await tx
            .select()
            .from(submissions)
            .where(eq(submissions.caseId, caseId))
            .orderBy(asc(submissions.createdAt), asc(submissions.id));
        if (rows.length === 0) return [];
        const documents = new Map(
            (
                await tx
                    .select({ id: formVersions.id, document: formVersions.document })
                    .from(formVersions)
                    .where(inArray(formVersions.id, [...new Set(rows.map((r) => r.formVersionId))]))
            ).map((v) => [v.id, v.document])
        );
        return (await this.present(tx, roles, rows)).map((s) => ({
            ...s,
            document: documentFor(documents.get(s.formVersion.id) ?? null, roles)
        }));
    }

    /** A form's submissions in the caller's subtree, newest first, a page at a time. */
    async list(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        query: z.infer<typeof submissionListQuerySchema>
    ): Promise<{ items: Submission[]; next: string | null }> {
        const rows = await tx
            .select()
            .from(submissions)
            .where(
                and(
                    query.formId ? eq(submissions.formId, query.formId) : undefined,
                    query.mine === 'true' ? eq(submissions.createdBy, required(ctx.userId)) : undefined,
                    query.before ? lt(submissions.id, query.before) : undefined
                )
            )
            .orderBy(desc(submissions.id))
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        return {
            items: await this.present(tx, roles, page),
            next: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null
        };
    }

    /**
     * Submissions as the caller may see them: the values of fields restricted to other roles never leave the server, and
     * the Sensitive answers are left out (named in `masked`) unless `clear` (a workflow's own use of a step's answers).
     */
    async present(
        tx: Tx,
        roles: readonly string[],
        rows: readonly SubmissionRow[],
        options: { clear?: boolean } = {}
    ): Promise<Submission[]> {
        if (rows.length === 0) return [];
        const versions = await tx
            .select({ id: formVersions.id, number: formVersions.number, document: formVersions.document })
            .from(formVersions)
            .where(inArray(formVersions.id, [...new Set(rows.map((r) => r.formVersionId))]));
        const byId = new Map<string, { number: number; fields: EngineField[] }>(
            versions.map((v) => [v.id, { number: v.number, fields: fieldsFor(v.document, roles) }])
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        const people = await namesOf(
            tx,
            rows.map((r) => r.createdBy)
        );
        return rows.map((row) => {
            const version = byId.get(row.formVersionId);
            const known = version ? knownValues(version.fields, row.answers) : {};
            const shown =
                version && !options.clear ? maskSensitive(version.fields, known) : { values: known, masked: [] };
            return {
                id: row.id,
                version: row.rowVersion,
                formId: row.formId,
                formVersion: { id: row.formVersionId, number: version?.number ?? 0 },
                caseId: row.caseId,
                handlingUnit: unitOf(units, row.handlingUnitId),
                answers: shown.values,
                masked: shown.masked,
                submittedBy: row.createdBy,
                submittedByName: row.createdBy ? (people.get(row.createdBy) ?? null) : null,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString()
            };
        });
    }
}

/** The newest entries a history shows (it says when there are older ones). */
const HISTORY_LIMIT = 100;

/** What an update changed, by column, without the bookkeeping. */
function changedColumns(diff: unknown): string[] {
    const after = (diff as { after?: Record<string, unknown> } | null)?.after;
    return after ? Object.keys(after).filter((k) => !['updatedAt', 'updatedBy', 'rowVersion'].includes(k)) : [];
}
