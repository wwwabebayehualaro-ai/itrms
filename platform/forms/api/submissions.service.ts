/**
 * Submissions (task 0.16a; form-platform.md G1, security.md SEC-IN-4): answers are checked on the server with the same
 * engine the browser runs (`@itrms/form-engine/core`), on the version the person filled in, which must still be the
 * published one. Only the form's own fields are kept and hidden fields' values are dropped before the rules run; what is
 * stored is what was checked. A submission keeps its version for good: publishing a newer one never touches it.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { users } from '@itrms/kernel/tables';
import { auditLog, insertAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { knownValues, submittedValues, validateForm, type EngineField } from '@itrms/form-engine/core';
import type { z } from 'zod';

import type { HistoryEntry, Submission, submissionCreateSchema, submissionListQuerySchema } from '../contracts';
import { formDefinitions, formVersions, submissions } from './forms.table';
import { namesOf, unitOf } from './forms.service';
import { lockFormShared, valueRows, writeValues, type Owner } from './submission-values';
import { fieldsFor, required, scopeFor } from './support';
import { filterableKinds, MAX_INDEXED_CHOICES } from './view-fields';

export type SubmissionRow = typeof submissions.$inferSelect;

@Injectable()
export class SubmissionsService {
    async create(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        input: z.infer<typeof submissionCreateSchema>,
        /** the language of the author's own messages in a 422 */
        language = 'am'
    ): Promise<Submission> {
        // first: a fill completing the form's filterable keys waits for this submission, or this reads its version
        await lockFormShared(tx, input.formId);
        const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, input.formId));
        if (!form) throw new NotFoundError();
        if (!form.active) throw new ConflictError('invalid_transition', { detail: 'This form takes no submissions.' });
        if (!form.publishedVersionId)
            throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        if (input.formVersionId !== form.publishedVersionId)
            throw new ConflictError('stale_version', {
                detail: 'A newer version of this form was published: reload it and fill it in again.'
            });
        const [version] = await tx
            .select({ document: formVersions.document })
            .from(formVersions)
            .where(eq(formVersions.id, form.publishedVersionId));
        if (!version) throw new NotFoundError();

        const fields = fieldsFor(version.document, roles, language);
        const scope = scopeFor(ctx, roles);
        const answers = submittedValues(fields, input.answers, scope);
        const errors = validateForm(fields, answers, scope);
        // the filterable fields' values (ADR-0035), from the version's fields nobody is restricted from
        const open = fieldsFor(version.document, []);
        const values = (owner: Owner) => valueRows(open, filterableKinds(open), answers, owner);
        for (const key of values({ submissionId: '', formId: '', regionId: '', handlingUnitId: '' }).overflow)
            errors[key] ??= `At most ${MAX_INDEXED_CHOICES} choices`;
        if (Object.keys(errors).length)
            throw new ValidationError('validation_failed', {
                detail: 'Some answers are not valid.',
                errors: Object.entries(errors).map(([path, message]) => ({ path, code: 'invalid', message }))
            });

        const row = await insertAudited(tx, submissions, {
            regionId: required(ctx.regionId),
            handlingUnitId: required(ctx.unitId),
            formId: form.id,
            formVersionId: form.publishedVersionId,
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
        return (await this.present(tx, roles, [row]))[0] as Submission;
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

    /** Submissions as the caller may see them: the values of fields restricted to other roles never leave the server. */
    async present(tx: Tx, roles: readonly string[], rows: readonly SubmissionRow[]): Promise<Submission[]> {
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
            return {
                id: row.id,
                version: row.rowVersion,
                formId: row.formId,
                formVersion: { id: row.formVersionId, number: version?.number ?? 0 },
                caseId: row.caseId,
                handlingUnit: unitOf(units, row.handlingUnitId),
                answers: version ? knownValues(version.fields, row.answers) : {},
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
