import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Label } from './label';
import { Slider } from './slider';

const meta = {
    title: 'Primitives/Slider',
    component: Slider
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

function CapacityDemo({ disabled }: { disabled?: boolean }) {
    const label = useText(TEXT.capacity);
    return (
        <div className="flex max-w-sm flex-col gap-3">
            <Label id="capacity-label">
                <T text={TEXT.capacity} />
            </Label>
            <Slider defaultValue={[45]} max={100} step={1} disabled={disabled} aria-label={label} />
        </div>
    );
}

export const Default: Story = { render: () => <CapacityDemo /> };

export const Disabled: Story = { render: () => <CapacityDemo disabled /> };

function RangeDemo() {
    const label = useText(TEXT.capacity);
    return (
        <div className="flex max-w-sm flex-col gap-3">
            <Label id="range-label">
                <T text={TEXT.capacity} />
            </Label>
            <Slider defaultValue={[20, 60]} max={100} step={1} aria-label={label} />
        </div>
    );
}

export const Range: Story = { render: () => <RangeDemo /> };
