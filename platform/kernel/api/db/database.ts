/**
 * The database of a process (ADR-0003, ADR-0011): a pg pool as one role (the API: `itrms_app`) and `scoped(ctx, fn)`, the
 * only way request code reaches it. `scoped` opens a transaction and sets the request's context as transaction-local
 * settings (`set_config(…, true)`), which the RLS policies (drizzle/0006) and the audit helpers read; nothing outlives the
 * transaction, so a pooled connection never carries one request's context into the next.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { bindContext, plain, recordEvent, type AuditEvent } from './audit';
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
    /** An idle connection failed (the server restarted, an admin ended it): the pool replaces it; log it. */
    onError?: (error: Error) => void;
}

const SETTINGS: [keyof DbContext, string][] = [
    ['requestId', 'app.request_id'],
    ['userId', 'app.user_id'],
    ['regionId', 'app.region_id'],
    ['unitId', 'app.unit_id'],
    ['scopePath', 'app.scope_path'],
    ['partyId', 'app.party_id'],
    ['ip', 'app.ip']
];

export function createDatabase(url: string, options: DatabaseOptions = {}): Database {
    const pool = (max: number, suffix = '') => {
        const p = new Pool({
            connectionString: url,
            max,
            application_name: `${options.applicationName ?? 'itrms-api'}${suffix}`,
            // a statement that runs away is cut, so one request cannot hold a connection for ever
            statement_timeout: 30_000
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
                // one round trip; '' for anything unknown (the policies read settings null-safely: nullif(…, ''))
                await tx.execute(
                    sql`select ${sql.join(
                        SETTINGS.map(([key, name]) => sql`set_config(${name}, ${ctx[key] ?? ''}, true)`),
                        sql`, `
                    )}`
                );
                bindContext(tx, ctx, options.auditKey);
                return fn(tx);
            });
    const scoped = scopedOn(drizzle(main));
    const eventsDb = drizzle(events);
    const scopedEvent = scopedOn(eventsDb);

    return {
        scoped,
        async recordSensitiveEvent(ctx, event) {
            if (ctx.regionId && ctx.scopePath) return scopedEvent(ctx, (tx) => recordEvent(tx, event));
            // no unit yet (the audit log is class T): only access and auth events, through a function made for them
            const data = {
                ...(event.data ? (plain(event.data) as object) : {}),
                ...(event.rowId ? { rowId: event.rowId } : {})
            };
            await eventsDb.execute(
                sql`select kernel.record_context_free_event(${event.type}, ${JSON.stringify(data)}::jsonb, ${ctx.userId ?? null}::uuid, ${ctx.requestId ?? null}, ${ctx.ip ?? null})`
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
