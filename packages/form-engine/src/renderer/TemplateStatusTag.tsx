'use client';

import { StatusBadge, type Tone } from '@itrms/ui';
import type { FormTemplate } from '@itrms/schemas';
import type { EngineMessageKey } from '../core/messages';
import { useEngineText } from '../host/text';

// The shared status vocabulary (design-system.md §6).
const LOOK: Record<'published' | 'pending_approval' | 'draft', { label: EngineMessageKey; tone: Tone }> = {
    published: { label: 'form-engine.renderer.status.published', tone: 'success' },
    pending_approval: { label: 'form-engine.renderer.status.pending', tone: 'info' },
    draft: { label: 'form-engine.renderer.status.draft', tone: 'neutral' }
};

/** Publish state of a template. A draft that was published before reads "Unpublished changes" (people fill in the older version). */
export function TemplateStatusTag({
    template,
    className
}: {
    template: Pick<FormTemplate, 'status' | 'published_version_id'>;
    className?: string;
}) {
    const { t } = useEngineText();
    const status = template.status ?? 'published';
    const unpublished = status === 'draft' && !!template.published_version_id;
    const look = LOOK[status];
    return (
        <StatusBadge
            value={status}
            label={t(unpublished ? 'form-engine.renderer.status.unpublished' : look.label)}
            tone={unpublished ? 'warning' : look.tone}
            className={className}
        />
    );
}
