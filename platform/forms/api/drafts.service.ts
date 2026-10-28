/**
 * Drafts of a request (task 0.20c): the answers so far, kept on the server for the person who started them, on the
 * published version they started (a newer one takes over when the draft is opened again and saved). A draft is the
 * person's alone (the reads and writes here are by `created_by`; RLS keeps it to the unit), is never validated (it is
 * half-filled by nature), and keeps only the form's own fields the person may see. Filing the request removes it in the
 * same transaction.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { deleteAudited, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { knownValues } from '@itrms/form-engine/core';
import type { z } from 'zod';

import {
    draftSummarySchema,
    type Draft,
    type DraftCreate,
    type DraftSummary,
    type DraftUpdate,
    type draftListQuerySchema
} from '../contracts';
import { unitOf } from './forms.service';
import { formDefinitions, formVersions, submissionDrafts } from './forms.table';
import { fieldsFor, required } from './support';

type DraftRow = typeof submissionDrafts.$inferSelect;

@Injectable()
export class DraftsService {
    /** The caller's drafts, the latest changed first, without their answers. */
    async list(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        query: z.infer<typeof draftListQuerySchema>
    ): Promise<{ items: DraftSummary[] }> {
        const rows = await tx
            .select()
            .from(submissionDrafts)
            .where(
                and(
                    eq(submissionDrafts.createdBy, required(ctx.userId)),
                    query.formId ? eq(submissionDrafts.formId, query.formId) : undefined
                )
            )
            .orderBy(desc(submissionDrafts.updatedAt))
            .limit(query.limit);
        return { items: (await this.present(tx, roles, rows)).map(summaryOf) };
    }

    async get(tx: Tx, ctx: DbContext, roles: readonly string[], id: string): Promise<Draft> {
        return (await this.present(tx, roles, [await this.own(tx, ctx, id)]))[0] as Draft;
    }

    async create(tx: Tx, ctx: DbContext, roles: readonly string[], input: DraftCreate): Promise<DraftSummary> {
        const document = await this.published(tx, input.formId, input.formVersionId);
        const row = await insertAudited(tx, submissionDrafts, {
            regionId: required(ctx.regionId),
            unitId: required(ctx.unitId),
            formId: input.formId,
            formVersionId: input.formVersionId,
            answers: knownValues(fieldsFor(document, roles), input.answers)
        });
        return summaryOf(await this.get(tx, ctx, roles, row.id));
    }

    /** The answers so far (If-Match: the draft's version); a newer published version to go on with. */
    async update(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        id: string,
        version: number,
        input: DraftUpdate
    ): Promise<DraftSummary> {
        const row = await this.own(tx, ctx, id);
        const versionId = input.formVersionId ?? row.formVersionId;
        const document =
            versionId === row.formVersionId
                ? await this.version(tx, row.formId, versionId)
                : await this.published(tx, row.formId, versionId);
        await updateAudited(tx, submissionDrafts, id, version, {
            formVersionId: versionId,
            answers: knownValues(fieldsFor(document, roles), input.answers)
        });
        return summaryOf(await this.get(tx, ctx, roles, id));
    }

    async remove(tx: Tx, ctx: DbContext, id: string, version: number): Promise<void> {
        await this.own(tx, ctx, id);
        await deleteAudited(tx, submissionDrafts, id, version);
    }

    // --- reading ------------------------------------------------------------------------------------------------------

    /** The caller's own draft: anyone else's is not found (a colleague's draft is not theirs to see). */
    private async own(tx: Tx, ctx: DbContext, id: string): Promise<DraftRow> {
        const [row] = await tx
            .select()
            .from(submissionDrafts)
            .where(and(eq(submissionDrafts.id, id), eq(submissionDrafts.createdBy, required(ctx.userId))));
        if (!row) throw new NotFoundError();
        return row;
    }

    /** A version of the form that people fill in now: a draft starts on, or moves to, the published one. */
    private async published(tx: Tx, formId: string, versionId: string): Promise<unknown> {
        const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, formId));
        if (!form) throw new NotFoundError();
        if (!form.active) throw new ConflictError('invalid_transition', { detail: 'This form takes no submissions.' });
        if (form.publishedVersionId !== versionId)
            throw new ConflictError('stale_version', {
                detail: 'Another version of this form is published now: open it again to go on with the draft.'
            });
        return this.version(tx, formId, versionId);
    }

    private async version(tx: Tx, formId: string, versionId: string): Promise<unknown> {
        const [version] = await tx
            .select({ document: formVersions.document })
            .from(formVersions)
            .where(and(eq(formVersions.id, versionId), eq(formVersions.formId, formId)));
        if (!version) throw new NotFoundError();
        return version.document;
    }

    private async present(tx: Tx, roles: readonly string[], rows: readonly DraftRow[]): Promise<Draft[]> {
        if (rows.length === 0) return [];
        const forms = new Map(
            (
                await tx
                    .select({
                        id: formDefinitions.id,
                        name: formDefinitions.name,
                        published: formDefinitions.publishedVersionId
                    })
                    .from(formDefinitions)
                    .where(inArray(formDefinitions.id, [...new Set(rows.map((r) => r.formId))]))
            ).map((f) => [f.id, f])
        );
        const versions = new Map(
            (
                await tx
                    .select({ id: formVersions.id, number: formVersions.number, document: formVersions.document })
                    .from(formVersions)
                    .where(inArray(formVersions.id, [...new Set(rows.map((r) => r.formVersionId))]))
            ).map((v) => [v.id, v])
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.unitId)
        );
        return rows.map((row) => {
            const form = forms.get(row.formId);
            const version = versions.get(row.formVersionId);
            return {
                id: row.id,
                version: row.rowVersion,
                formId: row.formId,
                formName: form?.name ?? {},
                formVersion: { id: row.formVersionId, number: version?.number ?? 0 },
                outdated: Boolean(form?.published && form.published !== row.formVersionId),
                unit: unitOf(units, row.unitId),
                answers: version ? knownValues(fieldsFor(version.document, roles), row.answers) : {},
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString()
            };
        });
    }
}

/** A draft without its answers (the summary's schema keeps only its own keys). */
const summaryOf = (draft: Draft): DraftSummary => draftSummarySchema.parse(draft);

/** Removes the caller's draft a request was filled from, with the filing (no-op if it is gone already: another tab). */
export async function fileDraft(tx: Tx, ctx: DbContext, draftId: string, formId: string): Promise<void> {
    const [row] = await tx
        .select({ id: submissionDrafts.id, rowVersion: submissionDrafts.rowVersion })
        .from(submissionDrafts)
        .where(
            and(
                eq(submissionDrafts.id, draftId),
                eq(submissionDrafts.formId, formId),
                eq(submissionDrafts.createdBy, required(ctx.userId))
            )
        )
        .for('update');
    if (row) await deleteAudited(tx, submissionDrafts, row.id, row.rowVersion);
}
