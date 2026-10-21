'use client';

import React from 'react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type {
    CellContext,
    Column,
    ColumnDef,
    HeaderContext,
    ColumnPinningState,
    ColumnSizingState,
    OnChangeFn,
    PaginationState,
    Row,
    RowData,
    RowSelectionState,
    SortingState
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Pager } from '../controls/Pager';
import { Button } from '../primitives/button';
import { Checkbox } from '../primitives/checkbox';
import { Spinner } from '../primitives/spinner';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table';
import { cn } from '../lib/utils';

export interface DataGridLabels {
    selectAll: string;
    /** `{row}` is the row's label (`getRowLabel`). */
    selectRow: string;
    /** `{count}` is the number of selected rows, on every page. */
    selected: string;
    clearSelection: string;
    /** `{column}` is the column's header. */
    resizeColumn: string;
}

// English until the shell's message catalogues arrive (task 0.13); callers pass translated labels.
const ENGLISH: DataGridLabels = {
    selectAll: 'Select all rows on this page',
    selectRow: 'Select {row}',
    selected: '{count} selected',
    clearSelection: 'Clear the selection',
    resizeColumn: 'Resize the {column} column'
};

const SELECT_COLUMN = '__select';
const RESIZE_STEP = 16;
const MIN_WIDTH = 40;
const MAX_WIDTH = 1000;

declare module '@tanstack/react-table' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the augmented interface must keep TanStack's parameters
    interface ColumnMeta<TData extends RowData, TValue> {
        /** The column's name for screen readers (its resize handle) when `header` is not plain text. */
        label?: string;
    }
}

/**
 * Bulk selection: a checkbox column, and `bulkActions` above the grid while rows are selected. Selection is by row id, so
 * it survives paging, and `getRowId` is required with it: TanStack's default ids are row indexes, which would select the
 * same position on every page and hand those indexes to a bulk action.
 */
type SelectionProps<T> =
    | {
          enableRowSelection?: false;
          getRowId?: (row: T) => string;
          rowSelection?: never;
          onRowSelectionChange?: never;
          bulkActions?: never;
      }
    | {
          enableRowSelection: true | ((row: T) => boolean);
          getRowId: (row: T) => string;
          rowSelection?: RowSelectionState;
          onRowSelectionChange?: OnChangeFn<RowSelectionState>;
          bulkActions?: (selectedIds: string[]) => React.ReactNode;
      };

type DataGridProps<T> = DataGridBaseProps<T> & SelectionProps<T>;

interface DataGridBaseProps<T> {
    data: T[];
    columns: ColumnDef<T, unknown>[];
    /** Total rows on the server (drives the page count). */
    total: number;
    pagination: PaginationState;
    onPaginationChange: OnChangeFn<PaginationState>;
    sorting?: SortingState;
    onSortingChange?: OnChangeFn<SortingState>;
    loading?: boolean;
    /** True while a new page loads over the previous one (keepPreviousData). */
    fetching?: boolean;
    error?: string | null;
    emptyMessage?: string;
    pageSizes?: number[];
    caption?: string;
    /** Third click clears the sort (default: headers only toggle ascending/descending, since the server always has a default order). */
    allowSortRemoval?: boolean;
    /** Columns kept in view while the rest scroll sideways, by column id. The selection column joins the left ones. */
    columnPinning?: ColumnPinningState;
    /** Let users drag (or arrow-key) a column's edge to resize it. Pass `columnSizing` to keep the widths, e.g. per user. */
    enableColumnResizing?: boolean;
    columnSizing?: ColumnSizingState;
    onColumnSizingChange?: OnChangeFn<ColumnSizingState>;
    /** Opens a row (Enter on the focused row). With it or with selection, rows take arrow-key focus. */
    onRowActivate?: (row: T) => void;
    /** How a row is named to screen readers (its checkbox label); defaults to its id. */
    getRowLabel?: (row: T) => string;
    labels?: DataGridLabels;
}

const headerText = <T,>(column: Column<T, unknown>) =>
    column.columnDef.meta?.label ?? (typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id);

