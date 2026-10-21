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
}

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
