/**
 * The worker's half of a background export (task 0.16e): on `submission-export.requested.v1`, the export is made with
 * the requester's rights as they are when it runs: the roles they asked with that they still hold in the unit (an active
 * user, a valid assignment, an active unit), which must still give `submission:export`. It runs on the app's pool under
 * RLS with their context, never with the system pool's sight of every row.
 *
 * The rows are read in one transaction and rendered outside it; the file is put in the store outside any transaction,
 * then recorded with the job's completion in one (the job row locked: a second delivery at the same time records
 * nothing); any failure after the put removes the object, so none is left that no row serves. Every failure ends the
 * job (`failed`, a reason code and its detail), so none stays `running`; a failure that is not the person's to fix is
 * thrown on as well, for the logs and the relay's retry (which then finds the job ended).
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { recordEvent, updateAudited, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { AppError } from '@itrms/kernel/errors';
import {
    MAX_GENERATED_BYTES,
    putGeneratedObject,
    recordGeneratedFile,
    removeGeneratedObject,
    type GeneratedObject,
    type ObjectStore
} from '@itrms/kernel/files';
import { notify } from '@itrms/kernel/notifications';
import { orgUnits, users } from '@itrms/kernel/tables';
import { roleAssignments } from '@itrms/kernel/iam';
import type { SettingsService } from '@itrms/kernel/settings';

import {
    EXPORT_KEEP_DAYS,
    MAX_BACKGROUND_EXPORT_ROWS,
    submissionExportSchema,
    type ExportFailure
} from '../../contracts';
import { ExportRefused, render } from '../export';
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
    /** what roles give (the installation's role catalogue) */
    permissionsOf: (roles: readonly string[]) => ReadonlySet<string>;
    /** the largest file an export may make (tests make it small) */
    maxBytes?: number;
    /** the region's limits (task 0.21a); without, the defaults */
    settings?: Pick<SettingsService, 'value'>;
}

type Job = typeof submissionExports.$inferSelect;

/** The roles the requester still holds in the unit now: an active user, a valid assignment, an active unit. */
async function rolesNow(tx: Tx, job: Job): Promise<string[]> {
    const rows = await tx
        .select({ role: roleAssignments.roleKey })
        .from(roleAssignments)
        .innerJoin(users, eq(users.id, roleAssignments.userId))
        .innerJoin(orgUnits, eq(orgUnits.id, roleAssignments.unitId))
        .where(
            and(
                eq(roleAssignments.userId, job.createdBy ?? ''),
                eq(roleAssignments.unitId, job.unitId),
                lte(roleAssignments.validFrom, new Date()),
                or(isNull(roleAssignments.validTo), gt(roleAssignments.validTo, new Date())),
                eq(users.active, true),
                eq(orgUnits.active, true)
            )
        );
    return rows.map((r) => r.role);
}

