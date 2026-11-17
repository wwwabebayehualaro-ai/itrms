/**
 * The counters an office needs for what it does (task 1.4b4, ADR-0056), from the enabled manifests: a sequence a module
 * declares (`numberSequences`) is needed by an office given a service that names it (`countersRequired`), or whose type
 * has a capability the sequence names (a receipt for an office that collects cash). They are set up in the transaction
 * that gives the office the service or creates it, so a step much later never finds none.
 */
import type { ModuleManifest } from '@itrms/module-sdk';
import { sql } from 'drizzle-orm';

import { recordEvent } from '../db/audit';
import type { Tx } from '../db/types';
import { newId } from '../db/columns';
import { numberCounters } from './numbering.table';

export interface CounterNeed {
    key: string;
    pattern: string;
}

/** What the manifests say each service and each capability needs: `<owner>.<sequence>` with its pattern. */
export function counterNeeds(manifests: readonly ModuleManifest[]) {
    const sequences = new Map<string, CounterNeed & { capabilities: readonly string[] }>();
    for (const m of manifests)
        for (const s of m.numberSequences)
            sequences.set(`${m.key}.${s.key}`, {
                key: `${m.key}.${s.key}`,
                pattern: s.pattern,
                capabilities: s.capabilities
            });
    const byService = new Map<string, Set<string>>();
    for (const m of manifests)
        for (const [service, keys] of Object.entries(m.countersRequired))
            for (const k of keys) (byService.get(service) ?? byService.set(service, new Set()).get(service))?.add(k);
    return {
        /** the counters an office with these services and capabilities needs, each once */
        of(services: readonly string[], capabilities: readonly string[]): CounterNeed[] {
            const wanted = new Set<string>();
            for (const code of services) for (const k of byService.get(code) ?? []) wanted.add(k);
            for (const s of sequences.values())
                if (s.capabilities.some((c) => capabilities.includes(c))) wanted.add(s.key);
            return [...wanted].sort().flatMap((k) => {
                const s = sequences.get(k);
                return s ? [{ key: s.key, pattern: s.pattern }] : [];
            });
        }
    };
}

/**
 * The unit's counter of this key, made fresh (at 0, no fiscal period) when it has none; one it has is never touched, so a
 * migrated register's start stays. A counter made is an audited event in the same transaction (the table itself is not
 * audited: it moves with every number). Raw SQL names only the columns the API role may insert (0085).
 */
export async function ensureCounter(
    tx: Tx,
    counter: CounterNeed & { unitId: string; regionId: string },
    because: string
): Promise<boolean> {
    const { rows } = await tx.execute<{ id: string }>(sql`
        insert into kernel.number_counters (id, region_id, unit_id, key, pattern)
        values (${newId()}, ${counter.regionId}, ${counter.unitId}, ${counter.key}, ${counter.pattern})
        on conflict (unit_id, key) do nothing
        returning id`);
    const made = rows[0]?.id;
    if (!made) return false;
    await recordEvent(tx, {
        type: 'numbering.counter_set_up',
        table: numberCounters,
        rowId: made,
        data: { key: counter.key, unitId: counter.unitId, pattern: counter.pattern, because }
    });
    return true;
}
