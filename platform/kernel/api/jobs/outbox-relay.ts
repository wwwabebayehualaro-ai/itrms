/**
 * The outbox relay and its sweeps (architecture.md §12), on the system pool (worker only):
 *   - relay: pending events → the queue, with jobId = event id, then `enqueued`. A relay that dies after the queue took a
 *     job but before its commit leaves the event pending; the next run adds the same jobId, which the queue ignores while
 *     the job exists, so nothing runs twice;
 *   - handle: the event's handler runs, then the event is `done`; an event already done is skipped (handlers run at least
 *     once, never twice to completion);
 *   - sweep: events `enqueued` for longer than a few minutes go back to `pending` (a flushed or lost queue loses nothing);
 *   - dead: after the last retry the event is `dead`, with its error, for an administrator to send back.
 */
import { sql } from 'drizzle-orm';

import type { SystemDatabase } from '../db/system';

/** Where the relay puts jobs: BullMQ in the worker, a map in tests. Adding a jobId that exists does nothing. */
export interface JobQueue {
    add(name: string, data: OutboxJob, jobId: string): Promise<void>;
}

export interface OutboxJob {
    eventId: string;
    type: string;
    payload: unknown;
}

/** What handles one event type; it must be idempotent (it may run again after a crash). */
export type OutboxHandler = (event: OutboxJob) => Promise<void>;

interface PendingRow extends Record<string, unknown> {
    id: string;
    type: string;
    payload: unknown;
}

const recurring = { recurring: true };

/** Moves up to `batch` pending events to the queue; returns how many. */
export async function relayOnce(system: SystemDatabase, queue: JobQueue, batch = 100): Promise<number> {
    return system.systemContext(
        'outbox.relay',
        async (tx) => {
            const due = await tx.execute<PendingRow>(sql`
                SELECT id, type, payload FROM kernel.outbox_events
                 WHERE status = 'pending' AND available_at <= now()
                 ORDER BY created_at, id
                 LIMIT ${batch}
                 FOR UPDATE SKIP LOCKED`);
            for (const e of due.rows)
                await queue.add(e.type, { eventId: e.id, type: e.type, payload: e.payload }, e.id);
            if (due.rows.length)
                await tx.execute(sql`
                    UPDATE kernel.outbox_events
                       SET status = 'enqueued', enqueued_at = now(), attempts = attempts + 1
                     WHERE id IN (${sql.join(
                         due.rows.map((e) => sql`${e.id}::uuid`),
                         sql`, `
                     )})`);
            return due.rows.length;
        },
        recurring
    );
}

/** Sends events enqueued more than `stuckAfterSeconds` ago back to pending; returns how many. */
export async function sweepStuck(system: SystemDatabase, stuckAfterSeconds = 300): Promise<number> {
    return system.systemContext(
        'outbox.sweep',
        async (tx) => {
            const swept = await tx.execute(sql`
                UPDATE kernel.outbox_events SET status = 'pending', available_at = now()
                 WHERE status = 'enqueued' AND enqueued_at < now() - make_interval(secs => ${stuckAfterSeconds})`);
            return swept.rowCount ?? 0;
        },
        recurring
    );
}

/** Runs an event's handler unless the event is done already, then marks it done. */
export async function handleOutboxJob(
    system: SystemDatabase,
    handlers: Readonly<Record<string, OutboxHandler>>,
    job: OutboxJob
): Promise<'done' | 'skipped'> {
    const status = await system.systemContext(
        'outbox.handle',
        async (tx) =>
            (
                await tx.execute<{ status: string }>(
                    sql`SELECT status FROM kernel.outbox_events WHERE id = ${job.eventId}::uuid`
                )
            ).rows[0]?.status,
        recurring
    );
    if (status === undefined || status === 'done') return 'skipped';
    // an event nobody consumes in this installation (its consumer switched off) is simply done
    await handlers[job.type]?.(job);
    await system.systemContext(
        'outbox.handle',
        (tx) =>
            tx.execute(
                sql`UPDATE kernel.outbox_events SET status = 'done', done_at = now(), last_error = NULL
                     WHERE id = ${job.eventId}::uuid`
            ),
        recurring
    );
    return 'done';
}

/** After the last retry: the event is dead, with its error, until an administrator sends it back. */
export async function markDead(system: SystemDatabase, eventId: string, error: string): Promise<void> {
    await system.systemContext(
        'outbox.dead',
        (tx) =>
            tx.execute(
                sql`UPDATE kernel.outbox_events SET status = 'dead', last_error = ${error.slice(0, 2000)}
                     WHERE id = ${eventId}::uuid AND status <> 'done'`
            ),
        recurring
    );
}

/** Idempotency records past their 7 days. */
export async function sweepIdempotencyKeys(system: SystemDatabase): Promise<number> {
    return system.systemContext(
        'idempotency.sweep',
        async (tx) =>
            (await tx.execute(sql`DELETE FROM kernel.idempotency_keys WHERE expires_at <= now()`)).rowCount ?? 0,
        recurring
    );
}
