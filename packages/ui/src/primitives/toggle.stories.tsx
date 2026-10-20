import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bold } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Toggle } from './toggle';

const meta = {
    title: 'Primitives/Toggle',
    component: Toggle
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

function IconDemo({ variant, pressed }: { variant?: 'default' | 'outline'; pressed?: boolean }) {
    const label = useText(TEXT.bold);
    return (
        <Toggle aria-label={label} variant={variant} defaultPressed={pressed}>
            <Bold aria-hidden="true" />
        </Toggle>
    );
}

export const Default: Story = { render: () => <IconDemo /> };

export const Outline: Story = { render: () => <IconDemo variant="outline" /> };

export const Pressed: Story = { render: () => <IconDemo pressed variant="outline" /> };

export const Disabled: Story = {
    render: () => (
        <Toggle disabled variant="outline">
            <T text={TEXT.bold} />
        </Toggle>
    )
};
