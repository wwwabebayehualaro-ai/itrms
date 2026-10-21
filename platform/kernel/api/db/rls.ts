/**
 * Row-level security classes (ADR-0011, architecture.md §5). A table file declares its class with `withRls(table, class)`;
 * its migration applies the class's policies with `SELECT kernel.apply_rls('<schema>.<table>', '<class>', '<column>')`
 * (`rlsPolicies(table)` writes that line). The isolation matrix reads this registry and checks every tenant table in the
 * database (a table with `region_id`) is declared, has RLS on, and carries exactly its class's policies.
 *
 *   registry     readable across the region; written only for records the unit handles (`handling_org_path`)
 *   transaction  the unit's subtree (`org_path`)
 *   config       read: the subtree and its ancestors; write: the subtree (`org_path`)
 *   party        an external participant's own rows (`party_id`)
 *
 * Every policy is `TO itrms_app`, checks `region_id`, and reads the request's settings null-safely: no context, no rows.
 */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

export const RLS_CLASSES = ['registry', 'transaction', 'config', 'party'] as const;
export type RlsClass = (typeof RLS_CLASSES)[number];

const DEFAULT_COLUMN: Record<RlsClass, string> = {
    registry: 'handling_org_path',
    transaction: 'org_path',
    config: 'org_path',
    party: 'party_id'
};

export interface RlsDeclaration {
    cls: RlsClass;
    /** the scope column the policies test (an ltree path, or the party id) */
    column: string;
}

const DECLARED = new WeakMap<PgTable, RlsDeclaration>();
const ALL: { table: PgTable; declaration: RlsDeclaration }[] = [];

export function withRls<T extends PgTable>(table: T, cls: RlsClass, column = DEFAULT_COLUMN[cls]): T {
    const declaration = { cls, column };
    DECLARED.set(table, declaration);
    ALL.push({ table, declaration });
    return table;
}

export const rlsOf = (table: PgTable): RlsDeclaration | undefined => DECLARED.get(table);

/** Every declared table as `schema.name`, with its class and column. */
export function declaredRlsTables(): { name: string; cls: RlsClass; column: string }[] {
    return ALL.map(({ table, declaration }) => {
        const { schema, name } = getTableConfig(table);
        return { name: `${schema ?? 'public'}.${name}`, ...declaration };
    });
}

/** The migration line that applies a declared table's policies. */
export function rlsPolicies(table: PgTable): string {
    const declaration = DECLARED.get(table);
    const { schema, name } = getTableConfig(table);
    if (!declaration) throw new Error(`${schema ?? 'public'}.${name} has no withRls() declaration`);
    return `SELECT kernel.apply_rls('${schema ?? 'public'}.${name}', '${declaration.cls}', '${declaration.column}');`;
}
