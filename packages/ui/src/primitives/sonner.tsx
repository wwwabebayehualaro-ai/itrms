'use client';

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { fonts } from '../tokens/tokens';

const Toaster = ({ ...props }: ToasterProps) => {
    // Sonner knows light and dark only; high contrast is a light theme.
    const { resolvedTheme } = useTheme();

    return (
        <Sonner
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            className="toaster group"
            icons={{
                success: <CircleCheckIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <TriangleAlertIcon className="size-4" />,
                error: <OctagonXIcon className="size-4" />,
                loading: <Loader2Icon className="size-4 animate-spin" />
            }}
            style={
                {
                    // Rich colours come from the status tokens (text on the soft fill is 4.5:1), not from Sonner's own palette.
                    '--success-bg': 'var(--status-success-bg)',
                    '--success-text': 'var(--status-success-fg)',
                    '--success-border': 'var(--status-success)',
                    '--info-bg': 'var(--status-info-bg)',
                    '--info-text': 'var(--status-info-fg)',
                    '--info-border': 'var(--status-info)',
                    '--warning-bg': 'var(--status-warning-bg)',
                    '--warning-text': 'var(--status-warning-fg)',
                    '--warning-border': 'var(--status-warning)',
                    '--error-bg': 'var(--status-danger-bg)',
                    '--error-text': 'var(--status-danger-fg)',
                    '--error-border': 'var(--status-danger)',
                    '--normal-bg': 'var(--popover)',
                    '--normal-text': 'var(--popover-foreground)',
                    '--normal-border': 'var(--border)',
                    '--border-radius': 'var(--radius)',
                    // Sonner's own (unlayered) stylesheet sets a system font stack, which no utility can override; the
                    // toasts must use the self-hosted Noto fonts like the rest of the app (Ethiopic included).
                    fontFamily: fonts.sans
                } as React.CSSProperties
            }
            {...props}
        />
    );
};

export { Toaster };
