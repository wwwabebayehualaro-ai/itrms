/**
 * Background exports (task 0.16e; the industry's pattern for large ones: a job, a file kept for a while, a short-lived
 * download link). One person asks; the worker makes the file with the scope and roles they had when they asked
 * (`jobs/run-export.ts`), as a generated file of `@itrms/kernel/files`; they alone follow it and download it, and every
 * download is on record. Others' exports are answered as missing.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { insertAudited, recordEvent, type DbContext, type Tx } from '@itrms/kernel/db';
import { NotFoundError, RateLimitedError } from '@itrms/kernel/errors';
import { downloadFile, files, type ObjectStore } from '@itrms/kernel/files';
import { emit } from '@itrms/kernel/outbox';

import { MAX_PENDING_EXPORTS, type ExportJob, type SubmissionExport } from '../contracts';
import { FormsService } from './forms.service';
import { submissionExports } from './forms.table';
import { required } from './support';

type ExportRow = typeof submissionExports.$inferSelect;

/** The first key of the per-person export locks (no other advisory lock shares it). */
const EXPORT_LOCK = 0x1e8a;

@Injectable()
export class ExportsService {
    constructor(@Inject(FormsService) private readonly forms: FormsService) {}

    async request(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        language: string,
        input: SubmissionExport
    ): Promise<ExportJob> {
        await this.forms.definition(tx, input.formId);
        // one person's requests one at a time: two at once cannot both pass the cap
        await tx.execute(sql`select pg_advisory_xact_lock(${EXPORT_LOCK}, hashtext(${required(ctx.userId)}))`);
        const [pending] = await tx
            .select({ n: count() })
            .from(submissionExports)
            .where(
                and(
                    eq(submissionExports.createdBy, required(ctx.userId)),
                    inArray(submissionExports.status, ['queued', 'running'])
                )
            );
        if ((pending?.n ?? 0) >= MAX_PENDING_EXPORTS)
            throw new RateLimitedError(30, {
                detail: `You have ${MAX_PENDING_EXPORTS} exports being made: wait for one to finish.`
            });
        const row = await insertAudited(tx, submissionExports, {
            regionId: required(ctx.regionId),
            unitId: required(ctx.unitId),
            formId: input.formId,
            request: input,
            roles: [...roles],
            language
        });
        await emit(tx, 'submission-export.requested.v1', { exportId: row.id });
        return this.jobOf(tx, row);
    }

    async get(tx: Tx, ctx: DbContext, id: string): Promise<ExportJob> {
        return this.jobOf(tx, await this.mine(tx, ctx, id));
    }

    /** A short download link for the requester; the download is on record (the file's and the export's). */
    async download(
        tx: Tx,
        ctx: DbContext,
        store: ObjectStore,
        id: string
    ): Promise<{ url: string; expiresAt: string }> {
        const row = await this.mine(tx, ctx, id);
        if (row.status !== 'done' || !row.fileId) throw new NotFoundError();
        const link = await downloadFile(tx, store, row.fileId);
        await recordEvent(tx, { type: 'submissions.export_downloaded', table: submissionExports, rowId: id });
        return link;
    }

    private async mine(tx: Tx, ctx: DbContext, id: string): Promise<ExportRow> {
        const [row] = await tx.select().from(submissionExports).where(eq(submissionExports.id, id));
        if (!row || row.createdBy !== ctx.userId) throw new NotFoundError();
        return row;
    }

    private async jobOf(tx: Tx, row: ExportRow): Promise<ExportJob> {
        const [file] = row.fileId
            ? await tx
                  .select({ status: files.status, expiresAt: files.expiresAt })
                  .from(files)
                  .where(eq(files.id, row.fileId))
            : [];
        // a file the purge removed (its time was up) is an expired export
        const expired = row.status === 'done' && (!file || file.status !== 'stored');
        return {
            id: row.id,
            formId: row.formId,
            format: (row.request as { format?: 'csv' | 'xlsx' }).format ?? 'csv',
            status: expired ? 'expired' : row.status,
            rows: row.rows,
            errorCode: row.errorCode,
            error: row.error,
            createdAt: row.createdAt.toISOString(),
            finishedAt: row.finishedAt?.toISOString() ?? null,
            keptUntil: file?.expiresAt?.toISOString() ?? null
        };
    }
}
