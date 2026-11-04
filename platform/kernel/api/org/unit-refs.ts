/**
 * The id, code and name of units of the caller's region, by kernel.region_units (a record shows its handling or owner unit
 * from any unit of the region; org units' own RLS shows a person only their subtree and its ancestors).
 */
import { inArray, sql } from 'drizzle-orm';

import { contextOfTx } from '../db/audit';
import type { Tx } from '../db/types';
import { orgUnits } from './org.table';

export interface UnitRef {
    id: string;
    code: string;
    name: Record<string, string>;
}

export async function unitRefs(tx: Tx, ids: readonly (string | null | undefined)[]): Promise<Map<string, UnitRef>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    // the worker's system pool has no region to ask for, and reads the units as they are; for anyone else RLS would hold anyway
    if (contextOfTx(tx).requestId?.startsWith('system:')) {
        const units = await tx
            .select({ id: orgUnits.id, code: orgUnits.code, name: orgUnits.name })
            .from(orgUnits)
            .where(inArray(orgUnits.id, wanted));
        return new Map(units.map((u) => [u.id, { id: u.id, code: u.code, name: u.name }]));
    }
    const result = await tx.execute<{ id: string; code: string; name: Record<string, string> }>(
        sql`select id, code, name from kernel.region_units(${`{${wanted.join(',')}}`}::uuid[])`
    );
    return new Map(result.rows.map((u) => [u.id, { id: u.id, code: u.code, name: u.name }]));
}
