'use client';

import type { ApprovalStatus } from '@/lib/approval';
import { StatusBadge, type Tone } from '@itrms/ui';
import { useText } from '@/lib/preferences';

// The shared status vocabulary (design-system.md §6): waiting is info, withdrawn is muted.
const TONE: Record<ApprovalStatus, Tone> = {
    pending: 'info',
    approved: 'success',
    rejected: 'danger',
    cancelled: 'muted'
};

export function ApprovalStatusTag({ status, className }: { status: ApprovalStatus; className?: string }) {
    const { t } = useText();
    return (
        <StatusBadge
            value={status}
            label={t(`shell.approvals.status.${status}`)}
            tone={TONE[status]}
            className={className}
        />
    );
}
