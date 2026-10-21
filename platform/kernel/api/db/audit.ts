/**
 * The write helpers (ADR-0018, architecture.md §4 step 6): every insert, update and delete of a business table goes through
 * them, and each writes its audit row in the same transaction, so a change and its audit commit or roll back together.
 * Updates and deletes name the row version they were based on; an older one is refused with 409 `stale_version`.
 * A table's audit policy says which columns never enter the log (`omit`: secrets) and which enter it only as an HMAC
 * (`mask`: personal data; the HMAC proves a change without revealing the value).
 */
import { createHmac } from 'node:crypto';

import { eq, getTableColumns, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';

import { ConflictError, NotFoundError } from '../errors/app-error';
import { auditLog, type AuditAction } from './audit-log.table';
import { auditOptionsOf, auditPolicyOf, type AuditOptions } from './audit-policy';
import type { DbContext, Tx } from './types';

/** A business table: the base columns (columns.ts) and an `audited` declaration. */
export type BaseTable = PgTable & {
    id: PgColumn;
    rowVersion: PgColumn;
    updatedAt: PgColumn;
    updatedBy: PgColumn;
    createdBy: PgColumn;
};

interface Binding {
    ctx: DbContext;
    /** The installation's key for masked columns; without one they are written as "[masked]". */
    auditKey?: string;
}

const BINDINGS = new WeakMap<object, Binding>();

/** Called by `scoped` for the transaction it opens: the helpers take the actor and the request from here. */
export function bindContext(tx: Tx, ctx: DbContext, auditKey?: string) {
    BINDINGS.set(tx, { ctx, auditKey });
}

function bindingOf(tx: Tx): Binding {
    const binding = BINDINGS.get(tx);
    if (!binding) throw new Error('the write helpers take only a transaction opened by db.scoped()');
    return binding;
}

const nameOf = (table: PgTable) => {
    const { schema, name } = getTableConfig(table);
    return schema ? `${schema}.${name}` : name;
};

function assertAudited(table: PgTable) {
    if (auditPolicyOf(table) !== 'audited')
        throw new Error(`${nameOf(table)} is not declared audited(): its writes cannot be audited`);
}

/**
 * A value as JSON, at any depth: dates as ISO strings, bigint (santim) as strings (no amount turns into a float, and JSON
 * has no bigint), binary as base64.
 */
export function plain(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Uint8Array) return `base64:${Buffer.from(value).toString('base64')}`;
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
    return value;
}

/** A row as the audit log may hold it: secrets left out, personal fields as an HMAC. */
function auditable(row: Record<string, unknown>, options: AuditOptions, auditKey?: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
        if (options.omit?.includes(k)) continue;
        if (options.mask?.includes(k)) {
            out[k] =
                v === null || v === undefined
                    ? v
                    : auditKey
                      ? `hmac:${createHmac('sha256', auditKey)
                            .update(JSON.stringify(plain(v)))
                            .digest('hex')}`
                      : '[masked]';
            continue;
        }
        out[k] = plain(v);
    }
    return out;
}

/** What changes on every write: not part of what the person changed. */
const BOOKKEEPING = new Set(['updatedAt', 'updatedBy', 'rowVersion']);

async function writeAudit(
    tx: Tx,
    entry: { action: AuditAction; table?: PgTable; rowId?: string; eventType?: string; diff?: unknown }
) {
    const { ctx } = bindingOf(tx);
    await tx.insert(auditLog).values({
        action: entry.action,
        tableName: entry.table ? nameOf(entry.table) : null,
        rowId: entry.rowId ?? null,
        eventType: entry.eventType ?? null,
        diff: entry.diff ?? null,
        actorId: ctx.userId ?? null,
        unitId: ctx.unitId ?? null,
        regionId: ctx.regionId ?? null,
        orgPath: ctx.scopePath ?? null,
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null
    });
}

