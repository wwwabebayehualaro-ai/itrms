/**
 * Submissions (task 0.16a; form-platform.md G1, security.md SEC-IN-4): answers are checked on the server with the same
 * engine the browser runs (`@itrms/form-engine/core`), on the version the person filled in, which must still be the
 * published one. Only the form's own fields are kept and hidden fields' values are dropped before the rules run; what is
 * stored is what was checked. A submission keeps its version for good: publishing a newer one never touches it.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { insertAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { knownValues, readDocument, submittedValues, validateForm, type EngineField } from '@itrms/form-engine/core';
import type { z } from 'zod';

import type { Submission, submissionCreateSchema, submissionListQuerySchema } from '../contracts';
import { formDefinitions, formVersions, submissions } from './forms.table';
import { unitOf } from './forms.service';
import { valueRows, writeValues } from './submission-values';
import { fieldsFor, required, scopeFor } from './support';
import { filterableKeys } from './view-fields';

type SubmissionRow = typeof submissions.$inferSelect;

@Injectable()
export class SubmissionsService {
    async create(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        input: z.infer<typeof submissionCreateSchema>
    ): Promise<Submission> {
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

        const fields = fieldsFor(version.document, roles);
        const scope = scopeFor(ctx, roles);
        const answers = submittedValues(fields, input.answers, scope);
        const errors = validateForm(fields, answers, scope);
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
        // the filterable fields' values, in the same transaction (ADR-0035): every field the version marks, whoever filled it
        const all = readDocument(version.document).fields;
        await writeValues(
            tx,
            valueRows(all, filterableKeys(all), answers, {
                submissionId: row.id,
                formId: form.id,
                regionId: row.regionId,
                handlingUnitId: row.handlingUnitId
            })
        );
        return (await this.present(tx, roles, [row]))[0] as Submission;
    }

    async get(tx: Tx, roles: readonly string[], id: string): Promise<Submission> {
        const [row] = await tx.select().from(submissions).where(eq(submissions.id, id));
        if (!row) throw new NotFoundError();
        return (await this.present(tx, roles, [row]))[0] as Submission;
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
                    eq(submissions.formId, query.formId),
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
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString()
            };
        });
    }
}
