'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Badge } from '../primitives/badge';
import { Button } from '../primitives/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../primitives/command';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { Spinner } from '../primitives/spinner';
import { cn } from '../lib/utils';

export interface ComboboxOption<V = unknown> {
    value: V;
    label: string;
    disabled?: boolean;
}

interface Common<V> {
    options: ComboboxOption<V>[];
    id?: string;
    placeholder?: string;
    /** Show a search box: always, never, or (default) when there are more than 7 options. */
    searchable?: boolean;
    /** Show a ✕ that empties the selection (only while something is selected). */
    clearable?: boolean;
    /** Accessible name of the ✕ (default "Clear <aria-label>"). */
    clearLabel?: string;
    loading?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    'aria-label'?: string;
    'aria-describedby'?: string;
    emptyMessage?: string;
    className?: string;
    /** Text shown for a single value that is not among the options (e.g. a free-text AutoComplete value). */
    fallbackLabel?: string;
    /** Value equality (default: `===`, then the string forms). */
    isEqual?: (a: V, b: V) => boolean;
    onOpenChange?: (open: boolean) => void;
}
export type ComboboxProps<V = unknown> = Common<V> &
    (
        | { multiple?: false; value: V | null | undefined; onChange: (value: V | null) => void }
        | { multiple: true; value: V[] | null | undefined; onChange: (value: V[]) => void }
    );

const isPrimitive = (x: unknown): x is string | number | boolean | bigint =>
    ['string', 'number', 'boolean', 'bigint'].includes(typeof x);

const defaultEqual = (a: unknown, b: unknown) =>
    a === b || (isPrimitive(a) && isPrimitive(b) && String(a) === String(b));

/**
 * Searchable picker for one or several options (Popover + Command). The trigger is a `combobox` button, so a `<label htmlFor>`
 * names it; chosen options of a multiple pick show as badges.
 */
export function Combobox<V = unknown>(props: ComboboxProps<V>) {
    const {
        options,
        id,
        placeholder,
        searchable,
        clearable,
        clearLabel,
        loading,
        disabled,
        invalid,
        emptyMessage = 'No options',
        className,
        fallbackLabel,
        isEqual = defaultEqual,
        onOpenChange
    } = props;
    const [open, setOpen] = useState(false);
    const selected: V[] = props.multiple ? (Array.isArray(props.value) ? props.value : []) : [];
    const current = props.multiple
        ? -1
        : options.findIndex((o) => props.value !== null && props.value !== undefined && isEqual(o.value, props.value));
    const labels = props.multiple
        ? options.filter((o) => selected.some((v) => isEqual(v, o.value))).map((o) => o.label)
        : null;
    const single = options[current]?.label ?? fallbackLabel ?? '';
    const empty = labels ? labels.length === 0 : !single;
    const shownPlaceholder = loading
        ? 'Loading…'
        : (placeholder ?? (props.multiple ? 'Select options' : 'Select an option'));
    const canClear = clearable && !disabled && !empty;
    const showSearch = searchable ?? options.length > 7;

    const pick = (i: number) => {
        const option = options[i];
        if (!option) return;
        const v = option.value;
        if (props.multiple)
            props.onChange(
                selected.some((s) => isEqual(s, v)) ? selected.filter((s) => !isEqual(s, v)) : [...selected, v]
            );
        else {
            props.onChange(v);
            setOpen(false);
            onOpenChange?.(false);
        }
    };

    return (
        <div className={cn('relative', className)}>
            <Popover
                open={open}
                onOpenChange={(o) => {
                    setOpen(o);
                    onOpenChange?.(o);
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label={props['aria-label']}
                        aria-invalid={invalid || undefined}
                        aria-describedby={props['aria-describedby']}
                        disabled={disabled}
                        className={cn(
                            'h-auto min-h-(--field-height) w-full justify-between font-normal whitespace-normal',
                            canClear && 'pr-14'
                        )}
                    >
                        <span className={cn('flex flex-1 flex-wrap gap-1 text-left', empty && 'text-muted-foreground')}>
                            {labels
                                ? labels.length
                                    ? labels.map((l, i) => (
                                          <Badge key={`${l}-${i}`} variant="secondary">
                                              {l}
                                          </Badge>
                                      ))
                                    : shownPlaceholder
                                : single || shownPlaceholder}
                        </span>
                        {loading ? <Spinner /> : <ChevronsUpDown className="opacity-50" />}
                    </Button>
                </PopoverTrigger>
                {/* the popover is a role=dialog and needs a name of its own */}
                <PopoverContent
                    className="w-(--radix-popover-trigger-width) min-w-56 p-0"
                    align="start"
                    aria-label={props['aria-label'] ?? shownPlaceholder}
                >
                    <Command>
                        {showSearch && <CommandInput placeholder="Search…" />}
                        <CommandList>
                            <CommandEmpty>{loading ? 'Loading…' : emptyMessage}</CommandEmpty>
                            <CommandGroup>
                                {options.map((o, i) => {
                                    const on = props.multiple
                                        ? selected.some((s) => isEqual(s, o.value))
                                        : i === current;
                                    return (
                                        <CommandItem
                                            key={`${String(o.value)}-${i}`}
                                            value={`${o.label}\u0000${i}`}
                                            keywords={[o.label]}
                                            disabled={o.disabled}
                                            onSelect={() => pick(i)}
                                        >
                                            <Check className={cn('size-4', on ? 'opacity-100' : 'opacity-0')} />
                                            {o.label}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {canClear && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="absolute top-1/2 right-8 -translate-y-1/2"
                    aria-label={clearLabel ?? `Clear ${props['aria-label'] ?? 'selection'}`}
                    onClick={() => (props.multiple ? props.onChange([]) : props.onChange(null))}
                >
                    <X />
                </Button>
            )}
        </div>
    );
}
