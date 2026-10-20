import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Input } from './input';
import { Label } from './label';

const meta = {
    title: 'Primitives/Label',
    component: Label
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="father">
                <T text={TEXT.fatherName} />
            </Label>
            <Input id="father" />
        </div>
    )
};

/** A label that wraps over several lines stays attached to its input. */
export const LongText: Story = {
    render: () => (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="origin">
                <T text={TEXT.longLabel} />
            </Label>
            <Input id="origin" />
        </div>
    )
};
