/**
 * The query compiler (task 0.16b; ported from the legacy json_query.py): a data-only query (conditions, groups, sort,
 * aggregates, no SQL and no paths) becomes SQL over one form's submissions. Every key is checked against the form's
 * allow-list (view-fields.ts), every key and value reaches PostgreSQL as a bound parameter, and the number of
 * conditions, the nesting and the list sizes are bounded (SEC-IN-2, SEC-IN-3).
 *
 * Where a value is read from:
 *   - built-in columns (createdAt, submittedBy, handlingUnit);
 *   - a filterable field the value table holds for every submission (ADR-0035): its selective conditions are a lookup on
 *     forms.submission_values' indexes;
 *   - any other field: the answers, with a type guard (`jsonb_typeof`), so a value of the wrong type reads as nothing
 *     and never makes a query fail. Equality and "has" compare whole JSON values (`@>`): 100 is not "100". This path
 *     scans the form's submissions in the caller's scope (no index can serve it under RLS, ADR-0035).
 * A date is compared as the day the person picked (its ISO text); a timestamp, the built-in ones too, by its day in
 * Addis Ababa.
 */
import { sql, type SQL } from 'drizzle-orm';
import { InvalidRequestError } from '@itrms/kernel/errors';

import { QUERY_LIMITS, type QueryGroup } from '../contracts';
import { submissions, submissionValues } from './forms.table';
import {
    AGGREGATABLE,
    FACETABLE,
    GROUPABLE,
    KEY,
    MAX_INDEXED_TEXT,
    OPS_BY_KIND,
    SEARCHABLE,
    SORTABLE,
    type Kind
} from './view-fields';

export interface FieldSpec {
    key: string;
    kind: Kind;
    /** a column of forms.submissions (built-ins) */
    column?: SQL;
    /** its values are in the value table for every submission of the form */
    indexed?: boolean;
}

const TZ = 'Africa/Addis_Ababa';
const BUCKETS = { year: 4, month: 7, day: 10 } as const;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

