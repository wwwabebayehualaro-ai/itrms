/**
 * The DataGrid extensions of task 0.4c, each checked in a real browser by its play function: bulk selection, keyboard row
 * navigation, pinned columns that stay in view while the rest scroll, and keyboard column resizing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColumnDef, PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { StatusBadge } from '../controls/StatusBadge';
import { MoneyText } from '../money/MoneyInput';
import { Button } from '../primitives/button';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { T, useText, useTexts, type StoryText } from '../stories/locale';
import { DataGrid, type DataGridLabels } from './DataGrid';

const meta = {
    title: 'Data/DataGrid features',
    parameters: { layout: 'padded' }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const WORDS = {
    selectAll: { am: 'በዚህ ገጽ ያሉትን ሁሉ ምረጥ', en: 'Select all rows on this page' },
    selectRow: { am: '{row}ን ምረጥ', en: 'Select {row}' },
    selected: { am: '{count} ተመርጠዋል', en: '{count} selected' },
    clearSelection: { am: 'ምርጫውን አጽዳ', en: 'Clear the selection' },
    resizeColumn: { am: 'የ{column} ዓምድ ስፋት ቀይር', en: 'Resize the {column} column' },
    printReceipts: { am: 'ደረሰኞችን አትም', en: 'Print receipts' },
    fee: { am: 'ክፍያ', en: 'Fee' },
    actions: { am: 'ተግባራት', en: 'Actions' },
    opened: { am: 'የተከፈተው፦', en: 'Opened:' },
    birr: { am: 'ብር', en: 'Birr' }
} satisfies Record<string, StoryText>;

function useGridLabels(): DataGridLabels {
    return useTexts({
        selectAll: WORDS.selectAll,
        selectRow: WORDS.selectRow,
        selected: WORDS.selected,
        clearSelection: WORDS.clearSelection,
        resizeColumn: WORDS.resizeColumn
    });
}

interface Vehicle {
    plate: string;
    owner: StoryText;
    type: StoryText;
    woreda: StoryText;
    inspected: string;
    feeSantim: bigint;
    approved: boolean;
}

const TYPES = [TEXT.minibus, TEXT.bus, TEXT.truck];
const WOREDAS = [TEXT.sodoZuria, TEXT.damotGale, TEXT.humbo, TEXT.ofa];
// Generated sample rows (not real people or vehicles).
const VEHICLES: Vehicle[] = Array.from({ length: 6 }, (_, i) => ({
    plate: `ኢት-ሀለመ-${String(1201 + i * 37).padStart(4, '0')}`,
    owner: PEOPLE[i % PEOPLE.length]?.name ?? TEXT.owner,
    type: TYPES[i % TYPES.length] ?? TEXT.minibus,
    woreda: WOREDAS[i % WOREDAS.length] ?? TEXT.sodoZuria,
    inspected: `2026-0${(i % 9) + 1}-1${i}`,
    feeSantim: 35000n + BigInt(i) * 12550n,
    approved: i % 3 !== 1
}));

function useVehicleColumns(withActions = false): ColumnDef<Vehicle, unknown>[] {
    const w = useTexts({
        plate: TEXT.plateNumber,
        owner: TEXT.owner,
        type: TEXT.vehicleType,
        woreda: TEXT.woreda,
        inspected: TEXT.inspectionDate,
        fee: WORDS.fee,
        status: TEXT.status,
        approved: TEXT.approved,
        pending: TEXT.pending,
        actions: WORDS.actions,
        open: TEXT.open,
        birr: WORDS.birr
    });
    const columns: ColumnDef<Vehicle, unknown>[] = [
        { accessorKey: 'plate', header: w.plate, size: 150 },
        { id: 'owner', header: w.owner, size: 220, cell: ({ row }) => <T text={row.original.owner} /> },
        { id: 'type', header: w.type, size: 150, cell: ({ row }) => <T text={row.original.type} /> },
        { id: 'woreda', header: w.woreda, size: 160, cell: ({ row }) => <T text={row.original.woreda} /> },
        { accessorKey: 'inspected', header: w.inspected, size: 150 },
        {
            id: 'fee',
            header: w.fee,
            size: 150,
            cell: ({ row }) => <MoneyText santim={row.original.feeSantim} unit={w.birr} />
        },
        {
            id: 'status',
            header: w.status,
            size: 150,
            cell: ({ row }) => (
                <StatusBadge
                    value={row.original.approved ? 'approved' : 'pending'}
                    label={row.original.approved ? w.approved : w.pending}
                    tone={row.original.approved ? 'success' : 'warning'}
                />
            )
        }
    ];
    if (withActions)
        columns.push({
            id: 'actions',
            header: w.actions,
            size: 110,
            cell: ({ row }) => (
                <Button variant="outline" size="sm" aria-label={`${w.open} ${row.original.plate}`}>
                    {w.open}
                </Button>
            )
        });
    return columns;
}

function SelectionGrid() {
    const columns = useVehicleColumns();
    const labels = useGridLabels();
    const caption = useText(TEXT.registeredVehicles);
    const opened = useText(WORDS.opened);
    const print = useText(WORDS.printReceipts);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
    const [selection, setSelection] = useState<RowSelectionState>({});
    const [last, setLast] = useState<string | null>(null);
    return (
        <div className="flex flex-col gap-3">
            <DataGrid
                data={VEHICLES}
                columns={columns}
                total={VEHICLES.length}
                pagination={pagination}
                onPaginationChange={setPagination}
                getRowId={(v) => v.plate}
                getRowLabel={(v) => v.plate}
                caption={caption}
                labels={labels}
                enableRowSelection
                rowSelection={selection}
                onRowSelectionChange={setSelection}
                bulkActions={() => (
                    <Button size="sm" variant="outline">
                        {print}
                    </Button>
                )}
                onRowActivate={(v) => setLast(v.plate)}
            />
            <p data-testid="opened" className="text-sm">
                {opened} {last ?? '—'}
            </p>
        </div>
    );
}

const dataRows = (canvasElement: HTMLElement) =>
    Array.from(canvasElement.querySelectorAll<HTMLTableRowElement>('tbody tr'));

/** Select all on the page, see the count and the bulk actions, then clear the selection. */
export const BulkSelection: Story = {
    render: () => <SelectionGrid />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const [all] = canvas.getAllByRole('checkbox');
        if (!all) throw new Error('no select-all checkbox');
        await userEvent.click(all);
        const bar = await canvas.findByRole('region');
        await expect(bar).toHaveTextContent(String(VEHICLES.length));
        for (const row of dataRows(canvasElement)) await expect(row).toHaveAttribute('data-state', 'selected');
        await expect(all).toHaveAttribute('data-state', 'checked');

        // one row off: the header box shows a mixed state
        const second = canvas.getAllByRole('checkbox')[2];
        if (!second) throw new Error('no row checkbox');
        await userEvent.click(second);
        await expect(all).toHaveAttribute('data-state', 'indeterminate');
        await expect(bar).toHaveTextContent(String(VEHICLES.length - 1));

        await userEvent.click(within(bar).getAllByRole('button').at(-1) as HTMLElement);
        await waitFor(() => expect(canvas.queryByRole('region')).toBeNull());
        for (const row of dataRows(canvasElement)) await expect(row).not.toHaveAttribute('data-state');
        // the clear button went with its bar; focus is back on the grid's active row (the one clicked), not lost to the page
        await waitFor(() => expect(dataRows(canvasElement)[1]).toHaveFocus());
        await expect(dataRows(canvasElement)[1]).toHaveAttribute('tabindex', '0');
    }
};

