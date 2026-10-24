/**
 * The id, code and name of units of the caller's region, by kernel.region_units (a record shows its handling or owner unit
 * from any unit of the region; org units' own RLS shows a person only their subtree and its ancestors).
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '../db/types';

export interface UnitRef {
    id: string;
    code: string;
    name: Record<string, string>;
}

export async function unitRefs(tx: Tx, ids: readonly (string | null | undefined)[]): Promise<Map<string, UnitRef>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const result = await tx.execute<{ id: string; code: string; name: Record<string, string> }>(
        sql`select id, code, name from kernel.region_units(${`{${wanted.join(',')}}`}::uuid[])`
    );
    return new Map(result.rows.map((u) => [u.id, { id: u.id, code: u.code, name: u.name }]));
}
