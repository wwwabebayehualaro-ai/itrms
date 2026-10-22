// Worker entry of @itrms/kernel: registers its jobs/ and handlers/ (code-structure.md §5.2). Only the worker
// processes load it, so the HTTP process never reaches the system pool (dependency-cruiser:
// http-entries-never-reach-system-pool).
export { bullQueue, JOB_OPTIONS, OUTBOX_QUEUE, startJobs, type JobsOptions, type RunningJobs } from './jobs/bullmq';
export {
    handleOutboxJob,
    markDead,
    relayOnce,
    sweepIdempotencyKeys,
    sweepStuck,
    type JobQueue,
    type OutboxHandler,
    type OutboxJob
} from './jobs/outbox-relay';
export { identitySyncHandlers } from './handlers/identity-sync';
export { purgeExpiredUploads } from './jobs/files-purge';
