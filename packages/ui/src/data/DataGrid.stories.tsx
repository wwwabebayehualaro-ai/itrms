import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';

import { StatusBadge } from '../controls/StatusBadge';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { T, useTexts, type StoryText } from '../stories/locale';
import { DataGrid } from './DataGrid';

const meta = {
    title: 'Data/DataGrid',
    component: DataGrid,
    // required by the type; every story renders its own grid
    args: {
        data: [],
        columns: [],
        total: 0,
        pagination: { pageIndex: 0, pageSize: 10 },
        onPaginationChange: () => undefined
    }
} satisfies Meta<typeof DataGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

interface Row {
    plate: string;
    owner: StoryText;
    approved: boolean;
}

const ROWS: Row[] = PEOPLE.map((p, i) => ({ plate: p.plate, owner: p.name, approved: i % 2 === 0 }));
const LONG_ROWS: Row[] = [{ plate: 'ETH-ABC-0001', owner: TEXT.longWoreda, approved: false }];

function useColumns(): ColumnDef<Row, unknown>[] {
    const words = useTexts({
        plate: TEXT.plateNumber,
        owner: TEXT.owner,
        status: TEXT.status,
        approved: TEXT.approved,
        pending: TEXT.pending
    });
    return [
        { accessorKey: 'plate', header: words.plate },
        {
            accessorKey: 'owner',
            header: words.owner,
            cell: ({ row }) => <T text={row.original.owner} />
        },
        {
            accessorKey: 'approved',
            header: words.status,
            enableSorting: false,
            cell: ({ row }) => (
                <StatusBadge
                    value={row.original.approved ? 'approved' : 'pending'}
                    label={row.original.approved ? words.approved : words.pending}
                    tone={row.original.approved ? 'success' : 'warning'}
                />
            )
        }
    ];
}

function GridDemo({
    rows = ROWS,
    total = rows.length,
    loading,
    error,
    empty
}: {
    rows?: Row[];
    total?: number;
    loading?: boolean;
    error?: boolean;
    empty?: boolean;
}) {
    const columns = useColumns();
    const words = useTexts({ caption: TEXT.registeredVehicles, empty: TEXT.noRecords, failed: TEXT.failed });
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
    const [sorting, setSorting] = useState<SortingState>([{ id: 'plate', desc: false }]);
    return (
        <DataGrid
            data={empty ? [] : rows}
            columns={columns}
            total={empty ? 0 : total}
            pagination={pagination}
            onPaginationChange={setPagination}
            sorting={sorting}
            onSortingChange={setSorting}
            getRowId={(r) => r.plate}
            loading={loading}
            error={error ? words.failed : null}
            emptyMessage={words.empty}
            caption={words.caption}
        />
    );
}

export const Default: Story = { render: () => <GridDemo /> };

export const Loading: Story = { render: () => <GridDemo loading /> };

export const Empty: Story = { render: () => <GridDemo empty /> };

export const Failed: Story = { render: () => <GridDemo error /> };

export const LongText: Story = {
    render: () => (
        <div className="max-w-xl">
            <GridDemo rows={LONG_ROWS} />
        </div>
    )
};
