'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '../primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select';
import { cn } from '../lib/utils';

export interface PagerProps {
    /** 1-based. */
    page: number;
    pageSize: number;
    total: number;
    pageSizes?: number[];
    onChange: (next: { page: number; pageSize: number }) => void;
    /** What one record is called in "1–20 of 45 <noun>" (default: none). */
    noun?: string;
    /** The pager's words in the person's language (the app's catalogue); English by default. */
    labels?: PagerLabels;
    className?: string;
}

/** `{from}`, `{to}`, `{total}`, `{size}`, `{page}`, `{pages}` and `{noun}` are filled in. */
export interface PagerLabels {
    pages: string;
    /** No records (`{noun}`: the noun or `records`). */
    none: string;
    range: string;
    records: string;
    rowsPerPage: string;
    perPage: string;
    first: string;
    previous: string;
    next: string;
    last: string;
    pageOf: string;
}

const ENGLISH: PagerLabels = {
    pages: 'Pages',
    none: '0 {noun}',
    range: '{from}–{to} of {total}',
    records: 'records',
    rowsPerPage: 'Rows per page',
    perPage: '{size} / page',
    first: 'First page',
    previous: 'Previous page',
    next: 'Next page',
    last: 'Last page',
    pageOf: 'Page {page} of {pages}'
};

const fill = (text: string, values: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in values ? String(values[k]) : m));

/** Paging for server-driven lists: "1–20 of 45", rows per page, first / previous / next / last. */
export function Pager({
    page,
    pageSize,
    total,
    pageSizes = [10, 20, 50],
    onChange,
    noun,
    labels = ENGLISH,
    className
}: PagerProps) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    const sizes = pageSizes.includes(pageSize) ? pageSizes : [...pageSizes, pageSize].sort((a, b) => a - b);
    const go = (p: number) => onChange({ page: Math.min(Math.max(1, p), pages), pageSize });
    return (
        <nav className={cn('flex flex-wrap items-center justify-between gap-3', className)} aria-label={labels.pages}>
            <span className="text-sm text-muted-foreground" aria-live="polite">
                {total === 0
                    ? fill(labels.none, { noun: noun ?? labels.records })
                    : `${fill(labels.range, { from, to, total })}${noun ? ` ${noun}` : ''}`}
            </span>
            <div className="flex items-center gap-1">
                <Select value={String(pageSize)} onValueChange={(v) => onChange({ page: 1, pageSize: Number(v) })}>
                    <SelectTrigger size="sm" aria-label={labels.rowsPerPage} className="mr-2">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {sizes.map((s) => (
                            <SelectItem key={s} value={String(s)}>
                                {fill(labels.perPage, { size: s })}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(1)}
                    disabled={page <= 1}
                    aria-label={labels.first}
                >
                    <ChevronsLeft />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(page - 1)}
                    disabled={page <= 1}
                    aria-label={labels.previous}
                >
                    <ChevronLeft />
                </Button>
                <span className="px-2 text-sm tabular-nums">
                    {fill(labels.pageOf, { page: total === 0 ? 0 : page, pages: total === 0 ? 0 : pages })}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(page + 1)}
                    disabled={page >= pages}
                    aria-label={labels.next}
                >
                    <ChevronRight />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(pages)}
                    disabled={page >= pages}
                    aria-label={labels.last}
                >
                    <ChevronsRight />
                </Button>
            </div>
        </nav>
    );
}
