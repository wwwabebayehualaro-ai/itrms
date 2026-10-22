/**
 * Numbers ITRMS issues (architecture.md §15): `nextNumber(tx, key, unitId)` takes the next value of the unit's counter in
 * the business transaction. The UPDATE locks the counter's row until the transaction ends, so concurrent issuers queue up
 * and get consecutive numbers; a transaction that rolls back gives its number back, so there are no gaps. A pattern with
 * `{efy}` numbers each fiscal year from 1: a number is unique by (unit, key, fiscal year, value).
 */
import { sql } from 'drizzle-orm';

import { efy } from '@itrms/ethiopian-calendar';

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
    /**
     * The fiscal year `startAfter` belongs to, for a pattern with `{efy}`: in a later year the counter starts again at 1
     * instead of continuing (required with `startAfter` on such a pattern).
     */
    startYear?: number;
}

const hasYear = (pattern: string) => pattern.includes('{efy}');

/**
 * Creates a unit's counter, or raises its start to `startAfter` (a migration found higher numbers). Never lowers it: a
 * number once issued is never issued again, so a counter in use cannot drop the fiscal year from its pattern either.
 * Installation work (the owner role), not request code.
 */
export async function setUpCounter(tx: Tx, setup: CounterSetup): Promise<void> {
    const start = setup.startAfter ?? 0n;
    if (hasYear(setup.pattern) && start > 0n && setup.startYear === undefined)
        throw new Error(`counter ${setup.key}: name the fiscal year (startYear) its first ${start} numbers belong to`);
    const period = hasYear(setup.pattern) && setup.startYear !== undefined ? String(setup.startYear) : '';
    const [current] = await tx
        .select({ pattern: numberCounters.pattern, period: numberCounters.period })
        .from(numberCounters)
        .where(sql`${numberCounters.unitId} = ${setup.unitId} and ${numberCounters.key} = ${setup.key}`);
    if (current && current.period !== '' && hasYear(current.pattern) && !hasYear(setup.pattern))
        throw new ConflictError('invalid_transition', {
            detail: `Counter ${setup.key} numbers each fiscal year: its pattern keeps {efy}, or numbers would repeat.`
        });
    await tx
        .insert(numberCounters)
        .values({
            key: setup.key,
            unitId: setup.unitId,
            regionId: setup.regionId,
            pattern: setup.pattern,
            lastValue: start,
            period
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
}

export interface IssuedNumber {
    value: bigint;
    /** the fiscal year the number belongs to, when the counter numbers by year (`{efy}`) */
    fiscalYear?: number;
    number: string;
}

/** A counter moved back in time: another transaction that started later already opened the next fiscal year. */
const periodWentBack = (error: unknown) => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, message } = e as { code?: string; message?: string };
        if (code === '23514' && message?.includes('period never goes back')) return true;
    }
    return false;
};

/**
 * The next number of the unit's counter, in the caller's transaction; 409 `not_configured` when the unit has no such
 * counter. The fiscal year is the transaction's time in Addis Ababa by the database's clock (the hosts' clocks differ):
 * a counter whose pattern has `{efy}` starts again at 1 when the fiscal year changes (Hamle 1). A transaction that began
 * just before Hamle 1 and meets a counter already in the new year gets a 409 to retry.
 */
export async function nextNumber(tx: Tx, key: string, unitId: string): Promise<IssuedNumber> {
    // now() is the transaction's start: the same instant for the year chosen here and the number taken below
    const clock = await tx.execute<{ ms: string }>(sql`select (extract(epoch from now()) * 1000)::bigint::text as ms`);
    const year = efy(new Date(Number(clock.rows[0]?.ms)));
    let result;
    try {
        result = await tx.execute<Issued>(sql`
            UPDATE kernel.number_counters c
               SET last_value = CASE
                       WHEN c.pattern NOT LIKE '%{efy}%' OR c.period IN ('', ${String(year)}) THEN c.last_value + 1
                       ELSE 1
                   END,
                   period = CASE WHEN c.pattern LIKE '%{efy}%' THEN ${String(year)} ELSE c.period END,
                   updated_at = now()
              FROM kernel.org_units u
             WHERE c.unit_id = ${unitId} AND c.key = ${key} AND u.id = c.unit_id
         RETURNING c.last_value::text AS last_value, c.pattern, u.code`);
    } catch (error) {
        if (periodWentBack(error))
            throw new ConflictError('stale_version', {
                detail: 'The fiscal year just changed. Try again.',
                cause: error
            });
        throw error;
    }
    const row = result.rows[0];
    if (!row)
        throw new ConflictError('not_configured', {
            detail: 'This office has no number series for this document yet. Ask the administrator to set it up.'
        });
    const value = BigInt(row.last_value);
    const yearly = hasYear(row.pattern);
    return {
        value,
        ...(yearly ? { fiscalYear: year } : {}),
        number: formatNumber(row.pattern, { unit: row.code, seq: value, efy: year })
    };
}
