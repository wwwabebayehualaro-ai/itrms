import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pencil, Trash2 } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { useText } from '../stories/locale';
import { IconButton } from './IconButton';

const meta = {
    title: 'Controls/IconButton',
    component: IconButton,
    // required by the type; every story renders its own button
    args: { label: '', children: null }
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

function DefaultDemo() {
    const label = useText(TEXT.edit);
    return (
        <IconButton label={label}>
            <Pencil aria-hidden="true" />
        </IconButton>
    );
}

export const Default: Story = { render: () => <DefaultDemo /> };

function VariantsDemo() {
    const edit = useText(TEXT.edit);
    const remove = useText(TEXT.remove);
    return (
        <div className="flex items-center gap-2">
            <IconButton label={edit} variant="outline">
                <Pencil aria-hidden="true" />
            </IconButton>
            <IconButton label={remove} variant="destructive">
                <Trash2 aria-hidden="true" />
            </IconButton>
            <IconButton label={remove} disabled>
                <Trash2 aria-hidden="true" />
            </IconButton>
        </div>
    );
}

export const Variants: Story = { render: () => <VariantsDemo /> };

/** The tooltip can say more than the accessible name. */
function LongTooltipDemo() {
    const label = useText(TEXT.edit);
    const tooltip = useText(TEXT.longLabel);
    return (
        <IconButton label={label} tooltip={tooltip} side="right">
            <Pencil aria-hidden="true" />
        </IconButton>
    );
}

export const LongTooltip: Story = { render: () => <LongTooltipDemo /> };
