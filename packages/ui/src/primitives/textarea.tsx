'use client';

import * as React from 'react';
import { cn } from 'cn';

import { mergeRefs, useEthiopicTyping } from '../ethiopic/useEthiopicTyping';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
    /** Ethiopic typing on from the start (F9 turns it on and off). */
    ethiopic?: boolean;
}

function Textarea({ className, ethiopic = false, ref, ...props }: TextareaProps) {
    const typing = useEthiopicTyping<HTMLTextAreaElement>(true, ethiopic);
    const merged = React.useMemo(() => mergeRefs(ref, typing.ref), [ref, typing.ref]);
    return (
        <textarea
            data-slot="textarea"
            data-ethiopic={typing.on ? 'on' : undefined}
            ref={merged}
            className={cn(
                'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
                'data-[ethiopic=on]:border-dashed data-[ethiopic=on]:border-primary',
                className
            )}
            {...props}
        />
    );
}

export { Textarea };
