/**
 * The data viewer's queries over one form's submissions (task 0.16b): the view schema, and filter / search / sort /
 * group / aggregate / facets in one request. The fields a caller may name are the published version's that they may
 * see, and see in every version of the form that has them (submissions keep the version they were filled on: a field
 * restricted, a password or a row's field in an older one would show that version's answers). An older version's
 * answer of another kind reads as nothing (the compiler's type guards). The rows are those of the
 * caller's subtree (RLS). The whole request has 10 s: each statement gets what is left (`statement_timeout`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { users } from '@itrms/kernel/tables';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, InvalidRequestError } from '@itrms/kernel/errors';

import {
    MAX_DIRECT_EXPORT_ROWS,
    QUERY_LIMITS,
    type Submission,
    type SubmissionExport,
    type SubmissionQuery,
    type SubmissionQueryResult
} from '../contracts';
import { formatValue, renderCsv, renderXlsx } from './export';
import { FormsService } from './forms.service';
import { formVersions, submissions } from './forms.table';
import { QueryCompiler, type FieldSpec } from './query-compiler';
import { SubmissionsService } from './submissions.service';
import { fieldsFor } from './support';
import { readDocument } from '@itrms/form-engine/core';
import { BUILTIN_KEYS, BUILTINS, describe, valueFields, type ViewField } from './view-fields';

/** The time one query request may take, all its statements together. */
export const QUERY_BUDGET_MS = 10_000;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/** A group or facet key as the client filters with it (the database gives text, numbers or booleans). */
const key = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
    return JSON.stringify(v);
};

const tooLong = (cause?: unknown) =>
    new InvalidRequestError('invalid_query', {
        detail: 'The query took too long: narrow the filter, or ask for fewer groups and counts.',
        cause
    });

@Injectable()
export class SubmissionQueryService {
    constructor(
        @Inject(FormsService) private readonly forms: FormsService,
        @Inject(SubmissionsService) private readonly submissions: SubmissionsService
    ) {}

    /** What the data viewer can do with the form's submissions. */
    async view(tx: Tx, roles: readonly string[], formId: string) {
        const { fields, indexedKeys } = await this.fieldsOf(tx, roles, formId);
        return describe(fields, indexedKeys);
    }

    async query(tx: Tx, roles: readonly string[], q: SubmissionQuery): Promise<SubmissionQueryResult> {
        return withBudget(tx, (budget) => this.run(tx, roles, q, budget));
    }

    /**
     * The rows a query matches, as a file people read (task 0.16d): at most MAX_DIRECT_EXPORT_ROWS, the chosen fields
     * (all by default) as the viewer shows them. The caller records the export (an audited event, with its size).
     */
    async export(
        tx: Tx,
        roles: readonly string[],
        input: SubmissionExport,
        language: string
    ): Promise<{ filename: string; contentType: string; body: Buffer; rows: number; fields: number }> {
        return withBudget(tx, async (budget) => {
            const { form, fields, indexedKeys } = await this.fieldsOf(tx, roles, input.formId);
            const compiler = new QueryCompiler(input.formId, specsOf(fields, indexedKeys));
            const cond = conditionsOf(compiler, input);
            await budget();
            const counted = await tx.execute<{ n: number }>(
                sql`select count(*)::int as n from ${submissions} where ${cond}`
            );
            const total = Number(counted.rows[0]?.n ?? 0);
            if (total > MAX_DIRECT_EXPORT_ROWS)
                throw new InvalidRequestError('invalid_query', {
                    detail: `${total} submissions match: an export answers at most ${MAX_DIRECT_EXPORT_ROWS}. Narrow the filter.`
                });
            const byKey = new Map(fields.map((f) => [f.key, f]));
            const keys = input.fields ?? [...BUILTINS.map((b) => b.key), ...fields.map((f) => f.key)];
            for (const k of keys)
                if (!BUILTIN_KEYS.has(k) && !byKey.has(k))
                    throw new InvalidRequestError('invalid_query', { detail: `unknown field "${k}"` });

            await budget();
            const order = compiler.orderBy(input.sort.length ? input.sort : [{ field: 'createdAt', desc: true }]);
            const rows = await tx
                .select()
                .from(submissions)
                .where(cond)
                .orderBy(...order, sql`${submissions.id} desc`)
                .limit(MAX_DIRECT_EXPORT_ROWS);
            await budget();
            const shown = await this.submissions.present(tx, roles, rows);
            const people = await namesOf(
                tx,
                shown.map((s) => s.submittedBy)
            );
            const label = (k: string) => BUILTINS.find((b) => b.key === k)?.label ?? byKey.get(k)?.label ?? k;
            const cell = (s: Submission, k: string): string => {
                if (k === 'createdAt') return addisMinute(s.createdAt);
                if (k === 'submittedBy') return s.submittedBy ? (people.get(s.submittedBy) ?? s.submittedBy) : '';
                if (k === 'handlingUnit')
                    return s.handlingUnit.name[language] ?? s.handlingUnit.name.en ?? s.handlingUnit.code;
                const f = byKey.get(k);
                return f ? formatValue(f, s.answers[k]) : '';
            };
            const headers = keys.map(label);
            const table = shown.map((s) => keys.map((k) => cell(s, k)));
            const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const body =
                input.format === 'xlsx'
                    ? await renderXlsx(form.name[language] ?? form.name.en ?? form.key, headers, table)
                    : renderCsv(headers, table);
            return {
                filename: `${form.key}-${stamp}.${input.format}`,
                contentType:
                    input.format === 'xlsx'
                        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        : 'text/csv; charset=utf-8',
                body,
                rows: shown.length,
                fields: keys.length
            };
        });
    }

