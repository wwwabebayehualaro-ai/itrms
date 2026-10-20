import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

const meta = {
    title: 'Primitives/ToggleGroup',
    component: ToggleGroup,
    // required by the type; every story renders its own group
    args: { type: 'single' }
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function SingleDemo({ disabled }: { disabled?: boolean }) {
    const label = useText(TEXT.vehicleType);
    return (
        <ToggleGroup type="single" variant="outline" defaultValue="bus" aria-label={label} disabled={disabled}>
            <ToggleGroupItem value="minibus">
                <T text={TEXT.minibus} />
            </ToggleGroupItem>
            <ToggleGroupItem value="bus">
                <T text={TEXT.bus} />
            </ToggleGroupItem>
            <ToggleGroupItem value="truck">
                <T text={TEXT.truck} />
            </ToggleGroupItem>
        </ToggleGroup>
    );
}

export const Single: Story = { render: () => <SingleDemo /> };

export const Disabled: Story = { render: () => <SingleDemo disabled /> };

function MultipleDemo() {
    const label = useText(TEXT.vehicleType);
    return (
        <ToggleGroup type="multiple" variant="outline" defaultValue={['minibus', 'truck']} aria-label={label}>
            <ToggleGroupItem value="minibus">
                <T text={TEXT.minibus} />
            </ToggleGroupItem>
            <ToggleGroupItem value="bus">
                <T text={TEXT.bus} />
            </ToggleGroupItem>
            <ToggleGroupItem value="truck">
                <T text={TEXT.truck} />
            </ToggleGroupItem>
        </ToggleGroup>
    );
}

export const Multiple: Story = { render: () => <MultipleDemo /> };
