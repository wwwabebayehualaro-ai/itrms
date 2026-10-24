/**
 * The value table's rows of a submission (ADR-0035): the typed values of its form's filterable fields, as the query
 * compiler compares them. A value of the wrong type has no row (the compiler then finds nothing, as on the answers).
 * A row is written only when the field is of the kind the form's published version compares it as: a field whose kind
 * changed between versions is never mixed in one index.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import type { EngineField } from '@itrms/form-engine/core';

import { submissionValues } from './forms.table';
import { MAX_INDEXED_CHOICES, MAX_INDEXED_TEXT, valueFields, type Kind } from './view-fields';

type ValueRow = typeof submissionValues.$inferInsert;
export interface Owner {
    submissionId: string;
    formId: string;
    regionId: string;
    handlingUnitId: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
/** An instant as the engine writes one (`toISOString()`), or with an explicit offset: nothing the server's zone decides. */
export const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

function day(v: unknown): string | null {
    const m = typeof v === 'string' ? DAY.exec(v) : null;
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

function instant(v: unknown): Date | null {
    if (typeof v !== 'string' || !INSTANT.test(v) || !day(v)) return null;
    const at = new Date(v);
    return Number.isNaN(at.getTime()) ? null : at;
}

const text = (v: unknown): string | null =>
    (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) && String(v).length <= MAX_INDEXED_TEXT
        ? String(v)
        : null;

export interface ValueRows {
    rows: ValueRow[];
    /** keys whose answer holds more choices than one index may (MAX_INDEXED_CHOICES): no row is written for them */
    overflow: string[];
}

/**
 * The rows of the keys in `kinds` (filterable fields, with the kind the published version compares each as) for one
 * submission, read with `fields`: the submission's own version, without its restricted fields (`fieldsFor(doc, [])`).
 */
export function valueRows(
    fields: EngineField[],
    kinds: ReadonlyMap<string, Kind>,
    answers: Record<string, unknown>,
    owner: Owner
): ValueRows {
    const rows: ValueRow[] = [];
    const overflow: string[] = [];
    const add = (fieldKey: string, ordinal: number, value: Partial<ValueRow>) =>
        rows.push({ ...owner, fieldKey, ordinal, ...value });
    for (const f of valueFields(fields)) {
        if (kinds.get(f.key) !== f.kind || !Object.hasOwn(answers, f.key)) continue;
        const v = answers[f.key];
        switch (f.kind) {
            case 'text':
            case 'choice': {
                const t = text(v);
                if (t !== null) add(f.key, 0, { valueText: t });
                break;
            }
            case 'multi': {
                const choices = Array.isArray(v)
                    ? [...new Set(v.map(text).filter((t): t is string => t !== null))]
                    : [];
                if (choices.length > MAX_INDEXED_CHOICES) overflow.push(f.key);
                else choices.forEach((t, i) => add(f.key, i, { valueText: t }));
                break;
            }
            case 'number':
                if (typeof v === 'number' && Number.isFinite(v)) add(f.key, 0, { valueNum: v });
                break;
            case 'date': {
                const d = day(v);
                if (d) add(f.key, 0, { valueDate: d });
                break;
            }
            case 'datetime': {
                const at = instant(v);
                if (at) add(f.key, 0, { valueTs: at });
                break;
            }
            case 'boolean':
                if (typeof v === 'boolean') add(f.key, 0, { valueBool: v });
                break;
            default:
                break;
        }
    }
    return { rows, overflow };
}

export async function writeValues(tx: Tx, rows: ValueRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(submissionValues).values(rows.slice(i, i + 1000));
}

/** Removes the rows of `keys` for these submissions (the fill writes them again from the answers). */
export async function clearValues(
    tx: Tx,
    formId: string,
    keys: readonly string[],
    ids: readonly string[]
): Promise<void> {
    if (keys.length === 0 || ids.length === 0) return;
    await tx.execute(
        sql`delete from forms.submission_values where form_id = ${formId}::uuid
              and field_key = any(${`{${keys.join(',')}}`}::text[]) and submission_id = any(${`{${ids.join(',')}}`}::uuid[])`
    );
}

export interface FillRow extends Record<string, unknown> {
    id: string;
    form_version_id: string;
    region_id: string;
    handling_unit_id: string;
    /** only the answers of the keys asked for */
    answers: Record<string, unknown>;
}

/**
 * The submissions of a form after `after` (by id), a batch at a time, with only the answers of `keys`: a fill never
 * holds whole documents. `since` limits them to those made from then on (the fill's last sweep).
 */
export const nextBatch = (
    tx: Tx,
    formId: string,
    keys: readonly string[],
    options: { after: string | null; size: number; since?: Date }
) =>
    tx.execute<FillRow>(
        sql`select id, form_version_id, region_id, handling_unit_id,
                   (select coalesce(jsonb_object_agg(k, answers -> k), '{}'::jsonb)
                      from unnest(${`{${keys.join(',')}}`}::text[]) k where answers ? k) as answers
              from forms.submissions
             where form_id = ${formId}::uuid
               and (${options.after}::uuid is null or id > ${options.after}::uuid)
               and (${options.since ?? null}::timestamptz is null or created_at >= ${options.since ?? null}::timestamptz)
             order by id limit ${options.size}::int`
    );

/**
 * Submissions of a form and the fill that completes its keys exclude each other: a submission holds the form's lock
 * shared for its transaction, the fill's last step exclusively, so no submission is still in flight when it sweeps.
 */
export const lockFormShared = (tx: Tx, formId: string) =>
    tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`forms.values:${formId}`}, 0))`);
export const lockFormExclusive = (tx: Tx, formId: string) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`forms.values:${formId}`}, 0))`);
