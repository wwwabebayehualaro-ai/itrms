'use client';

import { StatusBadge, type Tone } from '@itrms/ui';
import type { FormTemplate } from '@itrms/schemas';

// The shared status vocabulary (design-system.md §6).
const LOOK: Record<'published' | 'pending_approval' | 'draft', { label: string; tone: Tone }> = {
    published: { label: 'Published', tone: 'success' },
    pending_approval: { label: 'Waiting for approval', tone: 'info' },
    draft: { label: 'Draft', tone: 'neutral' }
};

/** Publish state of a template. A draft that was published before reads "Unpublished changes" (people fill in the older version). */
export function TemplateStatusTag({
    template,
    className
}: {
    template: Pick<FormTemplate, 'status' | 'published_version_id'>;
    className?: string;
}) {
    const status = template.status ?? 'published';
    const unpublished = status === 'draft' && !!template.published_version_id;
    const look = LOOK[status];
    return (
        <StatusBadge
            value={status}
            label={unpublished ? 'Unpublished changes' : look.label}
            tone={unpublished ? 'warning' : look.tone}
            className={className}
        />
    );
}
