/**
 * The data viewer's queries over one form's submissions (task 0.16b): the view schema, and filter / search / sort /
 * group / aggregate / facets in one request. The fields a caller may name are the published version's that they may
 * see, and see in every version of the form that has them (submissions keep the version they were filled on: a field
 * restricted, a password or a row's field in an older one would show that version's answers). An older version's
 * answer of another kind reads as nothing (the compiler's type guards). The rows are those of the
 * caller's subtree (RLS). The whole request has 10 s: each statement gets what is left (`statement_timeout`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, InvalidRequestError } from '@itrms/kernel/errors';
import { textIn } from '@itrms/schemas';

import {
    MAX_DIRECT_EXPORT_ROWS,
    QUERY_LIMITS,
    type Submission,
    type SubmissionExport,
    type SubmissionQuery,
    type SubmissionQueryResult
} from '../contracts';
import { ExportRefused, formatValue, word, type ExportTable } from './export';
import { MAX_GENERATED_BYTES } from '@itrms/kernel/files';
import { unitRefs } from '@itrms/kernel/org';
import { FormsService, namesOf } from './forms.service';
import { formVersions, submissions } from './forms.table';
import { QueryCompiler, type FieldSpec } from './query-compiler';
import { SubmissionsService, type SubmissionRow } from './submissions.service';
import { openFieldsFor } from './support';
import { readDocument } from '@itrms/form-engine/core';
import { BUILTIN_KEYS, BUILTINS, describe, valueFields, type ViewField } from './view-fields';

/** The most offices and people the view schema offers as the built-ins' choices. */
const MAX_BUILTIN_OPTIONS = 200;

/** The time one query request may take, all its statements together. */
export const QUERY_BUDGET_MS = 10_000;

