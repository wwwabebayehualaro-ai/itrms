'use client';

import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Button } from '../primitives/button';
import { Calendar } from '../primitives/calendar';
import { Input } from '../primitives/input';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { cn } from '../lib/utils';

export interface DatePickerProps {
    value: Date | null | undefined;
    onChange: (value: Date | null) => void;
    id?: string;
    placeholder?: string;
    /** Also pick a time (hours and minutes). */
    withTime?: boolean;
    min?: Date | null;
    max?: Date | null;
    /** How the trigger shows the chosen date (default: the reader's locale). */
    formatLabel?: (d: Date) => string;
    disabled?: boolean;
    invalid?: boolean;
    'aria-label'?: string;
    'aria-describedby'?: string;
    className?: string;
    onOpenChange?: (open: boolean) => void;
}

const localLabel = (d: Date, withTime?: boolean) => (withTime ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' }));

/** A date (and optional time) in a popover calendar with month/year dropdowns and a Clear button. */
export function DatePicker({ value, onChange, id, placeholder = 'Pick a date', withTime, min, max, formatLabel, disabled, invalid, className, onOpenChange, ...aria }: DatePickerProps) {
    const [open, setOpen] = useState(false);
    const date = value ?? null;
    let shown = '';
    try {
        shown = date ? (formatLabel ? formatLabel(date) : localLabel(date, withTime)) : '';
    } catch {
        shown = date ? localLabel(date, withTime) : '';
    }
    const time = date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';
    const toggle = (o: boolean) => {
        setOpen(o);
        onOpenChange?.(o);
    };
    return (
        <Popover open={open} onOpenChange={toggle}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    aria-label={aria['aria-label'] && shown ? `${aria['aria-label']}: ${shown}` : aria['aria-label']}
                    aria-invalid={invalid || undefined}
                    aria-describedby={aria['aria-describedby']}
                    className={cn('w-full justify-between font-normal', !date && 'text-muted-foreground', className)}
                >
                    {shown || placeholder}
                    <CalendarIcon className="opacity-60" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    selected={date ?? undefined}
                    defaultMonth={date ?? undefined}
                    captionLayout="dropdown"
                    startMonth={min ?? new Date(1900, 0)}
                    endMonth={max ?? new Date(new Date().getFullYear() + 20, 11)}
                    disabled={[...(min ? [{ before: min }] : []), ...(max ? [{ after: max }] : [])]}
                    onSelect={(d) => {
                        if (d && withTime && date) d.setHours(date.getHours(), date.getMinutes());
                        onChange(d ?? null);
                        if (!withTime) toggle(false);
                    }}
                />
                <div className="flex items-center gap-2 border-t p-2">
                    {withTime && (
                        <Input
                            type="time"
                            aria-label="Time"
                            value={time}
                            className="h-8 w-28"
                            onChange={(e) => {
                                const [h, m] = e.target.value.split(':').map(Number);
                                const d = new Date(date ?? new Date());
                                d.setHours(h || 0, m || 0, 0, 0);
                                onChange(d);
                            }}
                        />
                    )}
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => onChange(null)} disabled={!date}>
                        Clear
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
