'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { StatusTag, useSubmissionList, useTemplateList, type SubmissionListParams } from '@/form-engine';
import { DataGrid } from '@itrms/ui';
import { getApiErrorMessage } from '@/lib/api/errors';
import { useDirectory } from '@/lib/auth/directory';
import { formatDateTime } from '@/lib/format';

type Row = PaginatedSubmissions['items'][number];
type Filter = Pick<SubmissionListParams, 'status' | 'mine' | 'createdAfter'>;

/**
 * Requests across every form (by status, mine, recent), newest first. Each row opens the request's page; the form name opens
 * that form's data viewer. Filtering, sorting and paging happen on the server.
 */
export function RequestsList({ title, description, filter }: { title: string; description: string; filter: Filter }) {
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
    const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
    const sort = sorting[0] ? `${sorting[0].desc ? '-' : ''}${sorting[0].id}` : undefined;
    const { data, isPending, isFetching, error } = useSubmissionList({
        ...filter,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sort
    });
    const { data: templates } = useTemplateList();
    const { names } = useDirectory();
    const formNames = useMemo(() => new Map((templates ?? []).map((t) => [String(t.id), t.name])), [templates]);

    const columns = useMemo<ColumnDef<Row>[]>(
        () => [
            {
                id: 'request',
                header: 'Request',
                enableSorting: false,
                cell: ({ row }) => (
                    <Link
                        href={`/submitted-forms/template/${row.original.template_id}/${row.original.id}`}
                        className="font-medium text-primary hover:underline"
                        data-request-link
                    >
                        {String(row.original.id).slice(0, 8)}
                    </Link>
                )
            },
            {
                id: 'form',
                header: 'Form',
                enableSorting: false,
                cell: ({ row }) => (
                    <Link href={`/submitted-forms/template/${row.original.template_id}`} className="hover:underline">
                        {formNames.get(String(row.original.template_id)) ?? 'Form'}
                    </Link>
                )
            },
            { id: 'status', header: 'Status', cell: ({ row }) => <StatusTag value={row.original.status} /> },
            {
                id: 'submitted_by',
                header: 'Submitted by',
                enableSorting: false,
                cell: ({ row }) =>
                    row.original.submitted_by ? (names.get(String(row.original.submitted_by)) ?? '—') : '—'
            },
            { id: 'created_at', header: 'Submitted', cell: ({ row }) => formatDateTime(row.original.created_at) },
            { id: 'updated_at', header: 'Updated', cell: ({ row }) => formatDateTime(row.original.updated_at, '—') }
        ],
        [formNames, names]
    );

    return (
        <div className="flex flex-col gap-4" data-requests-list>
            <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <DataGrid
                data={data?.items ?? []}
                columns={columns}
                total={data?.total ?? 0}
                pagination={pagination}
                onPaginationChange={setPagination}
                sorting={sorting}
                onSortingChange={(next) => {
                    setSorting(next);
                    setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
                getRowId={(r) => String(r.id)}
                loading={isPending}
                fetching={isFetching}
                error={error ? getApiErrorMessage(error, 'Could not load the requests') : null}
                emptyMessage="No requests here yet"
                caption={title}
            />
        </div>
    );
}
