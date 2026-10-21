import * as React from 'react';

import { cn } from '../lib/utils';

export interface PrintLayoutProps extends Omit<React.ComponentProps<'article'>, 'title'> {
    /** The bureau's letterhead: logo and name from its branding. */
    letterhead: React.ReactNode;
    title: React.ReactNode;
    /** The document's number, date and issuing unit. */
    meta?: React.ReactNode;
    /** The verification QR code. */
    qr?: React.ReactNode;
    /** Signatures, stamp area, page note. */
    footer?: React.ReactNode;
}

/**
 * An A4 document: application copy, receipt, report. It has no interactive parts and prints as it shows. The PDF worker
 * renders the same layout with the same tokens (task 0.23), so the screen copy and the PDF match.
 */
export function PrintLayout({ letterhead, title, meta, qr, footer, children, className, ...props }: PrintLayoutProps) {
    return (
        <article
            data-slot="print-layout"
            className={cn(
                'mx-auto flex min-h-[297mm] w-full max-w-[210mm] flex-col gap-6 bg-background p-[15mm] text-foreground shadow-sm',
                'print:min-h-0 print:max-w-none print:p-0 print:shadow-none',
                className
            )}
            {...props}
        >
            <header className="flex items-start justify-between gap-6 border-b pb-4">
                <div className="min-w-0 flex-1">{letterhead}</div>
                {qr && <div className="shrink-0">{qr}</div>}
            </header>
            <div className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold">{title}</h1>
                {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
            </div>
            <div className="flex-1">{children}</div>
            {footer && <footer className="border-t pt-4 text-sm">{footer}</footer>}
        </article>
    );
}