/** A stored name in the caller's language (am, then en, then any: never the other optional language first). */
const named = (name: Record<string, string>, language: string) => textIn({ am: '', en: '', ...name }, language);

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
    async view(tx: Tx, roles: readonly string[], formId: string, language: string) {
        const { fields, indexedKeys } = await this.fieldsOf(tx, roles, formId, language);
        return withBudget(tx, async (budget) => {
            // the built-ins' choices, from the submissions the caller sees (RLS bounds them): no directory of the region
            const distinct = async (column: SQL) => {
                await budget();
                const result = await tx.execute<{ v: string }>(
                    sql`select distinct ${column} as v from ${submissions}
                        where ${submissions.formId} = ${formId} and ${column} is not null limit ${MAX_BUILTIN_OPTIONS}`
                );
                return result.rows.map((r) => r.v);
            };
            const unitIds = await distinct(sql`${submissions.handlingUnitId}`);
            const personIds = await distinct(sql`${submissions.createdBy}`);
            const units = await unitRefs(tx, unitIds);
            const people = await namesOf(tx, personIds);
            const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
            return describe(
                fields,
                indexedKeys,
                {
                    handlingUnit: [...units.values()]
                        .map((u) => ({ value: u.id, label: named(u.name, language) || u.code }))
                        .sort(byLabel),
                    submittedBy: [...people].map(([value, label]) => ({ value, label })).sort(byLabel)
                },
                (k) => word(language, k)
            );
        });
    }

    async query(tx: Tx, roles: readonly string[], q: SubmissionQuery): Promise<SubmissionQueryResult> {
        return withBudget(tx, (budget) => this.run(tx, roles, q, budget));
    }

    /**
     * The rows a query matches as the table of a file people read (task 0.16d): at most MAX_DIRECT_EXPORT_ROWS, the
     * chosen fields (all by default) as the viewer shows them. Only the columns the table needs are read (the chosen
     * keys of the answers, never the whole documents); the file is made by the caller once the transaction is over.
     */
    async exportTable(
        tx: Tx,
        roles: readonly string[],
        input: SubmissionExport,
        language: string,
        /** the direct export's, unless the worker makes a background one (task 0.16e) */
        limits: { maxRows: number; budgetMs: number } = { maxRows: MAX_DIRECT_EXPORT_ROWS, budgetMs: QUERY_BUDGET_MS }
    ): Promise<ExportTable> {
        return withBudget(
            tx,
            async (budget) => {
                const { form, fields, indexedKeys } = await this.fieldsOf(tx, roles, input.formId, language);
                const compiler = new QueryCompiler(input.formId, specsOf(fields, indexedKeys));
                const cond = conditionsOf(compiler, input);
                await budget();
                const counted = await tx.execute<{ n: number }>(
                    sql`select count(*)::int as n from ${submissions} where ${cond}`
                );
                const total = Number(counted.rows[0]?.n ?? 0);
                if (total > limits.maxRows)
                    throw new ExportRefused(
                        'too_many_rows',
                        limits.maxRows === MAX_DIRECT_EXPORT_ROWS
                            ? `${total} submissions match: a direct export answers at most ${MAX_DIRECT_EXPORT_ROWS}. Ask for it in the background (made into a file you download), or narrow the filter.`
                            : `${total} submissions match: an export holds at most ${limits.maxRows}. Narrow the filter.`
                    );
                const byKey = new Map(fields.map((f) => [f.key, f]));
                const keys = input.fields ?? [...BUILTINS.map((b) => b.key), ...fields.map((f) => f.key)];
                for (const k of keys)
                    if (!BUILTIN_KEYS.has(k) && !byKey.has(k))
                        throw new InvalidRequestError('invalid_query', { detail: `unknown field "${k}"` });
                const answerKeys = keys.filter((k) => byKey.has(k));
                const subset = sql`(select coalesce(jsonb_object_agg(k, ${submissions.answers} -> k), '{}'::jsonb)
                    from unnest(${`{${answerKeys.join(',')}}`}::text[]) k where ${submissions.answers} ? k)`;
                // what the chosen answers weigh, before they are read: an export that cannot fit is refused at once
                await budget();
                const weighed = await tx.execute<{ bytes: string | null }>(
                    sql`select sum(pg_column_size(${subset}))::text as bytes from ${submissions} where ${cond}`
                );
                if (Number(weighed.rows[0]?.bytes ?? 0) > MAX_GENERATED_BYTES)
                    throw new ExportRefused(
                        'too_large',
                        'The chosen answers are too large for one file: narrow the filter or choose fewer fields.'
                    );

                await budget();
                const order = compiler.orderBy(input.sort.length ? input.sort : [{ field: 'createdAt', desc: true }]);
                const rows = await tx
                    .select({
                        id: submissions.id,
                        rowVersion: submissions.rowVersion,
                        formId: submissions.formId,
                        formVersionId: submissions.formVersionId,
                        caseId: submissions.caseId,
                        handlingUnitId: submissions.handlingUnitId,
                        createdBy: submissions.createdBy,
                        createdAt: submissions.createdAt,
                        updatedAt: submissions.updatedAt,
                        // only the chosen keys of the answers
                        answers: sql<Record<string, unknown>>`${subset}`
                    })
                    .from(submissions)
                    .where(cond)
                    .orderBy(...order, sql`${submissions.id} desc`)
                    .limit(limits.maxRows);
                await budget();
                const shown = await this.submissions.present(tx, roles, rows as SubmissionRow[]);
                const people = await namesOf(
                    tx,
                    shown.map((s) => s.submittedBy)
                );
                const label = (k: string) => (BUILTIN_KEYS.has(k) ? word(language, k) : (byKey.get(k)?.label ?? k));
                const cell = (s: Submission, k: string): string => {
                    if (k === 'createdAt') return addisMinute(s.createdAt);
                    if (k === 'submittedBy') return s.submittedBy ? (people.get(s.submittedBy) ?? s.submittedBy) : '';
                    if (k === 'handlingUnit') return named(s.handlingUnit.name, language) || s.handlingUnit.code;
                    const f = byKey.get(k);
                    return f ? formatValue(f, s.answers[k], language) : '';
                };
                // an Ethiopian date gives two columns: as the viewer shows it (E.C.), and the stored Gregorian day
                const columns = keys.flatMap((k) =>
                    byKey.get(k)?.type === 'EthDate'
                        ? [
                              {
                                  header: `${label(k)} (${word(language, 'ethiopianCalendar')})`,
                                  cell: (s: Submission) => cell(s, k)
                              },
                              {
                                  header: `${label(k)} (${word(language, 'gregorianCalendar')})`,
                                  cell: (s: Submission) => {
                                      const day = s.answers[k];
                                      return typeof day === 'string' ? day : '';
                                  }
                              }
                          ]
                        : [{ header: label(k), cell: (s: Submission) => cell(s, k) }]
                );
                // the day in Addis Ababa
                const stamp = addisMinute(new Date().toISOString()).slice(0, 10).replace(/-/g, '');
                return {
                    format: input.format,
                    filename: `${form.key}-${stamp}.${input.format}`,
                    sheetName: named(form.name, language) || form.key,
                    headers: columns.map((c) => c.header),
                    rows: shown.map((s) => columns.map((c) => c.cell(s))),
                    keys
                };
            },
            limits.budgetMs
        );
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
    private async fieldsOf(tx: Tx, roles: readonly string[], formId: string, language = 'am') {
        const form = await this.forms.definition(tx, formId);
        if (!form.publishedVersionId)
            throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        const versions = (
            await tx
                .select({ id: formVersions.id, document: formVersions.document })
                .from(formVersions)
                .where(eq(formVersions.formId, formId))
        ).map((v) => {
            // never a Sensitive field: it would show, sort or filter by its values (task 0.20d)
            const seen = valueFields(openFieldsFor(v.document, roles, language));
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
async function withBudget<T>(
    tx: Tx,
    fn: (budget: () => Promise<void>) => Promise<T>,
    budgetMs = QUERY_BUDGET_MS
): Promise<T> {
    const deadline = Date.now() + budgetMs;
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
