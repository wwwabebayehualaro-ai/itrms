/**
 * @itrms/kernel/db/system: the itrms_system pool (BYPASSRLS), for the work that must see across scopes: the outbox relay,
 * SLA sweeps, data migrations, cross-unit history (architecture.md §5). Only worker code may import this
 * (dependency-cruiser: system-pool-only-in-worker-code; code-structure.md §3), and the HTTP process never receives its
 * address (config). Every use names its reason, which is logged and written to the audit log before the work starts.
 * Recurring infrastructure work (the relay polls every second) is written once per process and reason, then only logged.
 */
import { createDatabase, type DatabaseOptions } from './database';
import { recordEvent } from './audit';
import type { Tx } from './types';

export interface SystemUse {
    /**
     * Polling and bookkeeping (the relay, the sweeps, an event's status): audited at the first use in the process, then
     * logged and counted. Work that reads or changes people's data (the identity sync) is never recurring.
     */
    recurring?: boolean;
    /** what the audit row records besides the reason (the events behind a run) */
    detail?: Record<string, unknown>;
}

export interface SystemDatabase {
    /** Runs `fn` in one transaction that sees every row of every region. */
    systemContext<T>(reason: string, fn: (tx: Tx) => Promise<T>, use?: SystemUse): Promise<T>;
    close(): Promise<void>;
}

export interface SystemDatabaseOptions extends Pick<DatabaseOptions, 'max' | 'onError'> {
    /** Called on every use, before the work: the worker logs it (recurring uses at debug level). */
    onUse: (reason: string, use: SystemUse) => void;
}

const REASON = /^[a-z][a-z0-9_.:-]{2,80}$/;

export function createSystemDatabase(url: string, options: SystemDatabaseOptions): SystemDatabase {
    const db = createDatabase(url, {
        max: options.max ?? 4,
        applicationName: 'itrms-system',
        onError: options.onError
    });
    const recorded = new Set<string>();
    return {
        async systemContext(reason, fn, use = {}) {
            // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- REASON is anchored with one bounded character class (linear time)
            if (!REASON.test(reason)) throw new Error(`systemContext: "${reason}" is not a reason key (outbox.relay)`);
            options.onUse(reason, use);
            const ctx = { requestId: `system:${reason}` };
            if (!use.recurring || !recorded.has(reason)) {
                // committed before the work, so a run that fails is on record too
                await db.scoped(ctx, (tx) =>
                    recordEvent(tx, {
                        type: 'system.context_used',
                        data: { reason, ...(use.recurring ? { recurring: true } : {}), ...use.detail }
                    })
                );
                if (use.recurring) recorded.add(reason);
            }
            return db.scoped(ctx, fn);
        },
        close: () => db.close()
    };
}
