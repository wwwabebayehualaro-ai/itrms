'use client';

import { Search, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';

export interface ActiveFilter {
    key: string;
    /** The filter and its value in words ("Woreda: Sodo Zuria"). */
    label: string;
}

export interface FilterBarLabels {
    search: string;
    /** The accessible name of a chip's remove button; `{filter}` is the chip's label. */
    removeFilter: string;
    clearAll: string;
    activeFilters: string;
}

// English until the shell's message catalogues arrive (task 0.13); callers pass translated labels.
const ENGLISH: FilterBarLabels = {
    search: 'Search',
    removeFilter: 'Remove filter: {filter}',
    clearAll: 'Clear all filters',
    activeFilters: 'Active filters'
};

export interface FilterBarProps extends Omit<React.ComponentProps<'div'>, 'onChange'> {
    search?: string;
    onSearchChange?: (value: string) => void;
    searchPlaceholder?: string;
    /** The filter controls: selects, a date range, a toggle. */
    children?: React.ReactNode;
    active?: ActiveFilter[];
    onRemove?: (key: string) => void;
    onClearAll?: () => void;
    labels?: FilterBarLabels;
}

/**
 * Search and filters above a list. The bar is controlled: the page keeps the values (in the URL, so a filtered list can be
 * shared and survives a reload) and the bar reports changes.
 */
export function FilterBar({
    search,
    onSearchChange,
    searchPlaceholder,
    children,
    active = [],
    onRemove,
    onClearAll,
    labels = ENGLISH,
    className,
    ...props
}: FilterBarProps) {
    return (
        <div data-slot="filter-bar" className={cn('flex flex-col gap-3 pb-4', className)} {...props}>
            <div role="search" className="flex flex-wrap items-center gap-2">
                {onSearchChange && (
                    <div className="relative min-w-48 flex-1 basis-64">
                        <Search
                            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                        />
                        <Input
                            type="search"
                            aria-label={labels.search}
                            placeholder={searchPlaceholder}
                            className="ps-9"
                            value={search ?? ''}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                )}
                {children}
            </div>
            {active.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <ul aria-label={labels.activeFilters} className="flex flex-wrap items-center gap-2">
                        {active.map((f) => (
                            <li
                                key={f.key}
                                className="inline-flex items-center gap-1 rounded-full border bg-muted ps-3 text-sm"
                            >
                                {f.label}
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="rounded-full"
                                    aria-label={labels.removeFilter.replace('{filter}', f.label)}
                                    onClick={() => onRemove?.(f.key)}
                                >
                                    <X aria-hidden />
                                </Button>
                            </li>
                        ))}
                    </ul>
                    {onClearAll && (
                        <Button variant="link" size="sm" onClick={onClearAll}>
                            {labels.clearAll}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
