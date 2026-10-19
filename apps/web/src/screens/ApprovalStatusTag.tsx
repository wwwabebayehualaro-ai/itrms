'use client';

import type { ApprovalStatus } from '@/lib/approval';
import { StatusBadge, type Tone } from '@itrms/ui';

// The shared status vocabulary (design-system.md §6): waiting is info, withdrawn is muted.
const LOOK: Record<ApprovalStatus, { label: string; tone: Tone }> = {
    pending: { label: 'Waiting', tone: 'info' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'danger' },
    cancelled: { label: 'Withdrawn', tone: 'muted' }
};

export function ApprovalStatusTag({ status, className }: { status: ApprovalStatus; className?: string }) {
    const look = LOOK[status];
    return <StatusBadge value={status} label={look.label} tone={look.tone} className={className} />;
}
