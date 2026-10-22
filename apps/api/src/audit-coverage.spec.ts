/**
 * ADR-0018: a change without an audit row is a bug. Every table of every slice (each `*.table.ts`, the files drizzle-kit
 * builds the migrations from) is declared audited(), or notAudited() with a reason; the write helpers refuse the rest.
 */
import { auditPolicyOf } from '@itrms/kernel/db';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

declare global {
    interface ImportMeta {
        /** Vite's (and so Vitest's) eager glob import. */
        glob<T>(patterns: string[], options: { eager: true }): Record<string, T>;
    }
}

const files = import.meta.glob<Record<string, unknown>>(
    ['../../../platform/*/api/**/*.table.ts', '../../../modules/*/api/**/*.table.ts'],
    { eager: true }
);

const tables = Object.entries(files).flatMap(([file, exports]) =>
    Object.values(exports)
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => ({
            file,
            table,
            name: `${getTableConfig(table).schema ?? 'public'}.${getTableConfig(table).name}`
        }))
);

describe('every table', () => {
    it('is found (the glob matches the table files)', () => {
        expect(tables.map((t) => t.name)).toContain('kernel.audit_log');
    });

    it('is audited, or says why not', () => {
        const undeclared = tables
            .filter((t) => auditPolicyOf(t.table) === undefined)
            .map((t) => `${t.name} (${t.file})`);
        expect(undeclared).toEqual([]);
        const exceptions = tables.flatMap((t) => {
            const policy = auditPolicyOf(t.table);
            return typeof policy === 'object' ? [`${t.name}: ${policy.notAudited}`] : [];
        });
        // the allowlist: grows only with a reason, reviewed with the table
        expect(exceptions.sort()).toEqual([
            'kernel.audit_log: it is the audit log',
            'kernel.idempotency_keys: a technical record of a request already audited by the write it carried',
            'kernel.number_counters: a counter moves with every number issued; the business row that carries the number is audited',
            "kernel.outbox_events: an event of a business write that is itself audited; its status is the relay's bookkeeping",
            'kernel.region_data_keys: key material: written only by kernel.ensure_region_data_key, which writes its own audit event'
        ]);
    });
});
