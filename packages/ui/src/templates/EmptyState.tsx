import { Inbox, SearchX, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils';

const ICON = { empty: Inbox, 'no-results': SearchX, error: TriangleAlert } as const;

export interface EmptyStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
    /** `empty`: nothing exists yet; `no-results`: the filters hide everything; `error`: the list could not load. */
    variant?: keyof typeof ICON;
    title: React.ReactNode;
    /** Why the list is empty and what to do next (design-system.md §9). */
    description?: React.ReactNode;
    /** The next step: create the first record, clear the filters, try again. */
    action?: React.ReactNode;
    icon?: React.ReactNode;
}

export function EmptyState({
    variant = 'empty',
    title,
    description,
    action,
    icon,
    className,
    ...props
}: EmptyStateProps) {
    const Icon = ICON[variant];
    return (
        <div
            data-slot="empty-state"
            role={variant === 'error' ? 'alert' : undefined}
            className={cn(
                'flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center',
                className
            )}
            {...props}
        >
            <span
                className={cn(
                    'flex size-12 items-center justify-center rounded-full bg-muted',
                    variant === 'error' ? 'text-destructive' : 'text-muted-foreground'
                )}
                aria-hidden
            >
                {icon ?? <Icon className="size-6" />}
            </span>
            <p className="text-lg font-medium">{title}</p>
            {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
            {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
        </div>
    );
}
