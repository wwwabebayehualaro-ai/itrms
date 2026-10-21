'use client';

/**
 * DataTable field on the design system: rows from a template data source (`data.rowsBinding`) or the static `value`, columns
 * from the `columns` property, search, CSV export, sorting, paging and row buttons (reported as `ROW_ACTION_EVENT`).
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Eye, Pencil, Search, Trash2 } from 'lucide-react';
import { Button, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@itrms/ui';
import { useCan } from '../../host/FormsHost';
import { saveBlob } from '@itrms/ui';
import { cellText, type LookupMaps } from '../runtime/cellText';
import { getByPath } from '../../core/runtime/expression';
import { toOptions } from '../../core/runtime/mapping';
import type { TableColumn } from '@itrms/schemas';
import { ROW_ACTION_EVENT, type RowActionDetail } from '../runtime/rowActions';
import { CellValue as Cell } from '../cells';
import { defineFieldType, type DisplayFieldProps } from '../kit';
import { useRuntimeApi, useRuntimeSelector } from '../runtimeScope';

function DataTableView({ field }: DisplayFieldProps) {
    const api = useRuntimeApi();
    const binding = field.rowsBinding;
    const columns: TableColumn[] = useMemo(
        () => (Array.isArray(field.props.columns) ? (field.props.columns as TableColumn[]) : []),
        [field.props.columns]
    );
    const state = useRuntimeSelector((s) => (binding ? s.states[binding.dataSourceId] : undefined));
    const lookupStates = useRuntimeSelector((s) => s.states);
    const runtimeData = useRuntimeSelector((s) => s.scope.data as Record<string, unknown> | undefined);

    const rows = useMemo(() => {
        if (!binding) {
            const value = field.props.value;
            const fallback = (field.source.data?.dataSource as { staticData?: unknown } | undefined)?.staticData;
            return ((Array.isArray(value) && value.length ? value : fallback) as unknown[]) || [];
        }
        const data = state?.data;
        const list = binding.itemsPath
            ? getByPath(data, binding.itemsPath)
            : Array.isArray(data)
              ? data
              : getByPath(data, 'items');
        return Array.isArray(list) ? (list as unknown[]) : [];
    }, [binding, state?.data, field.props.value, field.source.data]);

    // value -> label maps for columns that show names instead of stored values (ids, option values)
    const lookups = useMemo<LookupMaps>(() => {
        const out: LookupMaps = {};
        for (const col of columns) {
            if (!col.lookupSource) continue;
            const data = (lookupStates[col.lookupSource]?.data ?? runtimeData?.[col.lookupSource]) as
                Record<string, any> | undefined;
            const fields =
                data?.form_config?.fields ?? (Array.isArray(data?.form_config) ? data.form_config : undefined);
            if (Array.isArray(fields)) {
                // the lookup source is a form template: the options of the field this column shows (last part of the path)
                const f = fields.find((x: any) => x.id === col.field.split('.').pop());
                const opts = (
                    (f?.data?.dataSource?.staticData ?? f?.props?.options ?? []) as { label: string; value: unknown }[]
                ).filter(Boolean);
                out[col.field] = new Map(opts.map((o) => [String(o.value), o.label]));
            } else {
                out[col.field] = new Map(
                    toOptions(data, api.getDataSource(col.lookupSource)?.responseMapping?.options).map((o) => [
                        String(o.value),
                        o.label
                    ])
                );
            }
        }
        return out;
    }, [columns, lookupStates, runtimeData, api]);

    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ field: string; desc: boolean } | null>(null);
    const [page, setPage] = useState(0);
    const pageSize = Number(field.props.rows) > 0 ? Number(field.props.rows) : 10;
    const paged = Boolean(field.props.paginator);

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = q
            ? rows.filter((r) => columns.some((c) => cellText(c, r, lookups).toLowerCase().includes(q)))
            : rows;
        if (sort) {
            const col = columns.find((c) => c.field === sort.field);
            if (col) {
                const key = (r: unknown) => {
                    const v = getByPath(r, col.field);
                    return typeof v === 'number' ? v : cellText(col, r, lookups).toLowerCase();
                };
                list = [...list].sort((a, b) => {
                    const x = key(a);
                    const y = key(b);
                    return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
                });
            }
        }
        return list;
    }, [rows, columns, lookups, search, sort]);
    const pages = paged ? Math.max(1, Math.ceil(shown.length / pageSize)) : 1;
    const current = Math.min(page, pages - 1);
    const visible = paged ? shown.slice(current * pageSize, current * pageSize + pageSize) : shown;

    const exportCsv = () => {
        const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const lines = [
            columns.map((c) => cell(c.header || c.field)).join(','),
            ...shown.map((r) => columns.map((c) => cell(cellText(c, r, lookups))).join(','))
        ];
        saveBlob(
            new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
            `${(field.label || 'export').replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`
        );
    };
    const emit = (action: RowActionDetail['action'], row: unknown) =>
        window.dispatchEvent(
            new CustomEvent<RowActionDetail>(ROW_ACTION_EVENT, { detail: { action, row, fieldId: field.id } })
        );
    // a button is shown only to people the backend would let use it (defaults are the submission permissions; override per table)
    const canEdit = useCan(String(field.props.editPermission || 'submission:update'));
    const canDelete = useCan(String(field.props.deletePermission || 'submission:delete'));
    const showView = Boolean(field.props.showView);
    const showEdit = Boolean(field.props.showEdit) && canEdit;
    const showDelete = Boolean(field.props.showDelete) && canDelete;
    const loading = !!binding && (state?.status === 'loading' || (state?.isFetching ?? false));
    const lookupLoading = (col: TableColumn) =>
        !!col.lookupSource &&
        lookupStates[col.lookupSource]?.status === 'loading' &&
        lookupStates[col.lookupSource]?.data === undefined;
    const empty =
        state?.error ??
        (search && rows.length > 0 ? `Nothing matches “${search}”` : (binding?.emptyMessage ?? 'No records'));

    return (
        <div className="flex flex-col gap-2" data-field-table={field.id}>
            {Boolean(field.props.showSearch || field.props.allowExport) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {field.props.showSearch ? (
                        <div className="relative w-full max-w-xs">
                            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(0);
                                }}
                                placeholder="Search…"
                                aria-label="Search the table"
                                className="pl-8"
                            />
                        </div>
                    ) : (
                        <span />
                    )}
                    {Boolean(field.props.allowExport) && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={exportCsv}
                            disabled={shown.length === 0}
                        >
                            <Download />
                            Export CSV
                        </Button>
                    )}
                </div>
            )}
            <div
                className="overflow-x-auto rounded-md border"
                style={
                    field.props.scrollable && field.props.scrollHeight
                        ? { maxHeight: String(field.props.scrollHeight), overflowY: 'auto' }
                        : undefined
                }
            >
                <Table>
                    <TableHeader>
                        <TableRow>
                            {columns.map((col) => (
                                <TableHead
                                    key={col.field}
                                    aria-sort={
                                        sort?.field === col.field ? (sort.desc ? 'descending' : 'ascending') : undefined
                                    }
                                >
                                    {col.sortable ? (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1"
                                            onClick={() =>
                                                setSort((s) =>
                                                    s?.field === col.field
                                                        ? s.desc
                                                            ? null
                                                            : { field: col.field, desc: true }
                                                        : { field: col.field, desc: false }
                                                )
                                            }
                                        >
                                            {col.header}
                                            {sort?.field === col.field &&
                                                (sort.desc ? (
                                                    <ArrowDown className="size-3" />
                                                ) : (
                                                    <ArrowUp className="size-3" />
                                                ))}
                                        </button>
                                    ) : (
                                        col.header
                                    )}
                                </TableHead>
                            ))}
                            {(showView || showEdit || showDelete) && <TableHead className="w-px">Actions</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading && visible.length === 0
                            ? Array.from({ length: 3 }, (_, i) => (
                                  <TableRow key={i}>
                                      {columns.map((c) => (
                                          <TableCell key={c.field}>
                                              <Skeleton className="h-4 w-24" />
                                          </TableCell>
                                      ))}
                                  </TableRow>
                              ))
                            : visible.map((row, i) => (
                                  <TableRow key={String((row as { id?: unknown })?.id ?? i)}>
                                      {columns.map((col) => (
                                          <TableCell key={col.field}>
                                              {lookupLoading(col) ? (
                                                  <Skeleton className="h-4 w-24" />
                                              ) : (
                                                  <Cell col={col} row={row} lookups={lookups} />
                                              )}
                                          </TableCell>
                                      ))}
                                      {(showView || showEdit || showDelete) && (
                                          <TableCell className="whitespace-nowrap">
                                              {showView && (
                                                  <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={() => emit('view', row)}
                                                  >
                                                      <Eye />
                                                      View
                                                  </Button>
                                              )}
                                              {showEdit && (
                                                  <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={() => emit('edit', row)}
                                                  >
                                                      <Pencil />
                                                      Edit
                                                  </Button>
                                              )}
                                              {showDelete && (
                                                  <Button
                                                      type="button"
                                                      variant="ghost"
                                                      size="sm"
                                                      className="text-destructive"
                                                      onClick={() => emit('delete', row)}
                                                  >
                                                      <Trash2 />
                                                      Delete
                                                  </Button>
                                              )}
                                          </TableCell>
                                      )}
                                  </TableRow>
                              ))}
                        {!loading && visible.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length + (showView || showEdit || showDelete ? 1 : 0)}
                                    className="py-6 text-center text-muted-foreground"
                                >
                                    {empty}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            {paged && shown.length > pageSize && (
                <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">
                        {current * pageSize + 1}–{Math.min(shown.length, (current + 1) * pageSize)} of {shown.length}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="Previous page"
                        disabled={current === 0}
                        onClick={() => setPage(current - 1)}
                    >
                        <ChevronLeft />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="Next page"
                        disabled={current >= pages - 1}
                        onClick={() => setPage(current + 1)}
                    >
                        <ChevronRight />
                    </Button>
                </div>
            )}
        </div>
    );
}

defineFieldType({
    kind: 'display',
    type: 'DataTable',
    Render: DataTableView,
    supports: (f) => !!f.rowsBinding || !f.props.selectionMode
});
