/**
 * @itrms/kernel/outbox: events written in the business transaction (architecture.md §12); the worker relays them
 * (`@itrms/kernel/api/worker`).
 */
export { emit, type Emitted } from './outbox';
export { OUTBOX_STATUSES, outboxEvents, type OutboxStatus } from './outbox.table';
