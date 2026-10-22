/**
 * Shared by the register's services. The units a register shows (handling unit, address): any unit of the caller's region, by kernel.region_units (org
 * units' own RLS shows a person only their subtree and its ancestors).
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { ForbiddenError } from '@itrms/kernel/errors';

export { withinScope } from '@itrms/kernel/org';

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

/** The unit the caller acts for (a request without one cannot write to a register). */
export function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detail: 'Choose the office you act for.' });
    return value;
}

/** A unique constraint refused the write (the database is the last word on duplicates written at the same moment). */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
}
