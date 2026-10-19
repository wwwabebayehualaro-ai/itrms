'use client';

import React from 'react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Pager } from '../controls/Pager';
import { Spinner } from '../primitives/spinner';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table';
import { cn } from '../lib/utils';

interface DataGridProps<T> {
    data: T[];
    columns: ColumnDef<T, unknown>[];
    /** Total rows on the server (drives the page count). */
    total: number;
    pagination: PaginationState;
    onPaginationChange: OnChangeFn<PaginationState>;
    sorting?: SortingState;
    onSortingChange?: OnChangeFn<SortingState>;
    getRowId?: (row: T) => string;
    loading?: boolean;
    /** True while a new page loads over the previous one (keepPreviousData). */
    fetching?: boolean;
    error?: string | null;
    emptyMessage?: string;
    pageSizes?: number[];
    caption?: string;
    /** Third click clears the sort (default: headers only toggle ascending/descending, since the server always has a default order). */
    allowSortRemoval?: boolean;
}

/**
 * Server-driven data table on TanStack Table: pagination and sorting are controlled by the caller (typically a
 * `useQuery` keyed by the same state), the grid only renders and reports changes.
 */
export function DataGrid<T>({
    data,
    columns,
    total,
    pagination,
    onPaginationChange,
    sorting = [],
    onSortingChange,
    getRowId,
    loading,
    fetching,
    error,
    emptyMessage = 'No records',
    pageSizes = [10, 20, 50],
    caption,
    allowSortRemoval = false
}: DataGridProps<T>) {
    const table = useReactTable({
        data,
        columns,
        state: { pagination, sorting },
        rowCount: total,
        manualPagination: true,
        manualSorting: true,
        enableSortingRemoval: allowSortRemoval,
        sortDescFirst: false, // the first click is ascending for every column type (TanStack defaults numbers to descending)
        onPaginationChange,
        onSortingChange,
        getRowId,
        getCoreRowModel: getCoreRowModel()
    });

    const rows = table.getRowModel().rows;
    const span = columns.length;

    return (
        <div className="w-full" aria-busy={fetching || loading}>
            <div className="overflow-hidden rounded-md border">
                <Table>
                    {caption && <TableCaption className="sr-only">{caption}</TableCaption>}
                    <TableHeader className="bg-muted/50">
                        {table.getHeaderGroups().map((group) => (
                            <TableRow key={group.id}>
                                {group.headers.map((header) => {
                                    const sortable = header.column.getCanSort() && !!onSortingChange;
                                    const dir = header.column.getIsSorted();
                                    const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
                                    return (
                                        <TableHead
                                            key={header.id}
                                            scope="col"
                                            className={cn(
                                                sortable && 'cursor-pointer select-none hover:text-foreground'
                                            )}
                                            aria-sort={
                                                dir === 'asc'
                                                    ? 'ascending'
                                                    : dir === 'desc'
                                                      ? 'descending'
                                                      : sortable
                                                        ? 'none'
                                                        : undefined
                                            }
                                            onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                                            onKeyDown={
                                                sortable
                                                    ? (e) => {
                                                          if (e.key === 'Enter' || e.key === ' ') {
                                                              e.preventDefault();
                                                              header.column.toggleSorting(undefined, false);
                                                          }
                                                      }
                                                    : undefined
                                            }
                                            tabIndex={sortable ? 0 : undefined}
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {sortable && (
                                                    <Icon
                                                        className={cn('size-3.5', !dir && 'opacity-40')}
                                                        aria-hidden
                                                    />
                                                )}
                                            </span>
                                        </TableHead>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody className={cn(fetching && 'opacity-60 transition-opacity')}>
                        {loading && (
                            <TableRow>
                                <TableCell colSpan={span} className="h-24 text-center text-muted-foreground">
                                    <span className="inline-flex items-center gap-2">
                                        <Spinner /> Loading…
                                    </span>
                                </TableCell>
                            </TableRow>
                        )}
                        {!loading && error && (
                            <TableRow>
                                <TableCell colSpan={span} className="h-24 text-center text-destructive" role="alert">
                                    {error}
                                </TableCell>
                            </TableRow>
                        )}
                        {!loading && !error && rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={span} className="h-24 text-center text-muted-foreground">
                                    {emptyMessage}
                                </TableCell>
                            </TableRow>
                        )}
                        {rows.map((row) => (
                            <TableRow key={row.id}>
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <Pager
                className="mt-3"
                page={pagination.pageIndex + 1}
                pageSize={pagination.pageSize}
                total={total}
                pageSizes={pageSizes}
                onChange={({ page, pageSize }) =>
                    onPaginationChange(
                        pageSize !== pagination.pageSize
                            ? { pageIndex: 0, pageSize }
                            : { pageIndex: page - 1, pageSize }
                    )
                }
            />
        </div>
    );
}
