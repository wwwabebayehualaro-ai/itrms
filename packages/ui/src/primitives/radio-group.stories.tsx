import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio-group';

const meta = {
    title: 'Primitives/RadioGroup',
    component: RadioGroup
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const CHOICES = [
    { value: 'minibus', text: TEXT.minibus },
    { value: 'bus', text: TEXT.bus },
    { value: 'truck', text: TEXT.truck }
] as const;

function Choices({ prefix, disabled }: { prefix: string; disabled?: boolean }) {
    const label = useText(TEXT.vehicleType);
    return (
        <RadioGroup defaultValue="bus" disabled={disabled} aria-label={label}>
            {CHOICES.map((c) => (
                <div key={c.value} className="flex items-center gap-2">
                    <RadioGroupItem value={c.value} id={`${prefix}-${c.value}`} disabled={disabled} />
                    <Label htmlFor={`${prefix}-${c.value}`}>
                        <T text={c.text} />
                    </Label>
                </div>
            ))}
        </RadioGroup>
    );
}

export const Default: Story = { render: () => <Choices prefix="default" /> };

export const Disabled: Story = { render: () => <Choices prefix="off" disabled /> };

function LongTextDemo() {
    const label = useText(TEXT.woreda);
    return (
        <RadioGroup defaultValue="a" className="max-w-xs" aria-label={label}>
            <div className="flex items-start gap-2">
                <RadioGroupItem value="a" id="long-a" className="mt-1" />
                <Label htmlFor="long-a">
                    <T text={TEXT.longWoreda} />
                </Label>
            </div>
            <div className="flex items-start gap-2">
                <RadioGroupItem value="b" id="long-b" className="mt-1" />
                <Label htmlFor="long-b">
                    <T text={TEXT.longLabel} />
                </Label>
            </div>
        </RadioGroup>
    );
}

export const LongText: Story = { render: () => <LongTextDemo /> };
