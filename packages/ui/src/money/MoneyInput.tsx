'use client';

import * as React from 'react';

import { Input } from '../primitives/input';
import { cn } from '../lib/utils';
import { formatBirr, isGroupingInProgress, parseBirr, stripCurrency } from './money';

export interface MoneyInputProps extends Omit<
    React.ComponentProps<'input'>,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> {
    /** Santim (1 Birr = 100 santim); null when empty. */
    value: bigint | null;
    onValueChange: (santim: bigint | null) => void;
    /** The currency word shown after the amount, in the user's language ("ብር", "Birr"). */
    unit?: string;
    allowNegative?: boolean;
}

/**
 * What the text means: santim, null (empty, or grouping still being typed), or undefined when it is not an amount (a
 * third decimal, a letter, a negative amount where none is allowed).
 */
function readText(text: string, allowNegative: boolean): bigint | null | undefined {
    if (isGroupingInProgress(text)) return null;
    const read = parseBirr(text, { allowNegative });
    return read.ok ? read.santim : undefined;
}

/**
 * An amount in Birr, held as santim. The user types Birr ("1250.5"); a keystroke that would not make an amount (a third
 * decimal, a letter) is refused, so the field never shows a value it can't report. Thousands grouping being typed
 * ("1,25") reads as no value and marks the field invalid until it is complete, so a decimal comma ("12,50") is never read
 * as 1,250. A paste drops a currency word ("ETB 1,250.50"). On blur the text is tidied to "1,250.50". `onValueChange`
 * only ever receives a bigint or null.
 */
export function MoneyInput({
    value,
    onValueChange,
    unit = 'ETB',
    allowNegative = false,
    className,
    onBlur,
    ...props
}: MoneyInputProps) {
    const [text, setText] = React.useState(() => (value === null ? '' : formatBirr(value)));
    const unitId = React.useId();

    // A new value from outside (a reset, a loaded record) replaces the text; the user's own typing is left as typed. A
    // value the text can't express (negative while negatives are refused, too many digits) is shown as it is: comparing
    // with the formatted text stops the update after one render.
    const formatted = value === null ? '' : formatBirr(value);
    if (text !== formatted && readText(text, allowNegative) !== value) setText(formatted);

    const accept = (next: string) => {
        const santim = readText(next, allowNegative);
        if (santim === undefined) return;
        setText(next);
        if (santim !== value) onValueChange(santim);
    };
    const pending = text !== '' && isGroupingInProgress(text);

    return (
        <div className={cn('relative flex w-full items-center', className)}>
            <Input
                {...props}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-describedby={[props['aria-describedby'], unitId].filter(Boolean).join(' ')}
                aria-invalid={props['aria-invalid'] ?? (pending || undefined)}
                className="pe-14 text-end tabular-nums"
                value={text}
                onChange={(e) => accept(e.target.value)}
                onPaste={(e) => {
                    props.onPaste?.(e);
                    const pasted = e.clipboardData.getData('text');
                    const stripped = stripCurrency(pasted);
                    if (stripped === pasted || e.defaultPrevented) return;
                    e.preventDefault();
                    const { selectionStart, selectionEnd, value: current } = e.currentTarget;
                    const start = selectionStart ?? current.length;
                    accept(current.slice(0, start) + stripped + current.slice(selectionEnd ?? start));
                }}
                onBlur={(e) => {
                    if (value !== null) setText(formatted);
                    onBlur?.(e);
                }}
            />
            {/* full foreground: the unit is information, and the input's own tint sits on whatever surface holds it */}
            <span id={unitId} className="pointer-events-none absolute end-3 text-sm text-foreground">
                {unit}
            </span>
        </div>
    );
}

export interface MoneyTextProps extends React.ComponentProps<'span'> {
    santim: bigint;
    unit?: string;
}

/** An amount for reading: "1,250.50 ብር", with tabular digits so columns of amounts line up. */
export function MoneyText({ santim, unit = 'ETB', className, ...props }: MoneyTextProps) {
    return (
        <span className={cn('tabular-nums', className)} {...props}>
            {formatBirr(santim)} {unit}
        </span>
    );
}
