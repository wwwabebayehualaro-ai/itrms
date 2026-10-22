'use client';

/**
 * A date picked on the Ethiopian calendar (task 0.13; CLAUDE.md: dates are entered and shown Ethiopian, stored Gregorian).
 * The value is the stored Gregorian date (`YYYY-MM-DD`); the person sees and picks Ethiopian: a month of 30 days, or
 * Pagume of 5 or 6, in weeks from Sunday. Arrow keys move between days (across months), Home and End to the month's first
 * and last.
 * Every word comes from the caller (its catalogue): the design system ships none.
 */
import { useRef, useState } from 'react';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {
    daysInEthiopianMonth,
    ethiopianToday,
    ethiopianToJdn,
    formatEthiopianLong,
    MONTH_NAMES,
    toEthiopian,
    toGregorian,
    weekday,
    WEEKDAY_NAMES,
    type CalendarLanguage,
    type EthiopianDate
} from '@itrms/ethiopian-calendar';

import { Button } from '../primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { cn } from '../lib/utils';

export interface EthiopianDatePickerLabels {
    placeholder: string;
    previousMonth: string;
    nextMonth: string;
    clear: string;
    month: string;
    year: string;
}

export interface EthiopianDatePickerProps {
    /** The stored Gregorian date, `YYYY-MM-DD`. */
    value: string | null | undefined;
    onChange: (value: string | null) => void;
    labels: EthiopianDatePickerLabels;
    language?: CalendarLanguage;
    /** The earliest and latest dates that may be picked (Gregorian, `YYYY-MM-DD`). */
    min?: string;
    max?: string;
    id?: string;
    disabled?: boolean;
    invalid?: boolean;
    'aria-label'?: string;
    'aria-describedby'?: string;
    className?: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const fromIso = (value: string | null | undefined): EthiopianDate | null => {
    const m = value ? ISO.exec(value) : null;
    if (!m) return null;
    const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    // a date that does not exist ("2026-13-45") is no date, never another one
    const check = new Date(Date.UTC(2000, date.month - 1, date.day));
    check.setUTCFullYear(date.year);
    const real =
        check.getUTCFullYear() === date.year &&
        check.getUTCMonth() === date.month - 1 &&
        check.getUTCDate() === date.day;
    return real ? toEthiopian(date) : null;
};

/** The month `months` after (or before) the one given: thirteen to a year. */
const shift = ({ year, month }: { year: number; month: number }, months: number) => {
    const index = year * 13 + (month - 1) + months;
    return { year: Math.floor(index / 13), month: (index % 13) + 1 };
};

const WEEK = 7;

const toIso = (date: EthiopianDate): string => {
    const g = toGregorian(date);
    return `${String(g.year).padStart(4, '0')}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
};

const jdnOfIso = (value?: string) => {
    const e = fromIso(value);
    return e ? ethiopianToJdn(e) : undefined;
};

export function EthiopianDatePicker({
    value,
    onChange,
    labels,
    language = 'am',
    min,
    max,
    id,
    disabled,
    invalid,
    className,
    ...aria
}: EthiopianDatePickerProps) {
    const selected = fromIso(value);
    // today in Addis Ababa, read once when the picker mounts
    const [today] = useState(() => ethiopianToday());
    const [open, setOpen] = useState(false);
    const [shown, setShown] = useState<{ year: number; month: number }>(() => selected ?? today);
    const [wanted, setFocused] = useState<number>(() => (selected ?? today).day);
    const grid = useRef<HTMLDivElement>(null);

    const lowest = jdnOfIso(min);
    const highest = jdnOfIso(max);
    const days = daysInEthiopianMonth(shown.year, shown.month);
    const firstWeekday = weekday(ethiopianToJdn({ ...shown, day: 1 }));
    const outOfRange = (day: number) => {
        const jdn = ethiopianToJdn({ ...shown, day });
        return (lowest !== undefined && jdn < lowest) || (highest !== undefined && jdn > highest);
    };

    // the day that takes the keyboard: the one wanted, within this month (Pagume has 5 or 6) and the range, so the grid
    // can always be reached with Tab
    const inMonth = Math.min(Math.max(wanted, 1), days);
    const focused = outOfRange(inMonth)
        ? (Array.from({ length: days }, (_, i) => i + 1).find((d) => !outOfRange(d)) ?? inMonth)
        : inMonth;

    const move = (months: number) => setShown((current) => shift(current, months));

    const onOpenChange = (next: boolean) => {
        // opened again: at the value chosen (it may have changed since), or today
        if (next) {
            const at = selected ?? today;
            setShown({ year: at.year, month: at.month });
            setFocused(at.day);
        }
        setOpen(next);
    };

    const pick = (day: number) => {
        onChange(toIso({ ...shown, day }));
        setOpen(false);
    };

    const focusDay = (day: number) => {
        setFocused(day);
        requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus());
    };

    const onGridKey = (e: React.KeyboardEvent) => {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -WEEK, ArrowDown: WEEK }[e.key];
        if (step !== undefined) {
            e.preventDefault();
            const day = focused + step;
            if (day >= 1 && day <= days) focusDay(day);
            else {
                // into the month before or after
                const next = shift(shown, day < 1 ? -1 : 1);
                setShown(next);
                focusDay(day < 1 ? daysInEthiopianMonth(next.year, next.month) + day : day - days);
            }
        } else if (e.key === 'Home') {
            e.preventDefault();
            focusDay(1);
        } else if (e.key === 'End') {
            e.preventDefault();
            focusDay(days);
        }
    };

    const weekdays = WEEKDAY_NAMES[language];
    // the month in weeks from Sunday: blanks before the first day and after the last
    const cells = [
        ...Array.from({ length: firstWeekday }, () => null),
        ...Array.from({ length: days }, (_, i) => i + 1)
    ];
    const weeks = Array.from({ length: Math.ceil(cells.length / WEEK) }, (_, w) => {
        const week: (number | null)[] = cells.slice(w * WEEK, w * WEEK + WEEK);
        while (week.length < WEEK) week.push(null);
        return week;
    });
    const shownLabel = selected ? formatEthiopianLong(selected, { language }) : '';

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    {...aria}
                    className={cn(
                        'w-full justify-start gap-2 font-normal',
                        !selected && 'text-muted-foreground',
                        className
                    )}
                >
                    <CalendarIcon className="size-4" aria-hidden />
                    <span lang={language}>{shownLabel || labels.placeholder}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="start">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={labels.previousMonth}
                        onClick={() => move(-1)}
                    >
                        <ChevronLeft />
                    </Button>
                    <div className="flex items-center gap-1" lang={language}>
                        <select
                            aria-label={labels.month}
                            className="rounded border bg-background px-1 py-0.5 text-sm"
                            value={shown.month}
                            onChange={(e) => setShown((s) => ({ ...s, month: Number(e.target.value) }))}
                        >
                            {MONTH_NAMES[language].map((name, i) => (
                                <option key={name} value={i + 1}>
                                    {name}
                                </option>
                            ))}
                        </select>
                        <input
                            aria-label={labels.year}
                            className="w-16 rounded border bg-background px-1 py-0.5 text-sm"
                            type="number"
                            value={shown.year}
                            onChange={(e) => {
                                const year = Number(e.target.value);
                                if (Number.isInteger(year) && year > 0 && year < 10_000)
                                    setShown((s) => ({ ...s, year }));
                            }}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={labels.nextMonth}
                        onClick={() => move(1)}
                    >
                        <ChevronRight />
                    </Button>
                </div>
                <div
                    ref={grid}
                    role="grid"
                    className="flex flex-col gap-1 text-center"
                    onKeyDown={onGridKey}
                    lang={language}
                >
                    <div role="row" className="grid grid-cols-7 gap-1">
                        {weekdays.map((name) => (
                            <div
                                key={name}
                                role="columnheader"
                                aria-label={name}
                                className="text-xs text-muted-foreground"
                            >
                                {name.slice(0, 2)}
                            </div>
                        ))}
                    </div>
                    {weeks.map((week, w) => (
                        <div key={w} role="row" className="grid grid-cols-7 gap-1">
                            {week.map((day, i) => {
                                if (day === null) return <div key={`blank-${i}`} role="gridcell" aria-hidden />;
                                const isSelected =
                                    selected?.year === shown.year &&
                                    selected.month === shown.month &&
                                    selected.day === day;
                                const isToday =
                                    today.year === shown.year && today.month === shown.month && today.day === day;
                                return (
                                    <div key={day} role="gridcell" aria-selected={isSelected}>
                                        <button
                                            type="button"
                                            data-day={day}
                                            tabIndex={day === focused ? 0 : -1}
                                            disabled={outOfRange(day)}
                                            aria-label={formatEthiopianLong({ ...shown, day }, { language })}
                                            aria-current={isToday ? 'date' : undefined}
                                            onClick={() => pick(day)}
                                            className={cn(
                                                'size-8 rounded text-sm hover:bg-accent disabled:opacity-40',
                                                isToday && 'font-semibold underline',
                                                isSelected && 'bg-primary text-primary-foreground hover:bg-primary'
                                            )}
                                        >
                                            {day}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                {selected && (
                    <div className="mt-2 flex justify-end">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                        >
                            {labels.clear}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