/** Rows take arrow-key focus: one tab stop, arrows, Home and End move, Space selects, Enter opens. */
export const KeyboardRows: Story = {
    render: () => <SelectionGrid />,
    play: async ({ canvasElement }) => {
        const rows = dataRows(canvasElement);
        const [first, second] = rows;
        const last = rows.at(-1);
        if (!first || !second || !last) throw new Error('rows not rendered');
        await expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);

        first.focus();
        await userEvent.keyboard('{ArrowDown}');
        await expect(second).toHaveFocus();
        await userEvent.keyboard(' ');
        await waitFor(() => expect(second).toHaveAttribute('data-state', 'selected'));
        await userEvent.keyboard('{End}');
        await expect(last).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}'); // stays on the last row
        await expect(last).toHaveFocus();
        await userEvent.keyboard('{Home}');
        await expect(first).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        await expect(within(canvasElement).getByTestId('opened')).toHaveTextContent(VEHICLES[0]?.plate ?? '');
        // the focused row is the one tab stop
        await expect(rows.filter((r) => r.tabIndex === 0)).toEqual([first]);
    }
};

function PinnedGrid() {
    const columns = useVehicleColumns(true);
    const caption = useText(TEXT.registeredVehicles);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
    return (
        <div className="max-w-xl" data-testid="frame">
            <DataGrid
                data={VEHICLES}
                columns={columns}
                total={VEHICLES.length}
                pagination={pagination}
                onPaginationChange={setPagination}
                getRowId={(v) => v.plate}
                caption={caption}
                columnPinning={{ left: ['plate'], right: ['actions'] }}
            />
        </div>
    );
}

