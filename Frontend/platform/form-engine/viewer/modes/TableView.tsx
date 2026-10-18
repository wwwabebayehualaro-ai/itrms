'use client';

import { useMemo } from 'react';
import { ColumnDef, OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { Columns3, Eye } from 'lucide-react';
import { Button, Checkbox, DataGrid, IconButton, Label, Popover, PopoverContent, PopoverTrigger } from '@platform/ui';
import { getApiErrorMessage } from '@platform/lib/api/errors';
import { cellText } from '../../Runtime/cellText';
import { CellValue } from '../../renderer/cells';
import { getByPath } from '../../Runtime/expression';
import type { TableColumn } from '../../Runtime/types';
import { useSubmissionData } from '../api';
import type { ViewModeProps } from '../registry';
import { ViewField, ViewSchema, ViewRow } from '../types';

const MAX_DEFAULT_VALUE_COLUMNS = 5;

/** Where a field's value sits in a result row. */
const pathOf = (f: ViewField) => (f.key === 'submitted_by' ? 'submitted_by_name' : f.builtin ? f.key : `submission_data.${f.key}`);

/** The cell definition the form engine's table renderer understands, from the server's description of the field. */
export function columnOf(f: ViewField): TableColumn {
    const base = { field: pathOf(f), header: f.label };
    if (f.key === 'status') return { ...base, type: 'tag' };
    switch (f.kind) {
        case 'number':
            return f.currency ? { ...base, type: 'currency', currency: f.currency } : { ...base, type: 'number' };
        case 'date':
            return { ...base, type: 'date' };
        case 'datetime':
            return { ...base, type: 'datetime' };
        case 'boolean':
            return { ...base, type: 'boolean' };
        case 'files':
            return { ...base, type: 'files' };
        case 'rows':
            return { ...base, type: 'count' };
        case 'multi':
            return { ...base, type: 'tags' };
        case 'person':
            return { ...base, type: 'text' };
        default:
            return { ...base, type: f.options.length || f.person ? 'lookup' : 'text' };
    }
}

export function defaultColumns(schema: ViewSchema): string[] {
    const { title } = schema.roles;
    const own = schema.fields.filter((f) => !f.builtin && f.key !== title).map((f) => f.key);
    return [...(title ? [title] : []), ...own.slice(0, MAX_DEFAULT_VALUE_COLUMNS - (title ? 1 : 0)), 'status', 'submitted_by', 'created_at'];
}

const updater = <T,>(change: Parameters<OnChangeFn<T>>[0], current: T): T => (typeof change === 'function' ? (change as (old: T) => T)(current) : change);

export default function TableView({ templateId, schema, state, patch, labeler, onOpen, rowActions, emptyMessage }: ViewModeProps) {
    const keys = useMemo(() => {
        const chosen = state.columns.filter((k) => schema.fields.some((f) => f.key === k));
        return chosen.length ? chosen : defaultColumns(schema);
    }, [state.columns, schema]);

    const sort = state.sort.length ? state.sort : [{ field: 'created_at', desc: true }];
    const { data, isPending, isFetching, error } = useSubmissionData({ template_id: templateId, filter: state.filter, search: state.search || undefined, sort, page: state.page, page_size: state.pageSize });

    const columns = useMemo<ColumnDef<ViewRow>[]>(() => {
        const cols: ColumnDef<ViewRow>[] = keys.flatMap((k) => {
            const f = schema.fields.find((x) => x.key === k);
            if (!f) return [];
            const col = columnOf(f);
            const lookups = { [col.field]: labeler.lookup(f.key) };
            const isTitle = k === schema.roles.title;
            return [
                {
                    id: f.key,
                    accessorFn: (row) => getByPath(row, col.field), // TanStack Table only sorts columns that read a value
                    header: f.label,
                    enableSorting: f.sortable,
                    cell: ({ row }) =>
                        isTitle ? (
                            <button type="button" data-open className="text-left font-semibold hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => onOpen(row.original)} title={cellText(col, row.original, lookups)}>
                                <CellValue col={col} row={row.original} lookups={lookups} />
                            </button>
                        ) : (
                            <CellValue col={col} row={row.original} lookups={lookups} />
                        )
                } satisfies ColumnDef<ViewRow>
            ];
        });
        cols.push({
            id: '__actions',
            header: '',
            enableSorting: false,
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                    <IconButton label="View" onClick={() => onOpen(row.original)}>
                        <Eye />
                    </IconButton>
                    {rowActions?.(row.original)}
                </div>
            )
        });
        return cols;
    }, [keys, schema, labeler, onOpen, rowActions]);

    const pagination: PaginationState = { pageIndex: state.page - 1, pageSize: state.pageSize };
    const onPaginationChange: OnChangeFn<PaginationState> = (change) => {
        const next = updater(change, pagination);
        patch(next.pageSize !== pagination.pageSize ? { pageSize: next.pageSize, page: 1 } : { page: next.pageIndex + 1 });
    };
    const sorting: SortingState = sort.map((s) => ({ id: s.field, desc: !!s.desc }));
    const onSortingChange: OnChangeFn<SortingState> = (change) => patch({ sort: updater(change, sorting).slice(0, 1).map((s) => ({ field: s.id, desc: s.desc })) });

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-end">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="sm">
                            <Columns3 />
                            Columns
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60 p-2" aria-label="Choose columns">
                        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
                            {schema.fields.map((f) => (
                                <Label key={f.key} className="cursor-pointer rounded-sm px-2 py-1.5 font-normal hover:bg-accent">
                                    <Checkbox id={`col-${f.key}`} checked={keys.includes(f.key)} onCheckedChange={(c) => patch({ columns: c === true ? [...keys, f.key] : keys.filter((k) => k !== f.key), page: state.page })} />
                                    {f.label}
                                </Label>
                            ))}
                        </div>
                        <Button type="button" variant="link" size="sm" className="mt-1" onClick={() => patch({ columns: [], page: state.page })}>
                            Reset columns
                        </Button>
                    </PopoverContent>
                </Popover>
            </div>
            <DataGrid
                caption="Requests"
                data={data?.items ?? []}
                columns={columns}
                total={data?.total ?? 0}
                getRowId={(r) => r.id as string}
                pagination={pagination}
                onPaginationChange={onPaginationChange}
                sorting={sorting}
                onSortingChange={onSortingChange}
                loading={isPending}
                fetching={isFetching}
                error={error ? getApiErrorMessage(error) : null}
                emptyMessage={state.search || state.filter.items.length ? 'No requests match these filters.' : (emptyMessage ?? 'No requests yet.')}
            />
        </div>
    );
}