export async function runExport(system: SystemDatabase, deps: ExportDeps, exportId: string): Promise<void> {
    const found = await system.systemContext(
        'forms.run_export',
        async (tx) => {
            const [job] = await tx.select().from(submissionExports).where(eq(submissionExports.id, exportId));
            return job && { job, held: await rolesNow(tx, job) };
        },
        { detail: { exportId } }
    );
    if (!found?.job.createdBy) return;
    const { job } = found;
    // the requester is told once when it ends (task 0.20b), from the system context (the app's role writes no
    // notifications); deliveries of one export wait for each other, and the second finds it told
    const tell = (messageKey: string, params: Record<string, string> = {}) =>
        system.systemContext('forms.export_notice', async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`forms.export:${exportId}`}))`);
            const told = await tx.execute(
                sql`select 1 from kernel.notifications where link ->> 'exportId' = ${exportId} limit 1`
            );
            if (told.rows.length === 0)
                await notify(tx, [
                    {
                        userId: job.createdBy ?? '',
                        regionId: job.regionId,
                        unitId: job.unitId,
                        messageKey,
                        params,
                        link: { formId: job.formId, exportId }
                    }
                ]);
        });
    // done or failed already (a delivery again): nothing to do but the notice, if a failure after that commit lost it
    if (job.status === 'done') return tell('forms.notify.export-ready', { rows: String(job.rows ?? 0) });
    if (job.status === 'failed') return tell('forms.notify.export-failed');
    const ctx: DbContext = {
        requestId: `export:${exportId}`,
        userId: job.createdBy ?? undefined,
        unitId: job.unitId,
        regionId: job.regionId,
        scopePath: job.orgPath
    };
    // what they asked with and still hold: a role revoked since narrows what the file holds
    const roles = job.roles.filter((r) => found.held.includes(r));

    /** Ends the job, on the version it has now (it may have moved since it was read). */
    const end = (changes: Partial<typeof submissionExports.$inferInsert>) =>
        deps.database.scoped(ctx, async (tx) => {
            const [current] = await tx
                .select()
                .from(submissionExports)
                .where(eq(submissionExports.id, exportId))
                .for('update');
            if (!current || current.status === 'done' || current.status === 'failed') return false;
            await updateAudited(tx, submissionExports, exportId, current.rowVersion, changes);
            return true;
        });
    const fail = async (code: ExportFailure, detail: string) => {
        if (await end({ status: 'failed', errorCode: code, error: detail.slice(0, 500), finishedAt: new Date() }))
            await tell('forms.notify.export-failed');
    };

    if (!deps.permissionsOf(roles).has('submission:export')) {
        await fail('not_permitted', 'You no longer hold the right to export in this office.');
        return;
    }
    if (job.status === 'queued') await end({ status: 'running' });

    let object: GeneratedObject | undefined;
    let recorded = false;
    try {
        const input = submissionExportSchema.parse(job.request);
        const { table, keepDays } = await deps.database.scoped(ctx, async (tx) => {
            // the limits of the office's region as they are when it runs
            const [maxRows, keepDays] = deps.settings
                ? await Promise.all([
                      deps.settings.value<number>(tx, job.unitId, 'forms.exports.backgroundMaxRows'),
                      deps.settings.value<number>(tx, job.unitId, 'forms.exports.keepDays')
                  ])
                : [MAX_BACKGROUND_EXPORT_ROWS, EXPORT_KEEP_DAYS];
            const table = await new SubmissionQueryService(new FormsService(), new SubmissionsService()).exportTable(
                tx,
                roles,
                input,
                job.language,
                { maxRows, budgetMs: BACKGROUND_BUDGET_MS }
            );
            return { table, keepDays };
        });
        const file = await render(table, deps.maxBytes ?? MAX_GENERATED_BYTES);
        object = await putGeneratedObject(deps.store, job.regionId, {
            contentType:
                table.format === 'xlsx'
                    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    : 'text/csv',
            body: file.body
        });
        const made = object;
        recorded = await deps.database.scoped(ctx, async (tx) => {
            const [current] = await tx
                .select()
                .from(submissionExports)
                .where(eq(submissionExports.id, exportId))
                .for('update');
            // another delivery finished it meanwhile
            if (!current || current.status !== 'running') return false;
            const stored = await recordGeneratedFile(tx, ctx, made, {
                filename: table.filename,
                documentType: 'submission_export',
                keepUntil: new Date(Date.now() + keepDays * 86_400_000)
            });
            await updateAudited(tx, submissionExports, exportId, current.rowVersion, {
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
            return true;
        });
        if (recorded) await tell('forms.notify.export-ready', { rows: String(table.rows.length) });
    } catch (error) {
        const refused =
            error instanceof ExportRefused
                ? error.reason
                : error instanceof AppError && error.status < 500
                  ? 'invalid_query'
                  : undefined;
        await fail(
            refused ?? 'failed',
            refused && error instanceof AppError
                ? (error.detail ?? error.code)
                : 'The export could not be made: ask for it again.'
        ).catch(() => undefined);
        if (!refused) throw error;
    } finally {
        if (object && !recorded) await removeGeneratedObject(deps.store, object);
    }
}
