'use client';

import { Badge } from '../primitives/badge';
import { cn } from '../lib/utils';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
    neutral: 'text-muted-foreground',
    info: 'bg-primary/10 text-foreground border-primary/30',
    success: 'bg-success/15 text-foreground border-success/40',
    warning: 'bg-warning/15 text-foreground border-warning/40',
    danger: 'bg-destructive/10 text-destructive border-destructive/30'
};

/** Tone of the usual workflow words (submitted, processing, completed, approved, rejected, ...). */
const KNOWN: Record<string, Tone> = {
    submitted: 'info',
    pending: 'warning',
    processing: 'warning',
    pending_approval: 'warning',
    completed: 'success',
    approved: 'success',
    published: 'success',
    failed: 'danger',
    rejected: 'danger'
};
export const toneOf = (value: string | null | undefined): Tone => KNOWN[String(value ?? '').toLowerCase()] ?? 'neutral';

/** A status as a small coloured badge; the text is the status in words ("pending_approval" reads "pending approval"). */
export function StatusBadge({ value, label, tone, className }: { value?: string | null; label?: string; tone?: Tone; className?: string }) {
    if (!value && !label) return null;
    const t = tone ?? toneOf(value);
    return (
        <Badge variant="outline" data-status={value ?? undefined} className={cn(TONE[t], className)}>
            {label ?? String(value).replace(/[_-]+/g, ' ')}
        </Badge>
    );
}
