import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils';
import { Skeleton } from '../primitives/skeleton';

export interface KpiDelta {
    /** The change in words, already formatted ("+12 this month"). */
    text: string;
    direction: 'up' | 'down' | 'flat';
    /** Whether the change is good news; rising overdue cases are bad, rising issued licences good. */
    sentiment?: 'good' | 'bad' | 'neutral';
}

export interface KpiTileProps extends Omit<React.ComponentProps<'div'>, 'children'> {
    label: React.ReactNode;
    /** The figure, already formatted (a count, `<MoneyText>`, a duration). */
    value: React.ReactNode;
    delta?: KpiDelta;
    hint?: React.ReactNode;
    /** A link to the list behind the number. */
    action?: React.ReactNode;
    loading?: boolean;
}

const ARROW = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;
const SENTIMENT = {
    good: 'text-status-success-fg',
    bad: 'text-status-danger-fg',
    neutral: 'text-muted-foreground'
} as const;

/** One headline number with its change. The direction shows as an arrow and words, not colour alone. */
export function KpiTile({ label, value, delta, hint, action, loading, className, ...props }: KpiTileProps) {
    const Arrow = delta && ARROW[delta.direction];
    return (
        <div
            data-slot="kpi-tile"
            aria-busy={loading || undefined}
            className={cn('flex flex-col gap-1 rounded-lg border bg-card p-4 text-card-foreground', className)}
            {...props}
        >
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading ? (
                <Skeleton className="my-1 h-8 w-24" />
            ) : (
                <p className="text-3xl font-semibold tabular-nums">{value}</p>
            )}
            {delta && Arrow && !loading && (
                <p className={cn('flex items-center gap-1 text-sm', SENTIMENT[delta.sentiment ?? 'neutral'])}>
                    <Arrow className="size-4 shrink-0" aria-hidden />
                    {delta.text}
                </p>
            )}
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
            {action && <div className="mt-1 text-sm">{action}</div>}
        </div>
    );
}
