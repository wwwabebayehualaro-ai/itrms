/**
 * @itrms/kernel/testing: running code as a user of a given unit, and what the isolation matrix expects of each RLS class
 * (architecture.md §5, task 0.9). For tests only.
 *
 * The matrix places one row at each of these units, relative to the acting unit:
 *   own          the acting unit                  child        a unit below it
 *   parent       the unit above it                sibling      another unit under the same parent
 *   otherZone    a unit below the sibling         otherRegion  a unit of another region
 * and runs every read and write as the acting unit, and once with no context on a connection that has just served one.
 */
import type { Database } from '../db/database';
import type { RlsClass } from '../db/rls';
import type { DbContext, Tx } from '../db/types';

export interface UnitLike {
    id: string;
    regionId: string;
    path: string;
}

export const TEST_USER = '0199f0a0-0000-7000-8000-00000000aaaa';

/** The database context of a person acting for `unit`. */
export const contextFor = (unit: UnitLike, userId = TEST_USER): DbContext => ({
    requestId: `test:${unit.id}`,
    userId,
    unitId: unit.id,
    regionId: unit.regionId,
    scopePath: unit.path
});

/** Runs `fn` as a person acting for `unit`, in one scoped transaction. */
export const asUnit = <T>(db: Database, unit: UnitLike, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.scoped(contextFor(unit), fn);

export const ISOLATION_CASES = ['own', 'child', 'parent', 'sibling', 'otherZone', 'otherRegion'] as const;
export type IsolationCase = (typeof ISOLATION_CASES)[number];

/** The rows each class shows to the acting unit (party rows follow the party, not the unit). */
export const VISIBLE: Record<Exclude<RlsClass, 'party'>, readonly IsolationCase[]> = {
    transaction: ['own', 'child'],
    config: ['own', 'parent', 'child'],
    registry: ['own', 'child', 'parent', 'sibling', 'otherZone']
};

/** The rows each class lets the acting unit write. */
export const WRITABLE: Record<Exclude<RlsClass, 'party'>, readonly IsolationCase[]> = {
    transaction: ['own', 'child'],
    config: ['own', 'child'],
    registry: ['own', 'child']
};

/** The policies `kernel.apply_rls` gives each class, by name. */
export const POLICIES: Record<RlsClass, readonly string[]> = {
    transaction: ['rls_transaction'],
    config: ['rls_config_delete', 'rls_config_insert', 'rls_config_read', 'rls_config_update'],
    registry: ['rls_registry_delete', 'rls_registry_insert', 'rls_registry_read', 'rls_registry_update'],
    party: ['rls_party']
};