    private async run(
        tx: Tx,
        roles: readonly string[],
        q: SubmissionQuery,
        budget: () => Promise<void>
    ): Promise<SubmissionQueryResult> {
        const { fields, indexedKeys } = await this.fieldsOf(tx, roles, q.formId);
        const compiler = new QueryCompiler(q.formId, specsOf(fields, indexedKeys));

        const cond = conditionsOf(compiler, q);
        const scalar = async (cols: SQL) => {
            await budget();
            return (
                (await tx.execute<Record<string, unknown>>(sql`select ${cols} from ${submissions} where ${cond}`))
                    .rows[0] ?? {}
            );
        };

        const total = Number((await scalar(sql`count(*) as n`)).n ?? 0);

        const aggregateName = (a: SubmissionQuery['aggregates'][number]) =>
            a.alias ?? (a.field ? `${a.fn}_${a.field}` : a.fn);
        const aggregateCols = q.aggregates.map((a) => compiler.aggregate(a.fn, a.field));
        const aggregates: Record<string, number | null> = {};
        if (aggregateCols.length) {
            await budget();
            const row = await tx.execute<Record<string, unknown>>(
                sql`select ${sql.join(
                    aggregateCols.map((c, i) => sql`${c} as ${sql.identifier(`a${i}`)}`),
                    sql`, `
                )} from ${submissions} where ${cond}`
            );
            q.aggregates.forEach((a, i) => (aggregates[aggregateName(a)] = num(row.rows[0]?.[`a${i}`])));
        }

        const groups: SubmissionQueryResult['groups'] = [];
        if (q.thenBy && !q.groupBy) throw new InvalidRequestError('invalid_query', { detail: 'thenBy needs groupBy' });
        if (q.groupBy) {
            const dims = [q.groupBy, ...(q.thenBy ? [q.thenBy] : [])];
            const keys = dims.map((d) => compiler.groupExpr(d.field, d.bucket));
            const n = keys.length;
            const byDate = ['date', 'datetime'].includes(compiler.spec(q.groupBy.field).kind);
            // positional GROUP BY / ORDER BY: a key expression carries bound parameters and is written once
            await budget();
            const result = await tx.execute<Record<string, unknown>>(
                sql`select ${sql.join(
                    [
                        ...keys.map((k, i) => sql`${k} as ${sql.identifier(`k${i}`)}`),
                        sql`count(*) as n`,
                        ...aggregateCols.map((c, i) => sql`${c} as ${sql.identifier(`a${i}`)}`)
                    ],
                    sql`, `
                )} from ${submissions} where ${cond}
                group by ${n === 2 ? sql`1, 2` : sql`1`}
                order by ${byDate ? (n === 2 ? sql`1, 2` : sql`1`) : n === 2 ? sql`3 desc` : sql`2 desc`}
                limit ${n === 2 ? QUERY_LIMITS.groups2d : QUERY_LIMITS.groups}`
            );
            for (const r of result.rows)
                groups.push({
                    key: key(r.k0),
                    key2: n === 2 ? key(r.k1) : null,
                    count: Number(r.n),
                    aggregates: Object.fromEntries(q.aggregates.map((a, i) => [aggregateName(a), num(r[`a${i}`])]))
                });
        }

        const facets: SubmissionQueryResult['facets'] = {};
        for (const field of new Set(q.facets)) {
            await budget();
            const result = await tx.execute<{ v: unknown; n: unknown }>(
                sql`select ${compiler.facetExpr(field)} as v, count(*) as n from ${submissions} where ${cond}
                    group by 1 order by 2 desc limit ${QUERY_LIMITS.facetValues}`
            );
            facets[field] = result.rows.map((r) => ({ value: key(r.v), count: Number(r.n) }));
        }

        let items: Submission[] = [];
        if (q.rows) {
            const order = compiler.orderBy(q.sort.length ? q.sort : [{ field: 'createdAt', desc: true }]);
            await budget();
            const rows = await tx
                .select()
                .from(submissions)
                .where(cond)
                .orderBy(...order, sql`${submissions.id} desc`)
                .offset((q.page - 1) * q.pageSize)
                .limit(q.pageSize);
            await budget();
            items = await this.submissions.present(tx, roles, rows);
        }
        return { items, total, page: q.page, pageSize: q.pageSize, aggregates, groups, facets };
    }

