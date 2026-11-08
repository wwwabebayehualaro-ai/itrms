/**
 * The database of a process (ADR-0003, ADR-0011): a pg pool as one role (the API: `itrms_app`) and `scoped(ctx, fn)`, the
 * only way request code reaches it. `scoped` opens a transaction and sets the request's context as one signed,
 * transaction-local token (ADR-0048: `kernel.set_context`), which the database verifies and the RLS policies (drizzle/0006)
 * and the audit helpers read through `kernel.ctx()`; nothing outlives the transaction, so a pooled connection never
 * carries one request's context into the next, and SQL run as the application role cannot make up a wider one.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { bindContext, plain, recordEvent, type AuditEvent } from './audit';
import { carriesIdentity, signContext } from './context-token';
import type { DbContext, Tx } from './types';

export type { Db, DbContext, Tx } from './types';

export interface Database {
    /** Runs `fn` in one transaction with `ctx` set for RLS and the audit log; commits when it returns, rolls back when it throws. */
    scoped<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
    /**
     * A sensitive event (a denial, a reveal, an export) in a short transaction of its own, committed at once: it stays on
     * record even when the request that caused it fails (ADR-0031, architecture.md §15). It uses a small pool of its own,
     * so a request that already holds a connection cannot wait on itself.
     */
    recordSensitiveEvent(ctx: DbContext, event: AuditEvent): Promise<void>;
    /** `select 1`, for the readiness check. */
    ping(): Promise<void>;
    close(): Promise<void>;
}

export interface DatabaseOptions {
    max?: number;
    applicationName?: string;
    /** The installation's HMAC key for masked audit columns (AUDIT_HMAC_KEY). */
    auditKey?: string;
    /**
     * The key the request context is signed with (CONTEXT_HMAC_KEY, ADR-0048). A context that names a person, a region or a
     * unit cannot be set without it; the system pool and the owner's installer, whose contexts hold only a request id, pass none.
     */
    contextKey?: Buffer;
    /** An idle connection failed (the server restarted, an admin ended it): the pool replaces it; log it. */
    onError?: (error: Error) => void;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): Database {
    const pool = (max: number, suffix = '') => {
        const p = new Pool({
            connectionString: url,
            max,
            application_name: `${options.applicationName ?? 'itrms-api'}${suffix}`,
            // a statement that runs away is cut, so one request cannot hold a connection for ever
            statement_timeout: 30_000,
            // nor may a transaction sit idle holding its locks (a caller waiting on something else: a queue, a network)
            idle_in_transaction_session_timeout: 60_000
        });
        // without a listener an idle client's error would end the process; the readiness check reports the outage
        p.on('error', (error) => options.onError?.(error));
        return p;
    };
    const main = pool(options.max ?? 10);
    const events = pool(2, '-audit');

    const scopedOn =
        (db: NodePgDatabase) =>
        <T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> =>
            db.transaction(async (tx) => {
                // one round trip: the database verifies the signature at once, so a bad key fails here
                if (options.contextKey)
                    await tx.execute(sql`select kernel.set_context(${signContext(ctx, options.contextKey)})`);
                else if (carriesIdentity(ctx))
                    throw new Error(
                        'the database has no contextKey: a context that names a person or a unit cannot be signed'
                    );
                bindContext(tx, ctx, options.auditKey);
                const hook = ctx.transactionHook;
                if (hook) hook.transactions = (hook.transactions ?? 0) + 1;
                if (!hook || hook.used) return fn(tx);
                hook.used = true;
                await hook.begin(tx);
                const result = await fn(tx);
                await hook.end(tx, result);
                return result;
            });
    const scoped = scopedOn(drizzle(main));
    const eventsDb = drizzle(events);
    const scopedEvent = scopedOn(eventsDb);

    return {
        scoped,
        async recordSensitiveEvent(ctx, event) {
            // a transaction of its own, beside the request's business one: the idempotency hook is not about this
            const own: DbContext = { ...ctx };
            delete own.transactionHook;
            if (ctx.regionId && ctx.scopePath) return scopedEvent(own, (tx) => recordEvent(tx, event));
            // no unit yet (the audit log is class T): only access and auth events, through a function made for them; the
            // actor, the request and the address are the signed context's, not arguments
            const data = {
                ...(event.data ? (plain(event.data) as object) : {}),
                ...(event.rowId ? { rowId: event.rowId } : {})
            };
            await scopedEvent(own, (tx) =>
                tx.execute(sql`select kernel.record_context_free_event(${event.type}, ${JSON.stringify(data)}::jsonb)`)
            );
        },
        async ping() {
            await main.query('select 1');
        },
        async close() {
            await Promise.all([main.end(), events.end()]);
        }
    };
}
