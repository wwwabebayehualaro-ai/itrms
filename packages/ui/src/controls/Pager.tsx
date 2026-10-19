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
    className?: string;
}

/** Paging for server-driven lists: "1–20 of 45", rows per page, first / previous / next / last. */
export function Pager({ page, pageSize, total, pageSizes = [10, 20, 50], onChange, noun, className }: PagerProps) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    const sizes = pageSizes.includes(pageSize) ? pageSizes : [...pageSizes, pageSize].sort((a, b) => a - b);
    const go = (p: number) => onChange({ page: Math.min(Math.max(1, p), pages), pageSize });
    return (
        <nav className={cn('flex flex-wrap items-center justify-between gap-3', className)} aria-label="Pages">
            <span className="text-sm text-muted-foreground" aria-live="polite">
                {total === 0 ? `0 ${noun ?? 'records'}` : `${from}–${to} of ${total}${noun ? ` ${noun}` : ''}`}
            </span>
            <div className="flex items-center gap-1">
                <Select value={String(pageSize)} onValueChange={(v) => onChange({ page: 1, pageSize: Number(v) })}>
                    <SelectTrigger size="sm" aria-label="Rows per page" className="mr-2">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {sizes.map((s) => (
                            <SelectItem key={s} value={String(s)}>
                                {s} / page
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
                    aria-label="First page"
                >
                    <ChevronsLeft />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(page - 1)}
                    disabled={page <= 1}
                    aria-label="Previous page"
                >
                    <ChevronLeft />
                </Button>
                <span className="px-2 text-sm tabular-nums">
                    Page {total === 0 ? 0 : page} of {total === 0 ? 0 : pages}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(page + 1)}
                    disabled={page >= pages}
                    aria-label="Next page"
                >
                    <ChevronRight />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => go(pages)}
                    disabled={page >= pages}
                    aria-label="Last page"
                >
                    <ChevronsRight />
                </Button>
            </div>
        </nav>
    );
}
