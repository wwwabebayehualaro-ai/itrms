'use client';

import { ReactNode } from 'react';
import { StatusBadge } from '@itrms/ui';
import { formatDateTime } from '@/lib/format';
import { EMPTY, Labeler } from './labels';
import type { ViewField, ViewRow, ViewSchema } from './types';

export const STATUSES = ['draft', 'submitted', 'processing', 'completed', 'failed'];
export const humanize = (s: string) => s.replace(/[_-]+/g, ' ');

export function StatusTag({ value }: { value?: string | null }) {
    return value ? <StatusBadge value={value} /> : null;
}

/** The value of a field in a result row (template fields live in submission_data, built-ins on the row). */
export function valueOf(row: ViewRow, key: string): unknown {
    if (key === 'submitted_by') return row.submitted_by_name ?? row.submitted_by;
    return key in row && ['status', 'created_at', 'updated_at'].includes(key)
        ? (row as any)[key]
        : (row.submission_data as any)?.[key];
}

/** Text of a field of a row, ready to read. */
export const textOf = (row: ViewRow, f: ViewField | undefined, labeler: Labeler) =>
    f
        ? f.key === 'submitted_by'
            ? String(valueOf(row, f.key) ?? EMPTY)
            : labeler.text(f.key, valueOf(row, f.key))
        : EMPTY;

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
    return t && t !== EMPTY ? t : `Request ${String(row.id).slice(0, 8)}`;
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
    /** Hide the status tag (a board column already says it). */
    hideStatus?: boolean;
}

/** One request as a card: title, subtitle, status, the key facts, who and when. Used by Cards, Board and Calendar. */
export function RecordCard({ row, schema, labeler, onOpen, actions, facts = 3, hideStatus }: RecordCardProps) {
    const sub = schema.roles.subtitle ? schema.fields.find((f) => f.key === schema.roles.subtitle) : undefined;
    return (
        <div
            className="flex h-full flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs"
            data-record={row.id as string}
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
                {!hideStatus && <StatusTag value={row.status} />}
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