    /**
     * The published version's value fields the caller may see, kept only where every version of the form that has the
     * field shows it to them as a queryable field; and which of them the value table holds.
     */
    private async fieldsOf(tx: Tx, roles: readonly string[], formId: string) {
        const form = await this.forms.definition(tx, formId);
        if (!form.publishedVersionId)
            throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        const versions = (
            await tx
                .select({ id: formVersions.id, document: formVersions.document })
                .from(formVersions)
                .where(eq(formVersions.formId, formId))
        ).map((v) => {
            const seen = valueFields(fieldsFor(v.document, roles));
            return {
                id: v.id,
                seen,
                // every field id the version has (anywhere), and the top-level value fields the caller sees
                has: new Set(readDocument(v.document).fields.map((f) => f.id)),
                sees: new Map(seen.map((f) => [f.key, f.kind]))
            };
        });
        const published = versions.find((v) => v.id === form.publishedVersionId);
        if (!published) throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        const fields = published.seen.filter((f) => versions.every((v) => !v.has.has(f.key) || v.sees.has(f.key)));
        return { form, fields, indexedKeys: form.indexedKeys };
    }
}

/** The form, its filter and its search, as one condition. */
function conditionsOf(
    compiler: QueryCompiler,
    q: { formId: string; filter?: SubmissionQuery['filter']; search?: string }
): SQL {
    const where: SQL[] = [sql`${submissions.formId} = ${q.formId}::uuid`];
    if (q.filter?.items.length) where.push(compiler.group(q.filter));
    const search = compiler.search(q.search);
    if (search) where.push(search);
    return sql.join(where, sql` and `);
}

/**
 * The whole request has QUERY_BUDGET_MS (NFR reads: p95 < 300 ms; a runaway filter is stopped, never left running): each
 * statement gets what is left (`budget()` before it), and a cancelled one is the caller's 400, never a 500.
 */
async function withBudget<T>(tx: Tx, fn: (budget: () => Promise<void>) => Promise<T>): Promise<T> {
    const deadline = Date.now() + QUERY_BUDGET_MS;
    const budget = async () => {
        const left = deadline - Date.now();
        if (left <= 0) throw tooLong();
        await tx.execute(sql`select set_config('statement_timeout', ${String(Math.ceil(left))}, true)`);
    };
    try {
        await budget();
        return await fn(budget);
    } catch (error) {
        for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
            if ((e as { code?: string }).code === '57014') throw tooLong(error);
        throw error;
    }
}

/** Staff names for a table (users are a regional record). */
async function namesOf(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await tx
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, wanted));
    return new Map(rows.map((r) => [r.id, r.name]));
}

/** An instant as read in Ethiopia: Addis Ababa time, to the minute (Gregorian here; Ethiopian dates come with 0.17). */
const addisMinute = (iso: string) =>
    new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

/** The allow-list: the built-in columns, then the form's fields (never shadowing one). */
export function specsOf(fields: ViewField[], indexedKeys: readonly string[]): FieldSpec[] {
    return [
        { key: 'createdAt', kind: 'datetime', column: sql`${submissions.createdAt}` },
        { key: 'submittedBy', kind: 'person', column: sql`${submissions.createdBy}` },
        { key: 'handlingUnit', kind: 'unit', column: sql`${submissions.handlingUnitId}` },
        ...fields
            .filter((f) => !BUILTIN_KEYS.has(f.key))
            .map((f) => ({ key: f.key, kind: f.kind, indexed: f.filterable && indexedKeys.includes(f.key) }))
    ];
}
