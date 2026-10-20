import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Spinner } from './spinner';

const meta = {
    title: 'Primitives/Spinner',
    component: Spinner
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

function WithTextDemo() {
    const label = useText(TEXT.loading);
    return (
        <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner aria-label={label} />
            <T text={TEXT.loading} />
        </div>
    );
}

export const WithText: Story = { render: () => <WithTextDemo /> };

export const Sizes: Story = {
    render: () => (
        <div className="flex items-center gap-4">
            <Spinner className="size-3" />
            <Spinner />
            <Spinner className="size-8" />
        </div>
    )
};
