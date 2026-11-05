/**
 * The national driver platform, reached only from the worker (task 0.24a): a licence's request goes out, and its answer comes back as
 * an event on the case, from a system actor. Delivered twice, the platform answers the same and the case is already past that step. An
 * answer still pending moves nothing: the case's wait times out as its workflow says. An error is thrown, so the outbox retries.
 */
import { eq } from 'drizzle-orm';
import { actFor, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { orgUnits } from '@itrms/kernel/tables';
import type { NationalDriverPlatform } from '@itrms/integrations/contracts';

import { COMPETENCY_EVENTS, NATIONAL_ACCEPTED, NATIONAL_ACTOR, NATIONAL_REJECTED } from '../../contracts';
import { driverLicences, licencePrintBatches, licencePrintBatchItems } from '../competency.table';
import type { LicencesService } from '../licences.service';

export interface NationalDeps {
    platform: NationalDriverPlatform;
    licences: Pick<LicencesService, 'nationalRequest'>;
    /** how an event reaches a case (the workflow's `deliver`) */
    cases: {
        deliver(
            tx: Tx,
            id: string,
            on: string,
            actor: { kind: 'system'; id: string },
            language?: string,
            options?: { quiet?: boolean; input?: Record<string, unknown> }
        ): Promise<unknown>;
    };
}

/** Asks the platform about one licence and, when it has decided, tells the case. */
export async function askNationalPlatform(
    system: SystemDatabase,
    deps: NationalDeps,
    event: { caseId: string; licenceId: string; kind: 'new' | 'renewal'; attempt?: number }
): Promise<'accepted' | 'rejected' | 'pending'> {
    const request = await system.systemContext('competency.national', (tx) =>
        deps.licences.nationalRequest(tx, event.licenceId)
    );
    // stable, so a retry or a new approval after a timeout is the same request; a new decision after a refusal has its own
    const answer = await deps.platform.requestLicence({
        requestId: `${event.caseId}:${event.licenceId}:${event.attempt ?? 0}`,
        kind: event.kind,
        ...request
    });
    if (answer.status === 'pending') return 'pending';
    await system.systemContext('competency.national', (tx) =>
        deps.cases.deliver(
            tx,
            event.caseId,
            answer.status === 'accepted' ? NATIONAL_ACCEPTED : NATIONAL_REJECTED,
            { kind: 'system', id: NATIONAL_ACTOR },
            'am',
            {
                // the step may have moved on (a retry, or its wait timed out): the platform's answer stays good for the next try
                quiet: true,
                input: {
                    reference: answer.reference,
                    licenceNumber: answer.licenceNumber ?? null,
                    ...(answer.reason ? { reason: answer.reason } : {})
                }
            }
        )
    );
    return answer.status;
}

/** Sends a batch to the printer once, and records the platform's reference. */
export async function sendPrintBatch(
    system: SystemDatabase,
    deps: Pick<NationalDeps, 'platform'>,
    batchId: string
): Promise<boolean> {
    const batch = await system.systemContext('competency.print', async (tx) => {
        const [row] = await tx.select().from(licencePrintBatches).where(eq(licencePrintBatches.id, batchId));
        if (row?.status !== 'requested') return null;
        const licences = await tx
            .select({
                licenceId: driverLicences.id,
                number: driverLicences.number,
                reference: driverLicences.nationalReference
            })
            .from(licencePrintBatchItems)
            .innerJoin(driverLicences, eq(driverLicences.id, licencePrintBatchItems.licenceId))
            .where(eq(licencePrintBatchItems.batchId, batchId));
        return { row, licences };
    });
    if (!batch) return false;
    const { reference } = await deps.platform.requestPrint({ batchId, licences: batch.licences });
    await system.systemContext('competency.print', async (tx) => {
        const [unit] = await tx
            .select({ path: orgUnits.path })
            .from(orgUnits)
            .where(eq(orgUnits.id, batch.row.handlingUnitId));
        actFor(tx, { regionId: batch.row.regionId, unitId: batch.row.handlingUnitId, scopePath: unit?.path ?? '' });
        const [current] = await tx.select().from(licencePrintBatches).where(eq(licencePrintBatches.id, batchId));
        if (current?.status === 'requested')
            await updateAudited(tx, licencePrintBatches, batchId, current.rowVersion, {
                status: 'sent',
                nationalReference: reference
            });
    });
    return true;
}

export function competencyHandlers(system: SystemDatabase, deps: NationalDeps): Record<string, OutboxHandler> {
    return {
        'licence.national-requested.v1': async (job) => {
            await askNationalPlatform(
                system,
                deps,
                COMPETENCY_EVENTS['licence.national-requested.v1'].parse(job.payload)
            );
        },
        'licence-batch.print-requested.v1': async (job) => {
            await sendPrintBatch(
                system,
                deps,
                COMPETENCY_EVENTS['licence-batch.print-requested.v1'].parse(job.payload).batchId
            );
        }
    };
}
