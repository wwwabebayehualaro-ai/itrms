'use client';

import type { ApprovalStatus } from '@platform/lib/approval';
import { Badge } from '../primitives/badge';
import { cn } from '../lib/utils';

const LOOK: Record<ApprovalStatus, { label: string; className: string }> = {
    pending: { label: 'Waiting', className: 'bg-warning/15 text-foreground border-warning/40' },
    approved: { label: 'Approved', className: 'bg-success/15 text-foreground border-success/40' },
    rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive border-destructive/30' },
    cancelled: { label: 'Withdrawn', className: 'text-muted-foreground' }
};

export function ApprovalStatusTag({ status, className }: { status: ApprovalStatus; className?: string }) {
    const look = LOOK[status];
    return (
        <Badge variant="outline" data-status={status} className={cn(look.className, className)}>
            {look.label}
        </Badge>
    );
}