const refuse = (detail: string): never => {
    throw new InvalidRequestError('invalid_query', { detail });
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A day as `YYYY-MM-DD` (a date, or the day of an ISO timestamp), checked to exist. */
function isoDay(v: unknown): string {
    const m = typeof v === 'string' ? DAY.exec(v) : null;
    const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (!m || !d || d.toISOString().slice(0, 10) !== m[0]) return refuse(`"${String(v)}" is not a date`);
    return m[0];
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A number as the text PostgreSQL's numeric reads (no float on the way). */
function asNumber(v: unknown): string {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && /^-?\d{1,18}(\.\d{1,12})?$/.test(v.trim())) return v.trim();
    return refuse('a number is required');
}

function asList(v: unknown): unknown[] {
    if (!Array.isArray(v) || v.length === 0) return refuse('a non-empty list is required');
    if (v.length > QUERY_LIMITS.list) return refuse(`at most ${QUERY_LIMITS.list} values per condition`);
    return v;
}

function asText(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return refuse('a text value is required');
}

function asPair(v: unknown): [unknown, unknown] {
    const list = asList(v);
    if (list.length !== 2) return refuse('"between" needs [from, to]');
    return [list[0], list[1]];
}

function asUuid(v: unknown): string {
    const s = asText(v);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
        return refuse('an identifier is required');
    return s;
}

/** JSON for a containment test: what an answer of exactly this value looks like. */
const json = (v: unknown) => JSON.stringify(v);

export class QueryCompiler {
    private readonly specs: Map<string, FieldSpec>;
    private conditions = 0;

    constructor(
        private readonly formId: string,
        specs: readonly FieldSpec[]
    ) {
        this.specs = new Map(specs.map((s) => [s.key, s]));
    }

    spec(key: string): FieldSpec {
        const spec = this.specs.get(key);
        if (!spec || (!spec.column && !KEY.test(spec.key))) return refuse(`unknown field "${key}"`);
        return spec;
    }

    // ---- reading values ----

    private node(spec: FieldSpec): SQL {
        return sql`(${submissions.answers} -> ${spec.key}::text)`;
    }

    text(spec: FieldSpec): SQL {
        if (spec.column)
            return spec.kind === 'text' || spec.kind === 'choice' ? spec.column : sql`(${spec.column})::text`;
        return sql`(${submissions.answers} ->> ${spec.key}::text)`;
    }

    /** A date or timestamp answer as the engine stores it (ISO text); anything else (an array, a number) reads as nothing. */
    private dateText(spec: FieldSpec): SQL {
        return sql`(case when jsonb_typeof(${this.node(spec)}) = 'string' then ${this.text(spec)} end)`;
    }

    /** A timestamp answer as an instant: only the ISO forms with a zone (forms.iso_instant), as the value table holds. */
    private instant(spec: FieldSpec): SQL {
        return sql`forms.iso_instant(${this.dateText(spec)})`;
    }

    number(spec: FieldSpec): SQL {
        return sql`(case when jsonb_typeof(${this.node(spec)}) = 'number' then (${this.text(spec)})::numeric end)`;
    }

    boolean(spec: FieldSpec): SQL {
        return sql`(case when jsonb_typeof(${this.node(spec)}) = 'boolean' then (${this.text(spec)})::boolean end)`;
    }

    value(spec: FieldSpec): SQL {
        if (spec.column) return spec.column;
        if (spec.kind === 'number') return this.number(spec);
        if (spec.kind === 'boolean') return this.boolean(spec);
        return this.text(spec);
    }

    /** The submission has a value table row of this field that matches `where` (on the alias-free value columns). */
    private indexed(spec: FieldSpec, where: SQL): SQL {
        return sql`${submissions.id} in (select ${submissionValues.submissionId} from ${submissionValues}
            where ${submissionValues.formId} = ${this.formId}::uuid and ${submissionValues.fieldKey} = ${spec.key}::text
              and ${where})`;
    }

    /** An answer of exactly this value, as JSON. */
    private holds(spec: FieldSpec, value: unknown): SQL {
        return sql`${submissions.answers} @> jsonb_build_object(${spec.key}::text, ${json(value)}::jsonb)`;
    }

    // ---- conditions ----

    private isEmpty(spec: FieldSpec): SQL {
        if (spec.column) return sql`${spec.column} is null`;
        if (spec.kind === 'multi' || spec.kind === 'files' || spec.kind === 'rows')
            return sql`coalesce(${this.node(spec)}, 'null'::jsonb) in ('null'::jsonb, '[]'::jsonb, '""'::jsonb, '{}'::jsonb)`;
        if (spec.kind === 'text' || spec.kind === 'choice' || spec.kind === 'date' || spec.kind === 'datetime')
            return sql`coalesce(${this.text(spec)}, '') = ''`;
        return sql`${this.value(spec)} is null`;
    }

    private dateClause(spec: FieldSpec, op: string, value: unknown): SQL {
        // bounds: [lo, hi) of the days named
        let lo: (day: string) => SQL;
        let target: SQL;
        if (spec.column) {
            target = spec.column;
            lo = (day) => sql`(${day}::date::timestamp at time zone ${TZ})`;
        } else if (spec.indexed && spec.kind === 'date') {
            target = sql`${submissionValues.valueDate}`;
            lo = (day) => sql`${day}::date`;
        } else if (spec.kind === 'datetime') {
            // a timestamp is on the day it is in Addis Ababa, on either path
            target = spec.indexed ? sql`${submissionValues.valueTs}` : this.instant(spec);
            lo = (day) => sql`(${day}::date::timestamp at time zone ${TZ})`;
        } else {
            // a date is the day the person picked: its ISO text's first ten characters
            target = this.dateText(spec);
            lo = (day) => sql`${day}::text`;
        }
        const hi = (day: string) => lo(nextDay(day));
        let where: SQL;
        if (op === 'eq') {
            const day = isoDay(value);
            where = sql`${target} >= ${lo(day)} and ${target} < ${hi(day)}`;
        } else if (op === 'gte') where = sql`${target} >= ${lo(isoDay(value))}`;
        else if (op === 'gt') where = sql`${target} >= ${hi(isoDay(value))}`;
        else if (op === 'lt') where = sql`${target} < ${lo(isoDay(value))}`;
        else if (op === 'lte') where = sql`${target} < ${hi(isoDay(value))}`;
        else if (op === 'between') {
            const [from, to] = asPair(value);
            where = sql`${target} >= ${lo(isoDay(from))} and ${target} < ${hi(isoDay(to))}`;
        } else return refuse(`"${op}" is not valid for dates`);
        return spec.indexed && !spec.column ? this.indexed(spec, where) : sql`(${where})`;
    }

    private numberClause(spec: FieldSpec, op: string, value: unknown): SQL {
        // the value table holds doubles (leakproof under RLS, ADR-0035); the answers are read as numeric
        const target = spec.indexed ? sql`${submissionValues.valueNum}` : this.number(spec);
        const cast = spec.indexed ? sql`float8` : sql`numeric`;
        const compare = (sign: SQL, v: unknown) => sql`${target} ${sign} ${asNumber(v)}::${cast}`;
        let where: SQL;
        if (op === 'between') {
            const [from, to] = asPair(value);
            where = sql`${compare(sql`>=`, from)} and ${compare(sql`<=`, to)}`;
        } else if (op === 'ne')
            return sql`(${this.number(spec)} is null or ${this.number(spec)} <> ${asNumber(value)}::numeric)`;
        else {
            const sign = { eq: sql`=`, gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` }[op];
            if (!sign) return refuse(`"${op}" is not valid for numbers`);
            if (op === 'eq' && !spec.indexed) return this.holds(spec, Number(asNumber(value)));
            where = compare(sign, value);
        }
        return spec.indexed ? this.indexed(spec, where) : sql`(${where})`;
    }

    condition(field: string, op: string, value: unknown): SQL {
        this.conditions += 1;
        if (this.conditions > QUERY_LIMITS.conditions)
            return refuse(`at most ${QUERY_LIMITS.conditions} conditions per query`);
        const spec = this.spec(field);
        if (!(OPS_BY_KIND[spec.kind] as readonly string[]).includes(op))
            return refuse(`"${op}" is not valid for the ${spec.kind} field "${field}"`);
        if (op === 'empty') return sql`(${this.isEmpty(spec)})`;
        if (op === 'notempty') return sql`(not ${this.isEmpty(spec)})`;
        const { kind } = spec;

        if (kind === 'date' || kind === 'datetime') return this.dateClause(spec, op, value);
        if (kind === 'number') return this.numberClause(spec, op, value);

        if (kind === 'boolean') {
            if (typeof value !== 'boolean') return refuse('true or false is required');
            return spec.indexed
                ? this.indexed(spec, sql`${submissionValues.valueBool} = ${value}`)
                : this.holds(spec, value);
        }

        if (kind === 'person' || kind === 'unit') {
            const column = spec.column ?? this.text(spec);
            if (op === 'eq') return sql`${column} = ${asUuid(value)}::uuid`;
            const ids = sql.join(
                asList(value).map((v) => sql`${asUuid(v)}::uuid`),
                sql`, `
            );
            return op === 'in' ? sql`${column} in (${ids})` : sql`(${column} is null or ${column} not in (${ids}))`;
        }

        if (kind === 'multi') {
            // a choice is compared as text (2 and "2" alike, as the value table folds it); a long one is not indexed
            const has = (v: unknown) => {
                const t = asText(v);
                return spec.indexed && t.length <= MAX_INDEXED_TEXT
                    ? this.indexed(spec, sql`${submissionValues.valueText} = ${t}`)
                    : sql`exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(${this.node(spec)}) = 'array'
                          then ${this.node(spec)} end) e where e = ${t})`;
            };
            if (op === 'has') return has(value);
            return sql`(${sql.join(asList(value).map(has), sql` or `)})`;
        }

        // text and choice
        const col = this.text(spec);
        const short = (v: string) => spec.indexed && v.length <= MAX_INDEXED_TEXT;
        if (op === 'eq') {
            // as text, on both paths: an option whose value is the number 2 matches "2"
            const v = asText(value);
            return short(v) ? this.indexed(spec, sql`${submissionValues.valueText} = ${v}`) : sql`${col} = ${v}`;
        }
        if (op === 'in') {
            const list = asList(value).map(asText);
            if (list.every(short))
                return this.indexed(
                    spec,
                    sql`${submissionValues.valueText} in (${sql.join(
                        list.map((v) => sql`${v}`),
                        sql`, `
                    )})`
                );
            return sql`${col} in (${sql.join(
                list.map((v) => sql`${v}`),
                sql`, `
            )})`;
        }
        if (op === 'ne') return sql`(${col} is null or ${col} <> ${asText(value)})`;
        if (op === 'nin')
            return sql`(${col} is null or ${col} not in (${sql.join(
                asList(value).map((v) => sql`${asText(v)}`),
                sql`, `
            )}))`;
        const needle = likeEscape(asText(value).toLowerCase());
        if (op === 'starts') return sql`lower(${col}) like ${`${needle}%`}`;
        if (op === 'ncontains') return sql`(${col} is null or lower(${col}) not like ${`%${needle}%`})`;
        return sql`lower(${col}) like ${`%${needle}%`}`;
    }

    group(node: QueryGroup | { field: string; op: string; value?: unknown }, depth = 0): SQL {
        if (depth > QUERY_LIMITS.depth) return refuse(`filters nest at most ${QUERY_LIMITS.depth} levels`);
        if ('items' in node) {
            const parts = node.items.map((i) => this.group(i, depth + 1));
            if (parts.length === 0) return sql`true`;
            return sql`(${sql.join(parts, node.op === 'or' ? sql` or ` : sql` and `)})`;
        }
        return this.condition(node.field, node.op, node.value);
    }

    search(term: string | undefined): SQL | undefined {
        const t = (term ?? '').trim();
        if (!t) return undefined;
        const needle = `%${likeEscape(t.toLowerCase())}%`;
        const fields = [...this.specs.values()].filter((s) => !s.column && SEARCHABLE.has(s.kind)).slice(0, 25);
        if (fields.length === 0) return undefined;
        return sql`(${sql.join(
            fields.map((s) => sql`lower(${this.text(s)}) like ${needle}`),
            sql` or `
        )})`;
    }

    // ---- ordering, grouping, aggregates ----

    orderBy(sort: readonly { field: string; desc: boolean }[]): SQL[] {
        return sort.map(({ field, desc }) => {
            const spec = this.spec(field);
            if (!SORTABLE.has(spec.kind)) return refuse(`cannot sort by "${field}"`);
            // missing values last, whatever the direction
            return desc ? sql`${this.value(spec)} desc nulls last` : sql`${this.value(spec)} asc nulls last`;
        });
    }

    groupExpr(field: string, bucket?: keyof typeof BUCKETS): SQL {
        const spec = this.spec(field);
        if (!GROUPABLE.has(spec.kind)) return refuse(`cannot group by "${field}"`);
        if (spec.kind === 'date' || spec.kind === 'datetime') {
            const width = BUCKETS[bucket ?? 'month'];
            const day = spec.column
                ? sql`to_char(${spec.column} at time zone ${TZ}, 'YYYY-MM-DD')`
                : spec.kind === 'datetime'
                  ? sql`to_char(${this.instant(spec)} at time zone ${TZ}, 'YYYY-MM-DD')`
                  : this.dateText(spec);
            return sql`substr(${day}, 1, ${width}::int)`;
        }
        if (spec.column) return sql`(${spec.column})::text`;
        return spec.kind === 'boolean' ? sql`(${this.boolean(spec)})::text` : this.text(spec);
    }

    aggregate(fn: 'count' | 'sum' | 'avg' | 'min' | 'max', field: string | undefined): SQL {
        if (fn === 'count') return sql`count(*)`;
        if (!field) return refuse(`"${fn}" needs a field`);
        const spec = this.spec(field);
        if (!AGGREGATABLE.has(spec.kind)) return refuse(`cannot aggregate "${field}"`);
        const col = this.number(spec);
        return { sum: sql`sum(${col})`, avg: sql`avg(${col})`, min: sql`min(${col})`, max: sql`max(${col})` }[fn];
    }

    facetExpr(field: string): SQL {
        const spec = this.spec(field);
        if (!FACETABLE.has(spec.kind)) return refuse(`cannot count the values of "${field}"`);
        return this.groupExpr(field);
    }
}
