import * as React from 'react';

import { cn } from '../lib/utils';
import { Skeleton } from '../primitives/skeleton';

export interface WidgetCardProps extends Omit<React.ComponentProps<'section'>, 'title'> {
    title: React.ReactNode;
    description?: React.ReactNode;
    /** A link to the full list the widget summarises (design-system.md §7: every widget links to its list). */
    action?: React.ReactNode;
    footer?: React.ReactNode;
    loading?: boolean;
}

/** One dashboard widget: a titled panel that adapts to its grid cell. */
export function WidgetCard({
    title,
    description,
    action,
    footer,
    loading,
    children,
    className,
    ...props
}: WidgetCardProps) {
    const titleId = React.useId();
    return (
        <section
            data-slot="widget-card"
            aria-labelledby={titleId}
            aria-busy={loading || undefined}
            className={cn(
                '@container flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground',
                className
            )}
            {...props}
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h2 id={titleId} className="text-base font-semibold">
                        {title}
                    </h2>
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
                {action}
            </div>
            <div className="min-w-0 flex-1">
                {loading ? (
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-20 w-full" />
                    </div>
                ) : (
                    children
                )}
            </div>
            {footer && <div className="border-t pt-3 text-sm text-muted-foreground">{footer}</div>}
        </section>
    );
}
