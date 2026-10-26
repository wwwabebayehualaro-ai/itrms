'use client';

import { useMemo } from 'react';
import type { ColumnDef, OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { Columns3, Eye } from 'lucide-react';
import { Button, Checkbox, DataGrid, IconButton, Label, Popover, PopoverContent, PopoverTrigger } from '@itrms/ui';
import { requestErrorMessage } from '../../host/client';
import { cellText } from '../../renderer/runtime/cellText';
import { CellValue } from '../../renderer/cells';
import { getByPath } from '../../core/runtime/expression';
import type { TableColumn } from '@itrms/schemas';
import { useSubmissionData } from '../api';
import { useLookupLabels } from '../../host/lookups';
import { useGridLabels } from '../gridLabels';
import type { ViewModeProps } from '../registry';
import type { ViewField, ViewSchema, ViewRow } from '../types';

const MAX_DEFAULT_VALUE_COLUMNS = 5;

/** Where a field's value sits in a result row. */
const pathOf = (f: ViewField) =>
    f.key === 'submitted_by'
        ? 'submitted_by_name'
        : f.key === 'handling_unit'
          ? 'handling_unit_name'
          : f.builtin
            ? f.key
            : `submission_data.${f.key}`;

/** The cell definition the form engine's table renderer understands, from the server's description of the field. */
export function columnOf(f: ViewField): TableColumn {
    const base = { field: pathOf(f), header: f.label };
    // the office and the submitter are shown by name (the row carries it)
    if (f.key === 'handling_unit' || f.key === 'submitted_by') return { ...base, type: 'text' };
    switch (f.kind) {
        case 'number':
            return f.currency ? { ...base, type: 'currency', currency: f.currency } : { ...base, type: 'number' };
        case 'date':
            return { ...base, type: f.type === 'EthDate' ? 'ethdate' : 'date' };
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
        case 'ref':
            return { ...base, type: 'lookup' };
        default:
            return { ...base, type: f.options.length || f.person ? 'lookup' : 'text' };
    }
}

export function defaultColumns(schema: ViewSchema): string[] {
    const { title } = schema.roles;
    const own = schema.fields.filter((f) => !f.builtin && f.key !== title).map((f) => f.key);
    return [
        ...(title ? [title] : []),
        ...own.slice(0, MAX_DEFAULT_VALUE_COLUMNS - (title ? 1 : 0)),
        'handling_unit',
        'submitted_by',
        'created_at'
    ];
}

const updater = <T,>(change: Parameters<OnChangeFn<T>>[0], current: T): T =>
    typeof change === 'function' ? (change as (old: T) => T)(current) : change;

export default function TableView({
    templateId,
    schema,
    state,
    patch,
    labeler,
    onOpen,
    rowActions,
    emptyMessage
}: ViewModeProps) {
    const { t } = labeler;
    const labels = useGridLabels();
    const keys = useMemo(() => {
        const chosen = state.columns.filter((k) => schema.fields.some((f) => f.key === k));
        return chosen.length ? chosen : defaultColumns(schema);
    }, [state.columns, schema]);

    const sort = state.sort.length ? state.sort : [{ field: 'created_at', desc: true }];
    const { data, isPending, isFetching, error } = useSubmissionData({
        template_id: templateId,
        filter: state.filter,
        search: state.search || undefined,
        sort,
        page: state.page,
        page_size: state.pageSize
    });

    // registry records are shown by name: one request per registry for the whole page
    const refIds = useMemo(() => {
        const wanted = new Map<string, string[]>();
        for (const k of keys) {
            const f = schema.fields.find((x) => x.key === k);
            if (f?.kind !== 'ref' || !f.provider) continue;
            const ids = (data?.items ?? []).flatMap((row) => {
                const v: unknown = getByPath(row, pathOf(f));
                return typeof v === 'string' && v !== '' ? [v] : [];
            });
            wanted.set(f.provider, [...(wanted.get(f.provider) ?? []), ...ids]);
        }
        return wanted;
    }, [keys, schema, data]);
    const refLabels = useLookupLabels(refIds);

    const columns = useMemo<ColumnDef<ViewRow>[]>(() => {
        const cols: ColumnDef<ViewRow>[] = keys.flatMap((k) => {
            const f = schema.fields.find((x) => x.key === k);
            if (!f) return [];
            const col = columnOf(f);
            const lookups = { [col.field]: (f.provider && refLabels.get(f.provider)) || labeler.lookup(f.key) };
            const isTitle = k === schema.roles.title;
            return [
                {
                    id: f.key,
                    accessorFn: (row) => getByPath(row, col.field), // TanStack Table only sorts columns that read a value
                    header: f.label,
                    enableSorting: f.sortable,
                    cell: ({ row }) =>
                        isTitle ? (
                            <button
                                type="button"
                                data-open
                                className="text-left font-semibold hover:underline focus-visible:underline focus-visible:outline-none"
                                onClick={() => onOpen(row.original)}
                                title={cellText(col, row.original, lookups, t)}
                            >
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
                    <IconButton label={t('form-engine.viewer.table.view')} onClick={() => onOpen(row.original)}>
                        <Eye />
                    </IconButton>
                    {rowActions?.(row.original)}
                </div>
            )
        });
        return cols;
    }, [keys, schema, labeler, refLabels, onOpen, rowActions, t]);

    const pagination: PaginationState = { pageIndex: state.page - 1, pageSize: state.pageSize };
    const onPaginationChange: OnChangeFn<PaginationState> = (change) => {
        const next = updater(change, pagination);
        patch(
            next.pageSize !== pagination.pageSize ? { pageSize: next.pageSize, page: 1 } : { page: next.pageIndex + 1 }
        );
    };
    const sorting: SortingState = sort.map((s) => ({ id: s.field, desc: !!s.desc }));
    const onSortingChange: OnChangeFn<SortingState> = (change) =>
        patch({
            sort: updater(change, sorting)
                .slice(0, 1)
                .map((s) => ({ field: s.id, desc: s.desc }))
        });

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-end">
                <Popover>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="sm">
                            <Columns3 />
                            {t('form-engine.viewer.table.columns')}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="end"
                        className="w-60 p-2"
                        aria-label={t('form-engine.viewer.table.chooseColumns')}
                    >
                        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
                            {schema.fields.map((f) => (
                                <Label
                                    key={f.key}
                                    className="cursor-pointer rounded-sm px-2 py-1.5 font-normal hover:bg-accent"
                                >
                                    <Checkbox
                                        id={`col-${f.key}`}
                                        checked={keys.includes(f.key)}
                                        onCheckedChange={(c) =>
                                            patch({
                                                columns:
                                                    c === true ? [...keys, f.key] : keys.filter((k) => k !== f.key),
                                                page: state.page
                                            })
                                        }
                                    />
                                    {f.label}
                                </Label>
                            ))}
                        </div>
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="mt-1"
                            onClick={() => patch({ columns: [], page: state.page })}
                        >
                            {t('form-engine.viewer.table.resetColumns')}
                        </Button>
                    </PopoverContent>
                </Popover>
            </div>
            <DataGrid
                caption={t('form-engine.viewer.table.caption')}
                labels={labels.grid}
                data={data?.items ?? []}
                columns={columns}
                total={data?.total ?? 0}
                getRowId={(r) => r.id}
                pagination={pagination}
                onPaginationChange={onPaginationChange}
                sorting={sorting}
                onSortingChange={onSortingChange}
                loading={isPending}
                fetching={isFetching}
                error={error ? requestErrorMessage(error, undefined, t) : null}
                emptyMessage={
                    state.search || state.filter.items.length
                        ? t('form-engine.viewer.noMatch')
                        : (emptyMessage ?? t('form-engine.viewer.noRequests'))
                }
            />
        </div>
    );
}
