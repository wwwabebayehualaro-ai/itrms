// The types shared by the database and the write helpers (kept apart so neither file imports the other for them).
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Who acts, for which unit, in which request: what RLS and the audit log need to know. */
export interface DbContext {
    requestId?: string;
    userId?: string;
    regionId?: string;
    unitId?: string;
    /** The ltree path of the unit's subtree the person may see (`et.snnp.wolaita`). */
    scopePath?: string;
    /** An external participant's organisation (class P rows, ADR-0031). */
    partyId?: string;
    ip?: string;
    /**
     * Runs around the request's business transaction: the idempotency record (`@itrms/kernel/idempotency`) is claimed in
     * it before the work, and gets the work's result before the commit. Used by the first transaction only.
     */
    transactionHook?: TransactionHook;
}

export interface TransactionHook {
    begin(tx: Tx): Promise<void>;
    end(tx: Tx, result: unknown): Promise<void>;
    /** set once a transaction has used it */
    used?: boolean;
    /** how many transactions the request opened with it (one, for a POST) */
    transactions?: number;
}

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
