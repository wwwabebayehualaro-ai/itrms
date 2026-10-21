import * as React from 'react';

import { cn } from '../lib/utils';

export interface PageHeaderProps extends Omit<React.ComponentProps<'header'>, 'title'> {
    title: React.ReactNode;
    description?: React.ReactNode;
    /** The trail above the title (the app passes its own links). */
    breadcrumbs?: React.ReactNode;
    /** A status badge beside the title (record and case pages). */
    status?: React.ReactNode;
    /** Key facts under the title: a unit badge, a number, a date. */
    meta?: React.ReactNode;
    /** The page's actions; the primary one last, so it sits at the end of the row. */
    actions?: React.ReactNode;
}

/** The top of every page: one h1, what the page is for, and its actions. Actions wrap under the title on narrow screens. */
export function PageHeader({
    title,
    description,
    breadcrumbs,
    status,
    meta,
    actions,
    className,
    ...props
}: PageHeaderProps) {
    return (
        <header data-slot="page-header" className={cn('flex flex-col gap-2 pb-4', className)} {...props}>
            {breadcrumbs && <nav className="text-sm text-muted-foreground">{breadcrumbs}</nav>}
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h1 className="text-2xl font-semibold">{title}</h1>
                        {status}
                    </div>
                    {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
                    {meta && <div className="flex flex-wrap items-center gap-2 text-sm">{meta}</div>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
        </header>
    );
}
