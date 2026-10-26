'use client';

import type { ReactNode } from 'react';
import { formatDateTime } from '../host/format';
import type { Labeler } from './labels';
import { EMPTY } from './labels';
import type { ViewField, ViewRow, ViewSchema } from './types';

/** The value of a field in a result row (a form's fields live in submission_data, built-ins on the row). */
export function valueOf(row: ViewRow, key: string): unknown {
    if (key === 'submitted_by') return row.submitted_by_name ?? row.submitted_by;
    if (key === 'handling_unit') return row.handling_unit_name ?? row.handling_unit;
    return key === 'created_at' || key === 'updated_at' ? row[key] : (row.submission_data as any)?.[key];
}

/** Built-ins whose row value is already the name people read. */
const NAMED = new Set(['submitted_by', 'handling_unit']);

/** Text of a field of a row, ready to read. */
export const textOf = (row: ViewRow, f: ViewField | undefined, labeler: Labeler) =>
    f ? (NAMED.has(f.key) ? String(valueOf(row, f.key) ?? EMPTY) : labeler.text(f.key, valueOf(row, f.key))) : EMPTY;

const FACT_KINDS = new Set(['text', 'choice', 'number', 'date', 'datetime', 'boolean', 'person', 'multi']);

/** The few most telling fields of a request besides its title: used on cards and board cards. */
export function factFields(schema: ViewSchema, count: number): ViewField[] {
    const skip = new Set([schema.roles.title, schema.roles.subtitle, schema.roles.stage]);
    const own = schema.fields.filter((f) => !f.builtin && FACT_KINDS.has(f.kind) && !skip.has(f.key));
    // numbers (the amounts) and dates first: they are what people scan for
    const rank = (f: ViewField) => (f.kind === 'number' ? 0 : f.kind === 'date' || f.kind === 'datetime' ? 1 : 2);
    return [...own].sort((a, b) => rank(a) - rank(b)).slice(0, count);
}

export function titleOf(row: ViewRow, schema: ViewSchema, labeler: Labeler): string {
    const t = schema.roles.title ? labeler.text(schema.roles.title, valueOf(row, schema.roles.title)) : EMPTY;
    return t && t !== EMPTY ? t : labeler.t('form-engine.viewer.record.untitled', { id: String(row.id).slice(0, 8) });
}

/** An empty result, said in a box where the content would be. */
export function EmptyBox({ children }: { children: ReactNode }) {
    return (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>
    );
}

interface RecordCardProps {
    row: ViewRow;
    schema: ViewSchema;
    labeler: Labeler;
    onOpen: (row: ViewRow) => void;
    actions?: ReactNode;
    facts?: number;
}

/** One request as a card: title, subtitle, status, the key facts, who and when. Used by Cards, Board and Calendar. */
export function RecordCard({ row, schema, labeler, onOpen, actions, facts = 3 }: RecordCardProps) {
    const sub = schema.roles.subtitle ? schema.fields.find((f) => f.key === schema.roles.subtitle) : undefined;
    return (
        <div
            className="flex h-full flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs"
            data-record={row.id}
        >
            <div className="flex items-start justify-between gap-2">
                <button
                    type="button"
                    data-open
                    className="text-left font-semibold [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:outline-none"
                    onClick={() => onOpen(row)}
                >
                    {titleOf(row, schema, labeler)}
                </button>
            </div>
            {sub && <span className="text-sm text-muted-foreground">{textOf(row, sub, labeler)}</span>}
            <dl className="m-0 grid gap-1 text-sm">
                {factFields(schema, facts).map((f) => (
                    <div key={f.key} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{f.label}</dt>
                        <dd className="m-0 text-right [overflow-wrap:anywhere]">{textOf(row, f, labeler)}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                <span>
                    {row.submitted_by_name ?? ''} · {formatDateTime(row.created_at)}
                </span>
                {actions && <span className="flex">{actions}</span>}
            </div>
        </div>
    );
}
