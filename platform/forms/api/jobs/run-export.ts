/**
 * The worker's half of a background export (task 0.16e): on `submission-export.requested.v1`, the export is made with
 * the requester's scope and roles as they were when they asked: the app's pool (RLS on) with their context, never the
 * system pool's sight of every row. The rows are read in one transaction, rendered outside it, and stored as a generated
 * file kept for EXPORT_KEEP_DAYS. A refusal the person can act on (too many rows, a field gone) fails the export with
 * its reason; anything else is left for the relay to try again.
 */
import { eq } from 'drizzle-orm';
import { recordEvent, updateAudited, type Database, type DbContext } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { AppError } from '@itrms/kernel/errors';
import { storeGeneratedFile, type ObjectStore } from '@itrms/kernel/files';

import { EXPORT_KEEP_DAYS, MAX_BACKGROUND_EXPORT_ROWS, submissionExportSchema } from '../../contracts';
import { render } from '../export';
import { FormsService } from '../forms.service';
import { submissionExports } from '../forms.table';
import { SubmissionQueryService } from '../query.service';
import { SubmissionsService } from '../submissions.service';

/** A background export's time in the database, all its statements together. */
export const BACKGROUND_BUDGET_MS = 120_000;

export interface ExportDeps {
    /** the app's pool: the export runs under RLS, as its requester */
    database: Database;
    store: ObjectStore;
}

export async function runExport(system: SystemDatabase, deps: ExportDeps, exportId: string): Promise<void> {
    const [job] = await system.systemContext(
        'forms.run_export',
        (tx) => tx.select().from(submissionExports).where(eq(submissionExports.id, exportId)),
        { detail: { exportId } }
    );
    // done or failed already (a delivery again): nothing to do
    if (!job || job.status === 'done' || job.status === 'failed' || !job.createdBy) return;
    const ctx: DbContext = {
        requestId: `export:${exportId}`,
        userId: job.createdBy,
        unitId: job.unitId,
        regionId: job.regionId,
        scopePath: job.orgPath
    };
    const queries = new SubmissionQueryService(new FormsService(), new SubmissionsService());
    const input = submissionExportSchema.parse(job.request);

    let version = job.rowVersion;
    if (job.status === 'queued')
        version = (
            await deps.database.scoped(ctx, (tx) =>
                updateAudited(tx, submissionExports, exportId, job.rowVersion, { status: 'running' })
            )
        ).rowVersion;

    let table;
    try {
        table = await deps.database.scoped(ctx, (tx) =>
            queries.exportTable(tx, job.roles, input, job.language, {
                maxRows: MAX_BACKGROUND_EXPORT_ROWS,
                budgetMs: BACKGROUND_BUDGET_MS
            })
        );
    } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        await deps.database.scoped(ctx, (tx) =>
            updateAudited(tx, submissionExports, exportId, version, {
                status: 'failed',
                error: (error.detail ?? error.code).slice(0, 500),
                finishedAt: new Date()
            })
        );
        return;
    }
    const file = await render(table);
    await deps.database.scoped(ctx, async (tx) => {
        const stored = await storeGeneratedFile(tx, deps.store, ctx, {
            filename: table.filename,
            contentType:
                table.format === 'xlsx'
                    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    : 'text/csv',
            body: file.body,
            documentType: 'submission_export',
            keepUntil: new Date(Date.now() + EXPORT_KEEP_DAYS * 86_400_000)
        });
        await updateAudited(tx, submissionExports, exportId, version, {
            status: 'done',
            rows: table.rows.length,
            fileId: stored.id,
            finishedAt: new Date()
        });
        // the export itself, as a direct one is recorded: its size and the columns that left the system
        await recordEvent(tx, {
            type: 'submissions.exported',
            table: submissionExports,
            rowId: exportId,
            data: {
                background: true,
                format: table.format,
                rows: table.rows.length,
                fieldKeys: table.keys,
                formId: job.formId
            }
        });
    });
}