function pinnedStyle<T>(column: Column<T, unknown>): React.CSSProperties | undefined {
    const side = column.getIsPinned();
    if (!side) return undefined;
    return side === 'left'
        ? { position: 'sticky', left: column.getStart('left'), zIndex: 1 }
        : { position: 'sticky', right: column.getAfter('right'), zIndex: 1 };
}

/** What the selection cells read from the table (`meta`), so their column stays one definition across renders. */
interface GridMeta {
    labels: DataGridLabels;
    rowLabel: (original: unknown, id: string) => string;
}

const gridMeta = (table: { options: { meta?: unknown } }) => table.options.meta as GridMeta;

// Module-level components: a cell renderer made inside the grid would be a new component on every render, and React would
// remount the checkbox (losing focus) each time the selection changes.
function SelectAllBox<T>({ table }: HeaderContext<T, unknown>) {
    return (
        <Checkbox
            aria-label={gridMeta(table).labels.selectAll}
            checked={
                table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        />
    );
}

function SelectRowBox<T>({ row, table }: CellContext<T, unknown>) {
    const { labels, rowLabel } = gridMeta(table);
    return (
        // not a tab stop: the row takes focus and Space selects it
        <Checkbox
            tabIndex={-1}
            aria-label={labels.selectRow.replace('{row}', rowLabel(row.original, row.id))}
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(v) => row.toggleSelected(v === true)}
        />
    );
}

const selectColumn = <T,>(): ColumnDef<T, unknown> => ({
    id: SELECT_COLUMN,
    size: 44,
    enableResizing: false,
    enableSorting: false,
    header: SelectAllBox,
    cell: SelectRowBox
});

const pinnedEdge = <T,>(column: Column<T, unknown>) =>
    cn(
        column.getIsPinned() === 'left' && column.getIsLastColumn('left') && 'border-e',
        column.getIsPinned() === 'right' && column.getIsFirstColumn('right') && 'border-s'
    );

