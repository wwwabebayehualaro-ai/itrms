import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Separator } from './separator';

const meta = {
    title: 'Primitives/Separator',
    component: Separator
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
    render: () => (
        <div className="max-w-sm space-y-3">
            <p>
                <T text={TEXT.registeredVehicles} />
            </p>
            <Separator />
            <p>
                <T text={TEXT.applications} />
            </p>
        </div>
    )
};

export const Vertical: Story = {
    render: () => (
        <div className="flex h-6 items-center gap-3">
            <span>
                <T text={TEXT.dashboard} />
            </span>
            <Separator orientation="vertical" />
            <span>
                <T text={TEXT.reports} />
            </span>
            <Separator orientation="vertical" />
            <span>
                <T text={TEXT.inspections} />
            </span>
        </div>
    )
};
