import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Input } from './input';
import { Label } from './label';

const meta = {
    title: 'Primitives/Input',
    component: Input
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

function DefaultDemo() {
    const placeholder = useText(TEXT.applicantName);
    return (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="name">
                <T text={TEXT.applicantName} />
            </Label>
            <Input id="name" placeholder={placeholder} />
        </div>
    );
}

export const Default: Story = { render: () => <DefaultDemo /> };

export const Disabled: Story = {
    render: () => (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="plate">
                <T text={TEXT.plateNumber} />
            </Label>
            <Input id="plate" disabled defaultValue="ETH-ABC-7788" />
        </div>
    )
};

export const Invalid: Story = {
    render: () => (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="phone">
                <T text={TEXT.phone} />
            </Label>
            <Input id="phone" aria-invalid="true" aria-describedby="phone-error" />
            <small id="phone-error" className="text-destructive">
                <T text={TEXT.requiredError} />
            </small>
        </div>
    )
};

function LongTextDemo() {
    const value = useText(TEXT.longWoreda);
    return (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="long">
                <T text={TEXT.longLabel} />
            </Label>
            <Input id="long" defaultValue={value} />
        </div>
    );
}

export const LongText: Story = { render: () => <LongTextDemo /> };