/**
 * Server-driven data table on TanStack Table: pagination and sorting are controlled by the caller (typically a
 * `useQuery` keyed by the same state), the grid only renders and reports changes. Optional: pinned and resizable columns,
 * bulk selection, and keyboard row navigation (arrows, Home, End; Enter opens, Space selects).
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
    allowSortRemoval = false,
    columnPinning,
    enableColumnResizing = false,
    columnSizing: sizingProp,
    onColumnSizingChange,
    enableRowSelection,
    rowSelection: selectionProp,
    onRowSelectionChange,
    bulkActions,
    onRowActivate,
    getRowLabel,
    labels = ENGLISH
}: DataGridProps<T>) {
    const [ownSizing, setOwnSizing] = React.useState<ColumnSizingState>({});
    const [ownSelection, setOwnSelection] = React.useState<RowSelectionState>({});
    const sizing = sizingProp ?? ownSizing;
    const selection = selectionProp ?? ownSelection;
    const selectable = !!enableRowSelection;
    const navigable = selectable || !!onRowActivate;

    const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(
        () => (selectable ? [selectColumn<T>(), ...columns] : columns),
        [selectable, columns]
    );
    const meta: GridMeta = {
        labels,
        // TanStack rows hold the caller's T, so the original is one
        rowLabel: (original, id) => (getRowLabel ? getRowLabel(original as T) : id)
    };

    const pinning = React.useMemo<ColumnPinningState | undefined>(() => {
        if (!columnPinning) return selectable ? { left: [SELECT_COLUMN] } : undefined;
        return selectable ? { ...columnPinning, left: [SELECT_COLUMN, ...(columnPinning.left ?? [])] } : columnPinning;
    }, [columnPinning, selectable]);
    // Pinned offsets and resized widths need the browser to keep the widths it is given.
    const fixedLayout = enableColumnResizing || !!columnPinning;

    const table = useReactTable({
        data,
        columns: allColumns,
        defaultColumn: { minSize: MIN_WIDTH, maxSize: MAX_WIDTH },
        state: { pagination, sorting, columnSizing: sizing, rowSelection: selection, columnPinning: pinning ?? {} },
        rowCount: total,
        manualPagination: true,
        manualSorting: true,
        enableSortingRemoval: allowSortRemoval,
        sortDescFirst: false, // the first click is ascending for every column type (TanStack defaults numbers to descending)
        onPaginationChange,
        onSortingChange,
        enableColumnResizing,
        columnResizeMode: 'onChange',
        onColumnSizingChange: onColumnSizingChange ?? setOwnSizing,
        enableRowSelection:
            typeof enableRowSelection === 'function' ? (r) => enableRowSelection(r.original) : selectable,
        onRowSelectionChange: onRowSelectionChange ?? setOwnSelection,
        meta,
        getRowId,
        getCoreRowModel: getCoreRowModel()
    });

    const rows = table.getRowModel().rows;
    const span = allColumns.length;
    const selectedIds = Object.keys(selection).filter((id) => selection[id]);

    // Keyboard row navigation: one row is the tab stop; arrows move it (a roving tabindex).
    const rowRefs = React.useRef<(HTMLTableRowElement | null)[]>([]);
    const [activeRow, setActiveRow] = React.useState(0);
    const focusable = Math.min(activeRow, Math.max(rows.length - 1, 0));
    const focusRow = (index: number) => {
        const next = Math.min(Math.max(index, 0), rows.length - 1);
        setActiveRow(next);
        rowRefs.current[next]?.focus();
    };
    const onRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, index: number, row: Row<T>) => {
        if (e.target !== e.currentTarget) return; // keys typed into a cell's own control stay there
        const moves: Record<string, number> = {
            ArrowDown: index + 1,
            ArrowUp: index - 1,
            Home: 0,
            End: rows.length - 1
        };
        if (e.key in moves) {
            e.preventDefault();
            focusRow(moves[e.key] ?? index);
        } else if (e.key === 'Enter' && onRowActivate) {
            e.preventDefault();
            onRowActivate(row.original);
        } else if (e.key === ' ' && selectable && row.getCanSelect()) {
            e.preventDefault();
            row.toggleSelected();
        }
    };

    // Clearing the selection removes the bulk bar, and with it the button that had focus; focus returns to the grid.
    const hadSelection = React.useRef(false);
    React.useEffect(() => {
        const has = selectedIds.length > 0;
        if (hadSelection.current && !has && (!document.activeElement || document.activeElement === document.body))
            rowRefs.current[focusable]?.focus();
        hadSelection.current = has;
    });

    const resizeBy = (column: Column<T, unknown>, delta: number) => {
        const { minSize = MIN_WIDTH, maxSize = MAX_WIDTH } = column.columnDef;
        const size = Math.min(Math.max(column.getSize() + delta, minSize), maxSize);
        table.setColumnSizing((old) => ({ ...old, [column.id]: size }));
    };
    // A drag that starts on a resize handle and ends over the header text clicks the header; that click must not sort.
    const pressedOnHandle = React.useRef(false);
    const selectedText = labels.selected.replace('{count}', String(selectedIds.length));

    return (
        <div className="w-full" aria-busy={fetching || loading}>
            {/* always present: a live region announces only changes made after it is in the page */}
            {selectable && (
                <span className="sr-only" aria-live="polite">
                    {selectedIds.length > 0 ? selectedText : ''}
                </span>
            )}
            {selectable && selectedIds.length > 0 && (
                <div
                    role="region"
                    aria-label={selectedText}
                    className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted px-3 py-2"
                >
                    <span className="text-sm font-medium" aria-hidden>
                        {selectedText}
                    </span>
                    <div className="flex flex-1 flex-wrap items-center gap-2">{bulkActions?.(selectedIds)}</div>
                    <Button variant="ghost" size="sm" onClick={() => table.resetRowSelection()}>
                        {labels.clearSelection}
                    </Button>
                </div>
            )}
            <div className="overflow-hidden rounded-md border">
                <Table
                    className={cn(fixedLayout && 'table-fixed')}
                    style={fixedLayout ? { width: table.getTotalSize() } : undefined}
                >
                    {caption && <TableCaption className="sr-only">{caption}</TableCaption>}
                    <TableHeader>
                        {table.getHeaderGroups().map((group) => (
                            <TableRow key={group.id} className="hover:bg-transparent">
                                {group.headers.map((header) => {
                                    const { column } = header;
                                    const sortable = column.getCanSort() && !!onSortingChange;
                                    const dir = column.getIsSorted();
                                    const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
                                    return (
                                        <TableHead
                                            key={header.id}
                                            scope="col"
                                            style={{
                                                ...pinnedStyle(column),
                                                width: fixedLayout ? header.getSize() : undefined
                                            }}
                                            className={cn(
                                                'relative bg-muted',
                                                fixedLayout && 'overflow-hidden whitespace-normal',
                                                pinnedEdge(column),
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
                                            onMouseDownCapture={() => {
                                                pressedOnHandle.current = false;
                                            }}
                                            onClick={
                                                sortable
                                                    ? (e) => {
                                                          if (pressedOnHandle.current) return;
                                                          column.getToggleSortingHandler()?.(e);
                                                      }
                                                    : undefined
                                            }
                                            onKeyDown={
                                                sortable
                                                    ? (e) => {
                                                          if (e.key === 'Enter' || e.key === ' ') {
                                                              e.preventDefault();
                                                              column.toggleSorting(undefined, false);
                                                          }
                                                      }
                                                    : undefined
                                            }
                                            tabIndex={sortable ? 0 : undefined}
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                {flexRender(column.columnDef.header, header.getContext())}
                                                {sortable && (
                                                    <Icon
                                                        className={cn('size-3.5 shrink-0', !dir && 'opacity-40')}
                                                        aria-hidden
                                                    />
                                                )}
                                            </span>
                                            {column.getCanResize() && (
                                                <div
                                                    role="separator"
                                                    aria-orientation="vertical"
                                                    aria-label={labels.resizeColumn.replace(
                                                        '{column}',
                                                        headerText(column)
                                                    )}
                                                    aria-valuenow={column.getSize()}
                                                    aria-valuemin={column.columnDef.minSize ?? MIN_WIDTH}
                                                    aria-valuemax={column.columnDef.maxSize ?? MAX_WIDTH}
                                                    tabIndex={0}
                                                    onMouseDown={(e) => {
                                                        pressedOnHandle.current = true;
                                                        header.getResizeHandler()(e);
                                                    }}
                                                    onTouchStart={header.getResizeHandler()}
                                                    onDoubleClick={() => column.resetSize()}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => {
                                                        e.stopPropagation(); // Enter and Space here never sort
                                                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                                                            e.preventDefault();
                                                            resizeBy(
                                                                column,
                                                                e.key === 'ArrowRight' ? RESIZE_STEP : -RESIZE_STEP
                                                            );
                                                        }
                                                    }}
                                                    className={cn(
                                                        'absolute inset-y-0 end-0 w-2 cursor-col-resize touch-none select-none',
                                                        'border-e-2 border-transparent hover:border-ring focus-visible:border-ring focus-visible:outline-none',
                                                        column.getIsResizing() && 'border-ring'
                                                    )}
                                                />
                                            )}
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
                        {rows.map((row, index) => (
                            <TableRow
                                key={row.id}
                                ref={(el) => {
                                    rowRefs.current[index] = el;
                                }}
                                data-state={row.getIsSelected() ? 'selected' : undefined}
                                tabIndex={navigable ? (index === focusable ? 0 : -1) : undefined}
                                onKeyDown={navigable ? (e) => onRowKeyDown(e, index, row) : undefined}
                                onFocus={navigable ? () => setActiveRow(index) : undefined}
                                className={cn(
                                    'group',
                                    navigable &&
                                        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset'
                                )}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell
                                        key={cell.id}
                                        style={pinnedStyle(cell.column)}
                                        className={cn(
                                            fixedLayout && 'overflow-hidden whitespace-normal break-words',
                                            cell.column.getIsPinned() &&
                                                'bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted',
                                            pinnedEdge(cell.column)
                                        )}
                                    >
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
