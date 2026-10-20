import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton } from './skeleton';

const meta = {
    title: 'Primitives/Skeleton',
    component: Skeleton
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    render: () => <Skeleton className="h-4 w-64" />
};

/** A card-shaped placeholder shown while a record loads. */
export const CardPlaceholder: Story = {
    render: () => (
        <div className="flex items-center gap-4" aria-hidden="true">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-40" />
            </div>
        </div>
    )
};
