import * as React from 'react';

import { cn } from '../lib/utils';

export interface DescriptionItem {
    term: React.ReactNode;
    /** An empty value shows `empty` (a dash by default), never a blank. */
    value?: React.ReactNode;
    /** Take a whole row (an address, a note). */
    wide?: boolean;
}

export interface DescriptionListProps extends React.ComponentProps<'dl'> {
    items: DescriptionItem[];
    /** Columns at full width; the list drops to fewer as its container narrows. */
    columns?: 1 | 2 | 3;
    empty?: React.ReactNode;
}

const COLUMNS = {
    1: '',
    2: '@md:grid-cols-2',
    3: '@md:grid-cols-2 @3xl:grid-cols-3'
} as const;

/**
 * Label and value pairs: the key facts of a record, a case summary. Sized by its container, not the window, so it fits a
 * record panel or a side sheet alike (design-system.md §11).
 */
export function DescriptionList({ items, columns = 2, empty = '—', className, ...props }: DescriptionListProps) {
    return (
        <div className="@container">
            <dl
                data-slot="description-list"
                className={cn('grid grid-cols-1 gap-x-6 gap-y-4', COLUMNS[columns], className)}
                {...props}
            >
                {items.map((item, i) => (
                    <div key={i} className={cn('flex min-w-0 flex-col gap-0.5', item.wide && 'col-span-full')}>
                        <dt className="text-sm text-muted-foreground">{item.term}</dt>
                        <dd className="break-words">
                            {item.value === undefined || item.value === null || item.value === '' ? empty : item.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
