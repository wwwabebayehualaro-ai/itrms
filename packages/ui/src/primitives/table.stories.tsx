import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusBadge } from '../controls/StatusBadge';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './table';

const meta = {
    title: 'Primitives/Table',
    component: Table
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

function VehiclesTable({ rows = PEOPLE.length }: { rows?: number }) {
    const words = useTexts({ approved: TEXT.approved, pending: TEXT.pending });
    return (
        <Table>
            <TableCaption>
                <T text={TEXT.registeredVehicles} />
            </TableCaption>
            <TableHeader>
                <TableRow>
                    <TableHead scope="col">
                        <T text={TEXT.plateNumber} />
                    </TableHead>
                    <TableHead scope="col">
                        <T text={TEXT.owner} />
                    </TableHead>
                    <TableHead scope="col">
                        <T text={TEXT.status} />
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {PEOPLE.slice(0, rows).map((p, i) => (
                    <TableRow key={p.plate}>
                        <TableCell>{p.plate}</TableCell>
                        <TableCell>
                            <T text={p.name} />
                        </TableCell>
                        <TableCell>
                            <StatusBadge
                                value={i % 2 ? 'pending' : 'approved'}
                                label={i % 2 ? words.pending : words.approved}
                                tone={i % 2 ? 'warning' : 'success'}
                            />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export const Default: Story = { render: () => <VehiclesTable /> };

export const WithFooter: Story = {
    render: () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead scope="col">
                        <T text={TEXT.owner} />
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                        <T text={TEXT.registeredVehicles} />
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow>
                    <TableCell>
                        <T text={PEOPLE[0].name} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">12</TableCell>
                </TableRow>
                <TableRow>
                    <TableCell>
                        <T text={PEOPLE[1].name} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">7</TableCell>
                </TableRow>
            </TableBody>
            <TableFooter>
                <TableRow>
                    <TableCell>
                        <T text={TEXT.vehicles} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">19</TableCell>
                </TableRow>
            </TableFooter>
        </Table>
    )
};

export const Empty: Story = {
    render: () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead scope="col">
                        <T text={TEXT.plateNumber} />
                    </TableHead>
                    <TableHead scope="col">
                        <T text={TEXT.owner} />
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow>
                    <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                        <T text={TEXT.noRecords} />
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    )
};

export const LongText: Story = {
    render: () => (
        <div className="max-w-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead scope="col">
                            <T text={TEXT.woreda} />
                        </TableHead>
                        <TableHead scope="col">
                            <T text={TEXT.notes} />
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow>
                        <TableCell className="whitespace-normal">
                            <T text={TEXT.longWoreda} />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                            <T text={TEXT.longLabel} />
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>
    )
};
