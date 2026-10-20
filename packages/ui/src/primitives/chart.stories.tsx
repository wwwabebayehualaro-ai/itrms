import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';

import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from './chart';
import type { ChartConfig } from './chart';

const meta = {
    title: 'Primitives/Chart',
    component: ChartContainer,
    // required by the type; every story renders its own chart
    args: { config: {}, children: <BarChart data={[]} /> }
} satisfies Meta<typeof ChartContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

const MONTHS = ['month1', 'month2', 'month3', 'month4'] as const;
const VALUES = [
    { registrations: 186, renewals: 80 },
    { registrations: 305, renewals: 200 },
    { registrations: 237, renewals: 120 },
    { registrations: 173, renewals: 190 }
];

function ChartDemo({ withLegend, width }: { withLegend?: boolean; width?: number }) {
    const words = useTexts({
        month1: TEXT.month1,
        month2: TEXT.month2,
        month3: TEXT.month3,
        month4: TEXT.month4,
        registrations: TEXT.registrations,
        renewals: TEXT.renewals
    });
    const data = MONTHS.map((m, i) => ({ month: words[m], ...VALUES[i] }));
    const config = {
        registrations: { label: words.registrations, color: 'var(--chart-1)' },
        renewals: { label: words.renewals, color: 'var(--chart-2)' }
    } satisfies ChartConfig;
    return (
        <ChartContainer
            config={config}
            className="min-h-48 max-w-xl"
            initialDimension={{ width: width ?? 520, height: 260 }}
            role="img"
            aria-label={words.registrations}
        >
            <BarChart accessibilityLayer data={data}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {withLegend && <ChartLegend content={<ChartLegendContent />} />}
                <Bar dataKey="registrations" fill="var(--color-registrations)" radius={4} isAnimationActive={false} />
                <Bar dataKey="renewals" fill="var(--color-renewals)" radius={4} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

export const Default: Story = { render: () => <ChartDemo /> };

export const WithLegend: Story = { render: () => <ChartDemo withLegend /> };

/** A narrow container: the Amharic month names still fit on the axis. */
export const Narrow: Story = { render: () => <ChartDemo withLegend width={300} /> };
