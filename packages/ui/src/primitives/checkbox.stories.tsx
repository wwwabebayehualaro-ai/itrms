import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Checkbox } from './checkbox';
import { Label } from './label';

const meta = {
    title: 'Primitives/Checkbox',
    component: Checkbox
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <div className="flex items-center gap-2">
            <Checkbox id="terms" />
            <Label htmlFor="terms">
                <T text={TEXT.agreeTerms} />
            </Label>
        </div>
    )
};

export const Checked: Story = {
    render: () => (
        <div className="flex items-center gap-2">
            <Checkbox id="sms" defaultChecked />
            <Label htmlFor="sms">
                <T text={TEXT.notifySms} />
            </Label>
        </div>
    )
};

export const Disabled: Story = {
    render: () => (
        <div className="flex items-center gap-2">
            <Checkbox id="terms-off" disabled />
            <Label htmlFor="terms-off">
                <T text={TEXT.agreeTerms} />
            </Label>
        </div>
    )
};

export const Invalid: Story = {
    render: () => (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <Checkbox id="terms-bad" aria-invalid="true" aria-describedby="terms-bad-error" />
                <Label htmlFor="terms-bad">
                    <T text={TEXT.agreeTerms} />
                </Label>
            </div>
            <small id="terms-bad-error" className="text-destructive">
                <T text={TEXT.requiredError} />
            </small>
        </div>
    )
};

export const LongText: Story = {
    render: () => (
        <div className="flex max-w-xs items-start gap-2">
            <Checkbox id="long" className="mt-1" />
            <Label htmlFor="long">
                <T text={TEXT.longLabel} />
            </Label>
        </div>
    )
};
