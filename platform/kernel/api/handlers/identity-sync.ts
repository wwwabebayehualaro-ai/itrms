/**
 * The identity provider follows the org tree and the role assignments (ADR-0004, task 0.10a's IdentityAdmin): a unit or an
 * assignment changed, so the worker mirrors the tree and the memberships again. The sync is whole and idempotent, so it is
 * coalesced: one runs at a time, and the events that arrive meanwhile share the next run (a tree import of N units is not
 * N syncs). Each run reads in a short system transaction, audited with the events that caused it, and calls the identity
 * provider with no transaction open.
 */
import { applyIdentity, identitySnapshot, type IdentityAdmin } from '../iam/identity-admin';
import type { SystemDatabase } from '../db/system';
import type { OutboxHandler } from '../jobs/outbox-relay';

export function identitySyncHandlers(system: SystemDatabase, admin: IdentityAdmin): Record<string, OutboxHandler> {
    let tail: Promise<unknown> = Promise.resolve();
    let waiting: { events: string[]; run: Promise<void> } | undefined;

    const runOnce = async (events: string[]) => {
        const snapshot = await system.systemContext('identity.sync', (tx) => identitySnapshot(tx), {
            detail: { events }
        });
        await applyIdentity(admin, snapshot);
    };

    const sync: OutboxHandler = (job) => {
        if (waiting) {
            waiting.events.push(job.eventId);
            return waiting.run;
        }
        const batch: { events: string[]; run: Promise<void> } = { events: [job.eventId], run: Promise.resolve() };
        batch.run = tail
            .catch(() => undefined)
            .then(() => {
                // from here on, new events wait for the next run
                waiting = undefined;
                return runOnce(batch.events);
            });
        waiting = batch;
        tail = batch.run;
        return batch.run;
    };
    return { 'org-unit.changed.v1': sync, 'role-assignment.changed.v1': sync };
}
