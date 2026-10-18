'use client';

import { Badge, cn } from '@platform/ui';
import { IFormTemplate } from '@/types/template_builder/form';

const LOOK = {
    published: { label: 'Published', className: 'bg-success/15 border-success/40 text-foreground' },
    pending_approval: { label: 'Waiting for approval', className: 'bg-warning/15 border-warning/40 text-foreground' },
    draft: { label: 'Draft', className: 'text-muted-foreground' }
} as const;

/** Publish state of a template. A draft that was published before reads "Unpublished changes" (people fill in the older version). */
export function TemplateStatusTag({ template, className }: { template: Pick<IFormTemplate, 'status' | 'published_version_id'>; className?: string }) {
    const status = template.status ?? 'published';
    const look = LOOK[status];
    const label = status === 'draft' && template.published_version_id ? 'Unpublished changes' : look.label;
    return (
        <Badge variant="outline" data-template-status={status} className={cn(look.className, className)}>
            {label}
        </Badge>
    );
}
