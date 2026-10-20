import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Badge } from './badge';

const meta = {
    title: 'Primitives/Badge',
    component: Badge,
    argTypes: {
        variant: { control: 'select', options: ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] }
    }
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: (args) => (
        <Badge {...args}>
            <T text={TEXT.approved} />
        </Badge>
    )
};

export const Variants: Story = {
    render: () => (
        <div className="flex flex-wrap items-center gap-2">
            {(['default', 'secondary', 'destructive', 'outline'] as const).map((variant) => (
                <Badge key={variant} variant={variant}>
                    <T text={TEXT.pending} />
                </Badge>
            ))}
        </div>
    )
};

export const LongText: Story = {
    render: () => (
        <div className="max-w-xs">
            <Badge variant="secondary" className="h-auto whitespace-normal">
                <T text={TEXT.longWoreda} />
            </Badge>
        </div>
    )
};
