import React from 'react';
import { Button } from '../primitives/button';
import { Spinner } from '../primitives/spinner';
import { cn } from '../lib/utils';

interface Props {
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    emptyMessage?: string;
    onRetry?: () => void;
    className?: string;
}

/** Compact loading / error / empty line for data-backed controls. Renders nothing when there is nothing to say. */
export function InlineStatus({ loading, error, empty, emptyMessage = 'Nothing to show', onRetry, className }: Props) {
    const base = 'mt-1 flex items-center gap-1.5 text-xs';
    if (loading) {
        return (
            <small className={cn(base, 'text-muted-foreground', className)} role="status">
                <Spinner className="size-3" />
                Loading…
            </small>
        );
    }
    if (error) {
        return (
            <small className={cn(base, 'text-destructive', className)} role="alert">
                {error}
                {onRetry && (
                    <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={onRetry}>
                        Retry
                    </Button>
                )}
            </small>
        );
    }
    if (empty) {
        return (
            <small className={cn(base, 'text-muted-foreground', className)} role="status">
                {emptyMessage}
            </small>
        );
    }
    return null;
}
