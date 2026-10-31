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
    hidden: (f: EngineField) => boolean
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
                return hidden(column) || (isFormArray(column) && holdsHidden(fields, column, v, hidden));
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
     *
     * A change of a filed request (`change`, task 0.21e) runs the rules over every answer, those the caller keeps as filed
     * too (a condition or a formula may read a field they may not see), takes from the caller only the answers of their
     * fields, and checks only those: what they keep was checked when it was filed, and may name records they cannot see.
     * What they keep is put back after the rules ran, as it was filed: the caller's rules never drop or reset it.
     */
    private async checked(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        document: unknown,
        raw: Record<string, unknown>,
        lookups: RegistryLookups,
        language: string,
        change?: { submissionId: string; kept: Record<string, unknown>; mine: (fieldId: string) => boolean }
    ) {
        const visible = fieldsFor(document, roles, language);
        const fields = change ? readDocument(document, { language }).fields : visible;
        const scope = scopeFor(ctx, roles);
        const settled = change
            ? { ...submittedValues(fields, { ...knownValues(visible, raw), ...change.kept }, scope), ...change.kept }
            : submittedValues(fields, raw, scope);
        const submitted = await resolveFiles(
            tx,
            fields,
            settled,
            language,
            ctx.userId,
            change ? { table: 'forms.submissions', id: change.submissionId } : undefined
        );
        const answers = submitted.answers;
        // the caller's to fix: a problem of a field they may change (its container chain theirs, a section's column too),
        // not kept as filed
        const theirs = (path: string): boolean => {
            if (!change) return true;
            const names = path.split(/[.[\]]/).filter((s) => s !== '' && !/^\d+$/.test(s));
            const root = names[0] ?? path;
            return change.mine(names[names.length - 1] ?? root) && !Object.hasOwn(change.kept, root);
        };
        const problems: AnswerProblem[] = submitted.problems.filter((p) => theirs(p.path));
        for (const [path, message] of Object.entries(validateForm(fields, answers, scope, { language })))
            if (theirs(path) && !problems.some((p) => p.path === path))
                problems.push({ path, code: 'invalid', message });
        problems.push(
            ...(
                await checkReferences(
                    tx,
                    lookups,
                    fields,
                    answers,
                    scope,
                    language,
                    new Set(problems.map((p) => p.path))
                )
            ).filter((p) => theirs(p.path))
        );
        // the filterable fields' values (ADR-0035), from the version's fields nobody is restricted from, never a Sensitive
        // one (no copy of it in clear: nothing may query it, task 0.20d)
        const open = openFieldsFor(document, []);
        const values = (all: Record<string, unknown>, owner: Owner) =>
            valueRows(open, filterableKinds(open), all, owner);
        for (const key of values(answers, { submissionId: '', formId: '', regionId: '', handlingUnitId: '' }).overflow)
            if (!problems.some((p) => p.path === key))
                problems.push({ path: key, code: 'invalid', message: tooManyChoices(language) });
        if (problems.length)
            throw new ValidationError('validation_failed', {
                detail: 'Some answers are not valid.',
                errors: problems
            });
        return {
            answers,
            files: submitted.files,
            values: (owner: Owner, all: Record<string, unknown> = answers) => values(all, owner)
        };
    }

    /**
     * Changes a case's request (task 0.21e): only through its workflow (an action that `amendsRequest`), on the version it
     * was filed on, checked again as a new request is. What the caller may not see (a field restricted to other roles)
     * keeps its stored answer, and so does a Sensitive one they leave out (it is shown masked); the answers it replaces
     * go to `submission_revisions` first, and the filterable values are written again, in the caller's transaction.
     * Answers the names of the fields whose answers changed, never their values.
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
        // every field holding a top-level answer (not a repeating section's column); the caller's are those they may
        // see with every container around them
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
        const shown = (values: Record<string, unknown>) => maskSensitive(visible, knownValues(visible, values));
        const masked = new Set(shown(before.answers).masked);
        // the answers the caller's own rules would drop or reset as filed (a field shown or open only to other roles by
        // its condition): another role's to change
        const settledBefore = submittedValues(all, before.answers, scopeFor(ctx, roles));
        const ruledOut = (id: string) => canonicalJson(settledBefore[id] ?? null) !== canonicalJson(before.answers[id]);
        // what the caller keeps as filed: what they may not see or change; a Sensitive answer shown masked that they leave
        // blank; a repeating section holding answers they may not see or change (its rows have no identity to merge them
        // by: changing such a section is refused, never a loss of what it holds)
        const kept: Record<string, unknown> = {};
        for (const f of all) {
            if (inRows.has(f.id) || !Object.hasOwn(before.answers, f.id)) continue;
            const stored = before.answers[f.id];
            if (!mine(f)) kept[f.id] = stored;
            else if (masked.has(f.id)) {
                if (blank(input.answers[f.id])) kept[f.id] = stored;
            } else if (!isFormArray(f) && ruledOut(f.id)) kept[f.id] = stored;
            else if (
                isFormArray(f) &&
                (ruledOut(f.id) || holdsHidden(all, f, stored, (c) => !mine(c) || sensitive(c)))
            ) {
                const sent = Object.hasOwn(input.answers, f.id) ? input.answers[f.id] : stored;
                if (
                    canonicalJson(withoutBlanks(shown({ [f.id]: sent }).values[f.id]) ?? null) !==
                    canonicalJson(withoutBlanks(shown({ [f.id]: stored }).values[f.id]) ?? null)
                )
                    throw new ValidationError('validation_failed', {
                        detail: 'Some answers are not valid.',
                        errors: [{ path: f.id, code: 'hidden_answers', message: sectionKept(language) }]
                    });
                kept[f.id] = stored;
            }
        }
        const checked = await this.checked(tx, ctx, roles, version.document, input.answers, lookups, language, {
            submissionId: before.id,
            kept,
            mine: (id) => {
                const f = byId.get(id);
                return f !== undefined && mine(f);
            }
        });
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
