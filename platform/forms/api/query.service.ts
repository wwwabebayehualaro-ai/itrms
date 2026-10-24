/**
 * The data viewer's queries over one form's submissions (task 0.16b): the view schema, and filter / search / sort /
 * group / aggregate / facets in one request. The fields a caller may name are the published version's that they may
 * see; the rows are those of their subtree (RLS); every query runs under a statement timeout.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { ConflictError, InvalidRequestError } from '@itrms/kernel/errors';

import { QUERY_LIMITS, type Submission, type SubmissionQuery, type SubmissionQueryResult } from '../contracts';
import { FormsService } from './forms.service';
import { formVersions, submissions } from './forms.table';
import { QueryCompiler, type FieldSpec } from './query-compiler';
import { SubmissionsService } from './submissions.service';
import { fieldsFor } from './support';
import { BUILTIN_KEYS, describe, valueFields, type ViewField } from './view-fields';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/** A group or facet key as the client filters with it (the database gives text, numbers or booleans). */
const key = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
    return JSON.stringify(v);
};

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
        const { fields, indexedKeys } = await this.fieldsOf(tx, roles, q.formId);
        // the ceiling of one query (NFR reads: p95 < 300 ms; a runaway filter is stopped, never left running)
        await tx.execute(sql`set local statement_timeout = '10s'`);
        const compiler = new QueryCompiler(q.formId, specsOf(fields, indexedKeys));

        const where: SQL[] = [sql`${submissions.formId} = ${q.formId}::uuid`];
        if (q.filter?.items.length) where.push(compiler.group(q.filter));
        const search = compiler.search(q.search);
        if (search) where.push(search);
        const cond = sql.join(where, sql` and `);
        const scalar = async (cols: SQL) =>
            (await tx.execute<Record<string, unknown>>(sql`select ${cols} from ${submissions} where ${cond}`))
                .rows[0] ?? {};

        const total = Number((await scalar(sql`count(*) as n`)).n ?? 0);

        const aggregateName = (a: SubmissionQuery['aggregates'][number]) =>
            a.alias ?? (a.field ? `${a.fn}_${a.field}` : a.fn);
        const aggregateCols = q.aggregates.map((a) => compiler.aggregate(a.fn, a.field));
        const aggregates: Record<string, number | null> = {};
        if (aggregateCols.length) {
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
            const result = await tx.execute<{ v: unknown; n: unknown }>(
                sql`select ${compiler.facetExpr(field)} as v, count(*) as n from ${submissions} where ${cond}
                    group by 1 order by 2 desc limit ${QUERY_LIMITS.facetValues}`
            );
            facets[field] = result.rows.map((r) => ({ value: key(r.v), count: Number(r.n) }));
        }

        let items: Submission[] = [];
        if (q.rows) {
            const order = compiler.orderBy(q.sort.length ? q.sort : [{ field: 'createdAt', desc: true }]);
            const rows = await tx
                .select()
                .from(submissions)
                .where(cond)
                .orderBy(...order, sql`${submissions.id} desc`)
                .offset((q.page - 1) * q.pageSize)
                .limit(q.pageSize);
            items = await this.submissions.present(tx, roles, rows);
        }
        return { items, total, page: q.page, pageSize: q.pageSize, aggregates, groups, facets };
    }

    /** The published version's value fields the caller may see, and which of them the value table holds. */
    private async fieldsOf(tx: Tx, roles: readonly string[], formId: string) {
        const form = await this.forms.definition(tx, formId);
        if (!form.publishedVersionId)
            throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        const [version] = await tx
            .select({ document: formVersions.document })
            .from(formVersions)
            .where(eq(formVersions.id, form.publishedVersionId));
        return { fields: valueFields(fieldsFor(version?.document, roles)), indexedKeys: form.indexedKeys };
    }
}

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