/** In a narrow frame the plate and the actions stay in view while the middle columns scroll. */
export const PinnedColumns: Story = {
    render: () => <PinnedGrid />,
    play: async ({ canvasElement }) => {
        const scroller = canvasElement.querySelector<HTMLElement>('[data-slot="table-container"]');
        const headers = Array.from(canvasElement.querySelectorAll<HTMLElement>('thead th'));
        const plate = headers[0];
        const actions = headers.at(-1);
        const owner = headers[1];
        if (!scroller || !plate || !actions || !owner) throw new Error('not rendered');
        await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
        const box = scroller.getBoundingClientRect();
        const ownerBefore = owner.getBoundingClientRect().left;

        scroller.scrollLeft = 200;
        await waitFor(() => expect(owner.getBoundingClientRect().left).toBeLessThan(ownerBefore - 150));
        await expect(Math.round(plate.getBoundingClientRect().left)).toBe(Math.round(box.left));
        await expect(Math.round(actions.getBoundingClientRect().right)).toBeLessThanOrEqual(Math.round(box.right));
        await expect(Math.round(actions.getBoundingClientRect().right)).toBeGreaterThan(Math.round(box.right) - 2);
        scroller.scrollLeft = 0; // the screenshot shows the start of the table
    }
};

function ResizableGrid() {
    const columns = useVehicleColumns();
    const labels = useGridLabels();
    const caption = useText(TEXT.registeredVehicles);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
    const [sorting, setSorting] = useState<SortingState>([]);
    return (
        <DataGrid
            data={VEHICLES.slice(0, 3)}
            columns={columns}
            total={3}
            pagination={pagination}
            onPaginationChange={setPagination}
            sorting={sorting}
            onSortingChange={setSorting}
            getRowId={(v) => v.plate}
            caption={caption}
            labels={labels}
            enableColumnResizing
        />
    );
}

/**
 * A column's edge is a separator: the arrow keys widen and narrow the column, as dragging does, within 40–1000 px. Neither
 * Enter on a handle nor a drag that ends over the header text sorts the column.
 */
export const ResizableColumns: Story = {
    render: () => <ResizableGrid />,
    play: async ({ canvasElement }) => {
        const handles = within(canvasElement).getAllByRole('separator');
        const [plate, owner] = handles;
        const th = owner?.closest('th');
        const plateTh = plate?.closest('th');
        const plateLabel = plateTh?.querySelector('span');
        if (!plate || !owner || !th || !plateTh || !plateLabel) throw new Error('no resize handle');
        await expect(owner).toHaveAttribute('aria-valuemin', '40');
        await expect(owner).toHaveAttribute('aria-valuemax', '1000');
        const before = Number(owner.getAttribute('aria-valuenow'));
        const widthBefore = th.getBoundingClientRect().width;

        owner.focus();
        await userEvent.keyboard('{ArrowRight}{ArrowRight}');
        await waitFor(() => expect(Number(owner.getAttribute('aria-valuenow'))).toBe(before + 32));
        await waitFor(() => expect(th.getBoundingClientRect().width).toBeCloseTo(widthBefore + 32, 0));

        await userEvent.keyboard('{ArrowLeft}');
        await waitFor(() => expect(Number(owner.getAttribute('aria-valuenow'))).toBe(before + 16));
        // Enter on a handle never sorts the column
        plate.focus();
        await userEvent.keyboard('{Enter}');
        await expect(plateTh).toHaveAttribute('aria-sort', 'none');

        // a drag from the handle that is released over the header text
        await userEvent.pointer([
            { keys: '[MouseLeft>]', target: plate },
            { target: plateLabel },
            { keys: '[/MouseLeft]', target: plateLabel }
        ]);
        await expect(plateTh).toHaveAttribute('aria-sort', 'none');
        await userEvent.dblClick(plate); // back to its width, so the screenshot doesn't depend on the drag
        // a plain click on the header still sorts
        await userEvent.click(plateLabel);
        await waitFor(() => expect(plateTh).toHaveAttribute('aria-sort', 'ascending'));
    }
};
