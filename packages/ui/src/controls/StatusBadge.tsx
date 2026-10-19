'use client';

import type { LucideIcon } from 'lucide-react';
import { CircleCheck, CircleDashed, CircleDot, CircleMinus, Clock, OctagonX, TriangleAlert } from 'lucide-react';

import { Badge } from '../primitives/badge';
import { cn } from '../lib/utils';
import type { StatusTone } from '../tokens/tokens';

/** The shared status vocabulary (design-system.md §6). A module maps its own states onto these seven tones. */
export type Tone = StatusTone;

// Literal class names, so Tailwind finds them. Text uses the -fg token on the soft -bg fill (4.5:1) and the icon the solid
// tone colour (3:1); the half-strength border is decoration. The tone never depends on colour alone: the icon and the words
// carry it too.
const TONE: Record<Tone, { className: string; Icon: LucideIcon }> = {
    neutral: {
        className: 'border-status-neutral/50 bg-status-neutral-bg text-status-neutral-fg [&>svg]:text-status-neutral',
        Icon: CircleDashed
    },
    info: {
        className: 'border-status-info/50 bg-status-info-bg text-status-info-fg [&>svg]:text-status-info',
        Icon: Clock
    },
    progress: {
        className:
            'border-status-progress/50 bg-status-progress-bg text-status-progress-fg [&>svg]:text-status-progress',
        Icon: CircleDot
    },
    success: {
        className: 'border-status-success/50 bg-status-success-bg text-status-success-fg [&>svg]:text-status-success',
        Icon: CircleCheck
    },
    warning: {
        className: 'border-status-warning/50 bg-status-warning-bg text-status-warning-fg [&>svg]:text-status-warning',
        Icon: TriangleAlert
    },
    danger: {
        className: 'border-status-danger/50 bg-status-danger-bg text-status-danger-fg [&>svg]:text-status-danger',
        Icon: OctagonX
    },
    muted: {
        className: 'border-status-muted/50 bg-status-muted-bg text-status-muted-fg [&>svg]:text-status-muted',
        Icon: CircleMinus
    }
};

/** Tone of the usual workflow words; anything else is neutral. Modules pass `tone` for their own states. */
const KNOWN: Record<string, Tone> = {
    draft: 'neutral',
    not_started: 'neutral',
    submitted: 'info',
    pending: 'info',
    pending_approval: 'info',
    in_review: 'info',
    waiting: 'info',
    processing: 'progress',
    in_progress: 'progress',
    scheduled: 'progress',
    completed: 'success',
    approved: 'success',
    published: 'success',
    issued: 'success',
    paid: 'success',
    valid: 'success',
    returned: 'warning',
    due_soon: 'warning',
    expiring: 'warning',
    failed: 'danger',
    rejected: 'danger',
    overdue: 'danger',
    revoked: 'danger',
    infected: 'danger',
    cancelled: 'muted',
    superseded: 'muted',
    archived: 'muted'
};
export const toneOf = (value: string | null | undefined): Tone =>
    KNOWN[
        String(value ?? '')
            .toLowerCase()
            .replace(/[\s-]+/g, '_')
    ] ?? 'neutral';

/** A status as a badge: an icon and the status in words ("pending_approval" reads "pending approval"). */
export function StatusBadge({
    value,
    label,
    tone,
    className
}: {
    value?: string | null;
    label?: string;
    tone?: Tone;
    className?: string;
}) {
    if (!value && !label) return null;
    const t = tone ?? toneOf(value);
    const { className: toneClass, Icon } = TONE[t];
    return (
        <Badge variant="outline" data-status={value ?? undefined} data-tone={t} className={cn(toneClass, className)}>
            <Icon aria-hidden="true" />
            {label ?? String(value).replace(/[_-]+/g, ' ')}
        </Badge>
    );
}
