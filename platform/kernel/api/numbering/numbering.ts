/**
 * Numbers ITRMS issues (architecture.md §15): `nextNumber(tx, key, unitId)` takes the next value of the unit's counter in
 * the business transaction. The UPDATE locks the counter's row until the transaction ends, so concurrent issuers queue up
 * and get consecutive numbers; a transaction that rolls back gives its number back, so there are no gaps.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '../db/types';
import { ConflictError } from '../errors';
import { numberCounters } from './numbering.table';

export interface CounterSetup {
    key: string;
    unitId: string;
    regionId: string;
    /** `{unit}/{seq:06}/{efy}` */
    pattern: string;
    /** a migrated register's highest number: the counter continues after it */
    startAfter?: bigint;
}

/**
 * Creates a unit's counter, or raises its start to `startAfter` (a migration found higher numbers). Never lowers it: a
 * number once issued is never issued again. Installation work (the owner role), not request code.
 */
export async function setUpCounter(tx: Tx, setup: CounterSetup): Promise<void> {
    const start = setup.startAfter ?? 0n;
    await tx
        .insert(numberCounters)
        .values({
            key: setup.key,
            unitId: setup.unitId,
            regionId: setup.regionId,
            pattern: setup.pattern,
            lastValue: start
        })
        .onConflictDoUpdate({
            target: [numberCounters.unitId, numberCounters.key],
            set: {
                pattern: setup.pattern,
                lastValue: sql`greatest(${numberCounters.lastValue}, ${start})`,
                updatedAt: sql`now()`
            }
        });
}

/**
 * The Ethiopian fiscal year of a date (Hamle 1 to Sene 30), named by the Ethiopian year it ends in: 8 July 2026 to 7 July
 * 2027 is EFY 2019. A stand-in until the calendar package (task 0.12) gives the exact Hamle 1 of each year.
 */
export function fiscalYear(date: Date): number {
    const [year, month, day] = date
        .toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' })
        .split('-')
        .map(Number) as [number, number, number];
    return month > 7 || (month === 7 && day >= 8) ? year - 7 : year - 8;
}

/** `{unit}`, `{seq}` or `{seq:06}` (zero-padded), `{efy}`. */
export function formatNumber(pattern: string, values: { unit: string; seq: bigint; efy: number }): string {
    return pattern.replace(/\{(unit|efy|seq)(?::0(\d))?\}/g, (_, name: string, width?: string) => {
        if (name === 'unit') return values.unit;
        if (name === 'efy') return String(values.efy);
        return values.seq.toString().padStart(width ? Number(width) : 0, '0');
    });
}

interface Issued extends Record<string, unknown> {
    last_value: string;
    pattern: string;
    code: string;
    /** the database's time of the issue (ms since 1970): its fiscal year goes into the number */
    issued_at: string;
}

/**
 * The next number of the unit's counter, in the caller's transaction; 409 `not_configured` when the unit has no such
 * counter. The fiscal year is the database's, not this process's (the hosts' clocks differ). The counter does not
 * restart each fiscal year yet: that comes with the calendar package (task 0.12).
 */
export async function nextNumber(tx: Tx, key: string, unitId: string): Promise<{ value: bigint; number: string }> {
    const result = await tx.execute<Issued>(sql`
        UPDATE kernel.number_counters c
           SET last_value = c.last_value + 1, updated_at = now()
          FROM kernel.org_units u
         WHERE c.unit_id = ${unitId} AND c.key = ${key} AND u.id = c.unit_id
     RETURNING c.last_value::text AS last_value, c.pattern, u.code, (extract(epoch from now()) * 1000)::bigint::text AS issued_at`);
    const row = result.rows[0];
    if (!row)
        throw new ConflictError('not_configured', {
            detail: 'This office has no number series for this document yet. Ask the administrator to set it up.'
        });
    const value = BigInt(row.last_value);
    const efy = fiscalYear(new Date(Number(row.issued_at)));
    return { value, number: formatNumber(row.pattern, { unit: row.code, seq: value, efy }) };
}