export async function insertAudited<T extends BaseTable>(
    tx: Tx,
    table: T,
    values: InferInsertModel<T>
): Promise<InferSelectModel<T>> {
    assertAudited(table);
    const { ctx, auditKey } = bindingOf(tx);
    const rows = (await tx
        .insert(table)
        .values({ ...values, createdBy: ctx.userId ?? null, updatedBy: ctx.userId ?? null } as never)
        .returning()) as unknown as (InferSelectModel<T> & { id: string })[];
    const created = rows[0];
    if (!created) throw new NotFoundError(); // the row was not written (refused by a policy): nothing to audit
    await writeAudit(tx, {
        action: 'insert',
        table,
        rowId: created.id,
        diff: { after: auditable(created, auditOptionsOf(table), auditKey) }
    });
    return created;
}

/** The row, locked for this transaction, if `expectedVersion` is still current. */
async function lockCurrent<T extends BaseTable>(tx: Tx, table: T, id: string, expectedVersion: number) {
    // a plain PgTable for select(): Drizzle's typing of a generic table here is a conditional type tsc cannot resolve
    const source: PgTable = table;
    const rows = (await tx.select().from(source).where(eq(table.id, id)).for('update')) as Record<string, unknown>[];
    const current = rows[0];
    if (!current) throw new NotFoundError();
    if (current.rowVersion !== expectedVersion)
        throw new ConflictError('stale_version', {
            detail: `Version ${expectedVersion} was changed; the current version is ${String(current.rowVersion)}.`
        });
    return current;
}

export async function updateAudited<T extends BaseTable>(
    tx: Tx,
    table: T,
    id: string,
    expectedVersion: number,
    changes: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T>> {
    assertAudited(table);
    const { ctx, auditKey } = bindingOf(tx);
    const before = await lockCurrent(tx, table, id, expectedVersion);
    const rows = (await tx
        .update(table)
        .set({
            ...changes,
            rowVersion: sql`${table.rowVersion} + 1`,
            updatedAt: new Date(),
            updatedBy: ctx.userId ?? null
        })
        .where(eq(table.id, id))
        .returning()) as Record<string, unknown>[];
    // a row the person may read but not change (a stricter UPDATE policy) is not changed: say so, audit nothing
    const after = rows[0];
    if (!after) throw new NotFoundError();
    const options = auditOptionsOf(table);
    const was = auditable(before, options, auditKey);
    const is = auditable(after, options, auditKey);
    const changed = Object.keys(getTableColumns(table)).filter(
        (k) => !BOOKKEEPING.has(k) && !options.omit?.includes(k) && JSON.stringify(was[k]) !== JSON.stringify(is[k])
    );
    await writeAudit(tx, {
        action: 'update',
        table,
        rowId: id,
        diff: {
            before: Object.fromEntries(changed.map((k) => [k, was[k]])),
            after: Object.fromEntries(changed.map((k) => [k, is[k]]))
        }
    });
    return after as InferSelectModel<T>;
}

export async function deleteAudited<T extends BaseTable>(
    tx: Tx,
    table: T,
    id: string,
    expectedVersion: number
): Promise<void> {
    assertAudited(table);
    const { auditKey } = bindingOf(tx);
    const before = await lockCurrent(tx, table, id, expectedVersion);
    const deleted = await tx.delete(table).where(eq(table.id, id)).returning({ id: table.id });
    // not deleted (a stricter DELETE policy): the row stays, so the log must not say it is gone
    if (deleted.length === 0) throw new NotFoundError();
    await writeAudit(tx, {
        action: 'delete',
        table,
        rowId: id,
        diff: { before: auditable(before, auditOptionsOf(table), auditKey) }
    });
}

export interface AuditEvent {
    type: string;
    table?: PgTable;
    rowId?: string;
    data?: Record<string, unknown>;
}

/**
 * A non-row event in the caller's transaction: it commits or rolls back with the work it describes. A sensitive event
 * that must stay on record even when the request fails (a denial, a reveal, an export) goes through
 * `Database.recordSensitiveEvent` instead, which commits on its own.
 */
export async function recordEvent(tx: Tx, event: AuditEvent): Promise<void> {
    await writeAudit(tx, {
        action: 'event',
        eventType: event.type,
        table: event.table,
        rowId: event.rowId,
        diff: event.data ? plain(event.data) : undefined
    });
}
