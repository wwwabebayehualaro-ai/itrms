'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Banknote } from 'lucide-react';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { Button, DataGrid, StatusBadge, ToggleGroup, ToggleGroupItem } from '@platform/ui';
import { getApiErrorMessage } from '@platform/lib/api/errors';
import { useCan } from '@platform/lib/auth/authHooks';
import { formatCurrency } from '@platform/lib/format';
import { useAccounts, type Account } from '../api';

const STATUS_TONE = { ACTIVE: 'success', DORMANT: 'warning', BLOCKED: 'danger' } as const;

/** The accounts a teller works with (read-only: accounts are opened in the core). */
export function AccountsScreen() {
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
    const [sorting, setSorting] = useState<SortingState>([{ id: 'number', desc: false }]);
    const [status, setStatus] = useState('');
    const canTransact = useCan('bank_txn:create');
    const sort = sorting[0] ? `${sorting[0].desc ? '-' : ''}${sorting[0].id}` : undefined;
    const { data, isPending, isFetching, error } = useAccounts({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize, status: status || undefined, sort });

    const columns = useMemo<ColumnDef<Account>[]>(
        () => [
            { id: 'number', header: 'Account', cell: ({ row }) => <span className="font-mono">{row.original.number}</span> },
            { id: 'holder_name', header: 'Holder', cell: ({ row }) => row.original.holder_name },
            { id: 'branch', header: 'Branch', enableSorting: false, cell: ({ row }) => row.original.branch },
            {
                id: 'status',
                header: 'Status',
                enableSorting: false,
                cell: ({ row }) => <StatusBadge value={row.original.status} label={row.original.status.toLowerCase()} tone={STATUS_TONE[row.original.status]} />
            },
            {
                id: 'balance',
                header: () => <div className="text-right">Available balance</div>,
                enableSorting: false,
                cell: ({ row }) => <div className="text-right tabular-nums">{formatCurrency(row.original.available_balance, row.original.currency)}</div>
            }
        ],
        []
    );

    return (
        <div className="flex flex-col gap-4" data-accounts>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Accounts</h1>
                    <p className="text-sm text-muted-foreground">Customer accounts and what is available on them now.</p>
                </div>
                {canTransact && (
                    <Button asChild>
                        <Link href="/maker/form-intiator">
                            <Banknote />
                            New cash transaction
                        </Link>
                    </Button>
                )}
            </div>
            <ToggleGroup
                type="single"
                variant="outline"
                value={status || 'all'}
                onValueChange={(v) => {
                    if (!v) return;
                    setStatus(v === 'all' ? '' : v);
                    setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
                aria-label="Status"
                className="self-start"
            >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="ACTIVE">Active</ToggleGroupItem>
                <ToggleGroupItem value="DORMANT">Dormant</ToggleGroupItem>
                <ToggleGroupItem value="BLOCKED">Blocked</ToggleGroupItem>
            </ToggleGroup>
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
                getRowId={(r) => r.number}
                loading={isPending}
                fetching={isFetching}
                error={error ? getApiErrorMessage(error, 'Could not load the accounts') : null}
                emptyMessage="No accounts"
                caption="Accounts"
            />
        </div>
    );
}
