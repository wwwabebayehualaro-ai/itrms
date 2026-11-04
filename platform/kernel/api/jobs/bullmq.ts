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
    /** events relayed to a queue of their own, consumed by another process (the PDF worker's), by event type */
    routes?: Readonly<Record<string, string>>;
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

    const queues = new Map<string, Queue<OutboxJob>>();
    const producerConnection = {
        ...connection,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1
    } as ConnectionOptions;
    const main = bullQueue(queue, options.jobOptions);
    const target: JobQueue = {
        add(name, data, jobId) {
            const routed = options.routes?.[name];
            if (!routed) return main.add(name, data, jobId);
            let other = queues.get(routed);
            if (!other) {
                other = new Queue<OutboxJob>(routed, { connection: producerConnection });
                queues.set(routed, other);
            }
            return bullQueue(other, options.jobOptions).add(name, data, jobId);
        }
    };
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
            await Promise.all([...queues.values()].map((q) => q.close()));
        }
    };
}

/**
 * A consumer of one routed queue, and nothing else: no relay, no sweeps. The relay of the main worker feeds it, so a process
 * with heavy work (the PDF worker) can be limited and restarted without touching the outbox, SLA timers or notifications.
 */
export function startQueueConsumer(options: {
    queue: string;
    connection: ConnectionOptions;
    system: SystemDatabase;
    handlers: Readonly<Record<string, OutboxHandler>>;
    logger: Logger;
    concurrency?: number;
}): { stop(): Promise<void> } {
    const { queue, connection, system, handlers, logger } = options;
    const inFlight = new Set<Promise<unknown>>();
    const worker = new Worker<OutboxJob>(queue, (job) => handleOutboxJob(system, handlers, job.data), {
        connection,
        concurrency: options.concurrency ?? 2
    });
    worker.on('failed', (job, error) => {
        if (!job) return;
        logger.warn(
            { eventId: job.data.eventId, type: job.data.type, attempt: job.attemptsMade, err: error },
            'queue job failed'
        );
        if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
        const dead = markDead(system, job.data.eventId, error.message).catch((err: unknown) =>
            logger.error({ err, eventId: job.data.eventId }, 'could not mark an event dead')
        );
        inFlight.add(dead);
        void dead.finally(() => inFlight.delete(dead));
    });
    return {
        async stop() {
            await worker.close();
            await Promise.allSettled([...inFlight]);
        }
    };
}
