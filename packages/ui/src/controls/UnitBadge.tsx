import { Building2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils';

export interface UnitBadgeProps extends Omit<React.ComponentProps<'span'>, 'children'> {
    /** The unit's name ("Sodo Zuria"). */
    name: string;
    /** What kind of office it is, in the reader's language ("Woreda office", "Zone department"). */
    kind: string;
    /** Its grade or category where the region uses one ("ምድብ 1", "ፈርጅ 2"). */
    grade?: string;
    icon?: React.ReactNode;
}

/**
 * An org unit with its kind and grade. It only shows what the caller passes: code decides by services and capabilities,
 * never by unit kind (ADR-0026), so the badge takes words, not unit-type keys.
 */
export function UnitBadge({ name, kind, grade, icon, className, ...props }: UnitBadgeProps) {
    return (
        <span
            data-slot="unit-badge"
            className={cn(
                'inline-flex max-w-full items-start gap-1.5 rounded-md border bg-card px-2 py-1 text-sm',
                className
            )}
            {...props}
        >
            <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
                {icon ?? <Building2 className="size-4" />}
            </span>
            <span className="min-w-0">
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">
                    {' · '}
                    {kind}
                    {grade && ` · ${grade}`}
                </span>
            </span>
        </span>
    );
}
