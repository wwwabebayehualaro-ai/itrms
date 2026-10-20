import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Trash2 } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';

const meta = {
    title: 'Primitives/Button',
    component: Button,
    argTypes: {
        variant: { control: 'select', options: ['default', 'secondary', 'outline', 'ghost', 'link', 'destructive'] },
        size: { control: 'select', options: ['default', 'sm', 'lg', 'xs'] }
    }
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The primary action of a screen; one per view. */
export const Default: Story = {
    render: (args) => (
        <Button {...args}>
            <T text={TEXT.submit} />
        </Button>
    )
};

/** Every variant with a label in the active language. Amharic labels are taller; the height comes from --field-height. */
export const Variants: Story = {
    render: () => (
        <div className="flex flex-wrap items-center gap-3">
            {(['default', 'secondary', 'outline', 'ghost', 'link'] as const).map((variant) => (
                <Button key={variant} variant={variant}>
                    <T text={TEXT.save} />
                </Button>
            ))}
            <Button variant="destructive">
                <Trash2 aria-hidden="true" />
                <T text={TEXT.delete} />
            </Button>
        </div>
    )
};

export const WithIcon: Story = {
    render: () => (
        <Button>
            <Plus aria-hidden="true" />
            <T text={TEXT.newApplication} />
        </Button>
    )
};

export const Disabled: Story = {
    render: () => (
        <Button disabled>
            <T text={TEXT.submit} />
        </Button>
    )
};
