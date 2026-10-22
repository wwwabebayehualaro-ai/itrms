/**
 * BullMQ on the queues' Valkey (architecture.md §12; Valkey with AOF and noeviction, its own instance). The worker process
 * runs the relay loop, the sweeps and the consumer of the `outbox` queue: each job retries with exponential backoff, and
 * after the last attempt its event is marked dead for an administrator.
 */
import { Queue, Worker, type ConnectionOptions, type JobsOptions as BullJobOptions } from 'bullmq';

import type { SystemDatabase } from '../db/system';
import type { Logger } from '../observability/logger';
import {
    handleOutboxJob,
    markDead,
    relayOnce,
    sweepIdempotencyKeys,
    sweepStuck,
    type JobQueue,
    type OutboxHandler,
    type OutboxJob
} from './outbox-relay';

export const OUTBOX_QUEUE = 'outbox';

export const JOB_OPTIONS = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 }
} satisfies BullJobOptions;

/**
 * The queue as the relay sees it. A job with the event's id that is still waiting, delayed or running is left alone (the
 * relay replayed after a crash, or the sweep was early): nothing runs twice. One that already failed or completed is
 * removed first, because BullMQ ignores an add whose jobId still exists: without that, an event an administrator sends
 * back, or one the sweep found lost, would never run again.
 */
export function bullQueue(queue: Queue<OutboxJob>, options: BullJobOptions = JOB_OPTIONS): JobQueue {
    return {
        async add(name, data, jobId) {
            const existing = await queue.getJob(jobId);
            if (existing) {
                const state = await existing.getState();
                if (state !== 'failed' && state !== 'completed' && state !== 'unknown') return;
                await existing.remove();
            }
            await queue.add(name, data, { ...options, jobId });
        }
    };
}

export interface JobsOptions {
    /** the queues' Valkey (`redis://valkey-queues:6379`) */
    connection: ConnectionOptions;
    system: SystemDatabase;
    handlers: Readonly<Record<string, OutboxHandler>>;
    logger: Logger;
    relayEveryMs?: number;
    sweepEveryMs?: number;
    /** more recurring work of the installation (the files purge), each run never overlapping the previous one */
    recurring?: readonly { name: string; everyMs: number; run: () => Promise<number> }[];
    /** retries and backoff (tests make them fast) */
    jobOptions?: BullJobOptions;
}

export interface RunningJobs {
    queue: Queue<OutboxJob>;
    /** Stops the loops, waits for the runs in progress, then closes the consumer and the queue. */
    stop(): Promise<void>;
}

/** Starts the outbox consumer, the relay loop and the sweeps; `stop()` ends them (SIGTERM). */
export function startJobs(options: JobsOptions): RunningJobs {
    const { connection, system, handlers, logger } = options;
    // the producer fails fast while Valkey is away, so the relay's transaction never waits on it holding its row locks
    const queue = new Queue<OutboxJob>(OUTBOX_QUEUE, {
        connection: {
            ...connection,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1
        } as ConnectionOptions
    });
    const worker = new Worker<OutboxJob>(OUTBOX_QUEUE, (job) => handleOutboxJob(system, handlers, job.data), {
        connection,
        concurrency: 4
    });
    const inFlight = new Set<Promise<unknown>>();
    const track = <T>(p: Promise<T>) => {
        inFlight.add(p);
        void p.finally(() => inFlight.delete(p)).catch(() => undefined);
        return p;
    };
    worker.on('failed', (job, error) => {
        if (!job) return;
        logger.warn(
            { eventId: job.data.eventId, type: job.data.type, attempt: job.attemptsMade, err: error },
            'outbox job failed'
        );
        if (job.attemptsMade >= (job.opts.attempts ?? 1))
            void track(markDead(system, job.data.eventId, error.message)).catch((err: unknown) =>
                // the event stays enqueued: the sweep sends it back and it runs again
                logger.error({ err, eventId: job.data.eventId }, 'could not mark an event dead')
            );
    });

    const target = bullQueue(queue, options.jobOptions);
    // one run of a loop at a time: a slow run is never overlapped by the next
    const loop = (name: string, everyMs: number, run: () => Promise<number>) => {
        let busy = false;
        return setInterval(() => {
            if (busy) return;
            busy = true;
            void track(
                run()
                    .then((n) => n > 0 && logger.debug({ n }, name))
                    .catch((err: unknown) => logger.error({ err }, `${name} failed`))
                    .finally(() => (busy = false))
            );
        }, everyMs);
    };
    const timers = [
        loop('outbox relayed', options.relayEveryMs ?? 1_000, () => relayOnce(system, target)),
        loop('outbox swept', options.sweepEveryMs ?? 60_000, () => sweepStuck(system)),
        loop('idempotency keys swept', 3_600_000, () => sweepIdempotencyKeys(system)),
        ...(options.recurring ?? []).map((r) => loop(r.name, r.everyMs, r.run))
    ];
    return {
        queue,
        async stop() {
            timers.forEach(clearInterval);
            await worker.close();
            await Promise.allSettled([...inFlight]);
            await queue.close();
        }
    };
}
