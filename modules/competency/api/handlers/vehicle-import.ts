/**
 * The bulk import's two jobs (task 1.13b), in the worker: `vehicle-import.check-requested.v1` (the dry run) and
 * `vehicle-import.commit-requested.v1` (the commit). The batch and the rights its actor holds now are read here with the system's
 * sight; the work itself is VehicleImportService's, on the app's pool under RLS as that person. Its sender, or its committer when
 * the commit is refused, is told once when the worker is done.
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbContext, Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { roleAssignments } from '@itrms/kernel/iam';
import { notify } from '@itrms/kernel/notifications';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { orgUnits, users } from '@itrms/kernel/tables';

import { COMPETENCY_EVENTS } from '../../contracts';
import { vehicleImports } from '../competency.table';
import type { ImportDeps, LoadedImport, VehicleImportService } from '../vehicle-import.service';

export interface VehicleImportJobDeps extends ImportDeps {
    importer: Pick<VehicleImportService, 'checkBatch' | 'commitBatch'>;
}

/** The roles a person holds in a unit now: an active user, a valid assignment, an active unit. */
async function rolesNow(tx: Tx, userId: string, unitId: string): Promise<string[]> {
    const now = new Date();
    const rows = await tx
        .select({ role: roleAssignments.roleKey })
        .from(roleAssignments)
        .innerJoin(users, eq(users.id, roleAssignments.userId))
        .innerJoin(orgUnits, eq(orgUnits.id, roleAssignments.unitId))
        .where(
            and(
                eq(roleAssignments.userId, userId),
                eq(roleAssignments.unitId, unitId),
                lte(roleAssignments.validFrom, now),
                or(isNull(roleAssignments.validTo), gt(roleAssignments.validTo, now)),
                eq(users.active, true),
                eq(orgUnits.active, true)
            )
        );
    return rows.map((r) => r.role);
}

/** The batch and its actor's context, when it is in `state`: the sender's for the dry run, the committer's for the commit. */
export async function loadImport(
    system: SystemDatabase,
    importId: string,
    state: 'checking' | 'committing'
): Promise<LoadedImport | undefined> {
    return system.systemContext(
        'competency.vehicle_import',
        async (tx) => {
            const [batch] = await tx.select().from(vehicleImports).where(eq(vehicleImports.id, importId));
            if (batch?.state !== state) return undefined;
            const userId = state === 'checking' ? batch.createdBy : batch.committedBy;
            const unitId = state === 'checking' ? batch.handlingUnitId : batch.commitUnitId;
            if (!userId || !unitId) return undefined;
            const [unit] = await tx.select({ path: orgUnits.path }).from(orgUnits).where(eq(orgUnits.id, unitId));
            const asked = state === 'checking' ? batch.roles : (batch.commitRoles ?? []);
            const held = await rolesNow(tx, userId, unitId);
            const ctx: DbContext = {
                requestId: `vehicle-import:${importId}`,
                userId,
                regionId: batch.regionId,
                unitId,
                scopePath: unit?.path ?? ''
            };
            return { batch, ctx, roles: asked.filter((r) => held.includes(r)) };
        },
        { detail: { importId } }
    );
}

/** Tells a person once that the worker is done with a batch (the app's role writes no notifications). */
async function tell(
    system: SystemDatabase,
    found: LoadedImport,
    userId: string | null,
    messageKey: string
): Promise<void> {
    if (!userId) return;
    const { batch } = found;
    await system.systemContext('competency.vehicle_import_notice', async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`competency.vehicle-import:${batch.id}`}))`);
        const told = await tx.execute(
            sql`select 1 from kernel.notifications
                 where link ->> 'importId' = ${batch.id} and message_key = ${messageKey} and user_id = ${userId} limit 1`
        );
        if (told.rows.length === 0)
            await notify(tx, [
                {
                    userId,
                    regionId: batch.regionId,
                    unitId: batch.handlingUnitId,
                    messageKey,
                    params: { file: batch.filename },
                    link: { importId: batch.id }
                }
            ]);
    });
}

/** The dry run of a batch: done once; a retried delivery carries on, a later one finds it checked. */
export async function checkImport(system: SystemDatabase, deps: VehicleImportJobDeps, importId: string): Promise<void> {
    const found = await loadImport(system, importId, 'checking');
    if (!found) return;
    const outcome = await deps.importer.checkBatch(deps, found);
    if (outcome !== 'none')
        await tell(
            system,
            found,
            found.batch.createdBy,
            outcome === 'checked' ? 'competency.notify.import-checked' : 'competency.notify.import-failed'
        );
}

/** The commit of a batch: its valid rows on the register, as its committer. */
export async function commitImport(
    system: SystemDatabase,
    deps: VehicleImportJobDeps,
    importId: string
): Promise<void> {
    const found = await loadImport(system, importId, 'committing');
    if (!found) return;
    const outcome = await deps.importer.commitBatch(deps, found);
    if (outcome === 'committed') await tell(system, found, found.batch.createdBy, 'competency.notify.import-committed');
    else await tell(system, found, found.batch.committedBy, 'competency.notify.import-not-committed');
}

export function vehicleImportHandlers(
    system: SystemDatabase,
    deps: VehicleImportJobDeps
): Record<string, OutboxHandler> {
    return {
        'vehicle-import.check-requested.v1': async (job) => {
            await checkImport(
                system,
                deps,
                COMPETENCY_EVENTS['vehicle-import.check-requested.v1'].parse(job.payload).importId
            );
        },
        'vehicle-import.commit-requested.v1': async (job) => {
            await commitImport(
                system,
                deps,
                COMPETENCY_EVENTS['vehicle-import.commit-requested.v1'].parse(job.payload).importId
            );
        }
    };
}
