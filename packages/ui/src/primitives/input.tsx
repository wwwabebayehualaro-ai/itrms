'use client';

import * as React from 'react';
import { cn } from 'cn';

import { mergeRefs, useEthiopicTyping } from '../ethiopic/useEthiopicTyping';

/** The input types that take free text, where Ethiopic typing (F9) is offered. */
const FREE_TEXT = new Set([undefined, 'text', 'search']);

export interface InputProps extends React.ComponentProps<'input'> {
    /** Ethiopic typing on from the start (F9 turns it on and off in any free-text field). */
    ethiopic?: boolean;
}

function Input({ className, type, ethiopic = false, ref, ...props }: InputProps) {
    const typing = useEthiopicTyping<HTMLInputElement>(FREE_TEXT.has(type), ethiopic);
    const merged = React.useMemo(() => mergeRefs(ref, typing.ref), [ref, typing.ref]);
    return (
        <input
            type={type}
            data-slot="input"
            data-ethiopic={typing.on ? 'on' : undefined}
            ref={merged}
            className={cn(
                'h-(--field-height) w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
                'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
                // Ethiopic typing on: a dashed edge says the keys write Fidel
                'data-[ethiopic=on]:border-dashed data-[ethiopic=on]:border-primary',
                className
            )}
            {...props}
        />
    );
}

export { Input };
