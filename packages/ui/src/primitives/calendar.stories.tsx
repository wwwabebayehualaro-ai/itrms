import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DateRange } from 'react-day-picker';
import { useState } from 'react';

import { Calendar } from './calendar';

const meta = {
    title: 'Primitives/Calendar',
    component: Calendar
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

// A fixed month and day so screenshots do not change with the date the tests run.
const MONTH = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-09-11T00:00:00Z');

function SingleDemo() {
    const [selected, setSelected] = useState<Date | undefined>(DAY);
    return (
        <Calendar
            mode="single"
            defaultMonth={MONTH}
            selected={selected}
            onSelect={setSelected}
            timeZone="UTC"
            className="rounded-md border"
        />
    );
}

export const Default: Story = { render: () => <SingleDemo /> };

function RangeDemo() {
    const [range, setRange] = useState<DateRange | undefined>({
        from: new Date('2026-09-08T00:00:00Z'),
        to: new Date('2026-09-14T00:00:00Z')
    });
    return (
        <Calendar
            mode="range"
            defaultMonth={MONTH}
            selected={range}
            onSelect={setRange}
            timeZone="UTC"
            className="rounded-md border"
        />
    );
}

export const Range: Story = { render: () => <RangeDemo /> };

export const DisabledDays: Story = {
    render: () => (
        <Calendar
            mode="single"
            defaultMonth={MONTH}
            selected={DAY}
            disabled={{ before: DAY }}
            timeZone="UTC"
            className="rounded-md border"
        />
    )
};
