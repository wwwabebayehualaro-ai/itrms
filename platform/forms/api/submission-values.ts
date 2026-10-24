/**
 * The value table's rows of a submission (ADR-0035): the typed values of its form's filterable fields, as the query
 * compiler compares them. A value of the wrong type has no row (the compiler then finds nothing, as on the answers).
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import type { EngineField } from '@itrms/form-engine/core';

import { submissionValues } from './forms.table';
import { MAX_INDEXED_TEXT, valueFields } from './view-fields';

type ValueRow = typeof submissionValues.$inferInsert;
export interface Owner {
    submissionId: string;
    formId: string;
    regionId: string;
    handlingUnitId: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function day(v: unknown): string | null {
    const m = typeof v === 'string' ? DAY.exec(v) : null;
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

const text = (v: unknown): string | null =>
    (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) && String(v).length <= MAX_INDEXED_TEXT
        ? String(v)
        : null;

/** The rows of `keys` (filterable fields of the submission's form) for one submission. */
export function valueRows(
    fields: EngineField[],
    keys: readonly string[],
    answers: Record<string, unknown>,
    owner: Owner
) {
    const rows: ValueRow[] = [];
    const add = (fieldKey: string, ordinal: number, value: Partial<ValueRow>) =>
        rows.push({ ...owner, fieldKey, ordinal, ...value });
    for (const f of valueFields(fields)) {
        if (!keys.includes(f.key) || !Object.hasOwn(answers, f.key)) continue;
        const v = answers[f.key];
        switch (f.kind) {
            case 'text':
            case 'choice': {
                const t = text(v);
                if (t !== null) add(f.key, 0, { valueText: t });
                break;
            }
            case 'multi':
                if (Array.isArray(v))
                    [...new Set(v.map(text).filter((t): t is string => t !== null))].forEach((t, i) =>
                        add(f.key, i, { valueText: t })
                    );
                break;
            case 'number':
                if (typeof v === 'number' && Number.isFinite(v)) add(f.key, 0, { valueNum: v });
                break;
            case 'date': {
                const d = day(v);
                if (d) add(f.key, 0, { valueDate: d });
                break;
            }
            case 'datetime': {
                const at = typeof v === 'string' && day(v) ? new Date(v) : null;
                if (at && !Number.isNaN(at.getTime())) add(f.key, 0, { valueTs: at });
                break;
            }
            case 'boolean':
                if (typeof v === 'boolean') add(f.key, 0, { valueBool: v });
                break;
            default:
                break;
        }
    }
    return rows;
}

/** Writes the rows (again: a row already there stays as it is). */
export async function writeValues(tx: Tx, rows: ValueRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 1000)
        await tx
            .insert(submissionValues)
            .values(rows.slice(i, i + 1000))
            .onConflictDoNothing({
                target: [submissionValues.submissionId, submissionValues.fieldKey, submissionValues.ordinal]
            });
}

/** The submission ids of a form after `after`, a batch at a time (for the fill). */
export const nextBatch = (tx: Tx, formId: string, after: string | null, size: number) =>
    tx.execute<{ id: string; answers: Record<string, unknown>; region_id: string; handling_unit_id: string }>(
        sql`select id, answers, region_id, handling_unit_id from forms.submissions
             where form_id = ${formId}::uuid and (${after}::uuid is null or id > ${after}::uuid)
             order by id limit ${size}::int`
    );
