import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from './popover';

const meta = {
    title: 'Primitives/Popover',
    component: Popover
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rendered open so the content is what is checked. */
export const Default: Story = {
    render: () => (
        <div className="min-h-48">
            <Popover defaultOpen>
                <PopoverTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.moreDetails} />
                    </Button>
                </PopoverTrigger>
                <PopoverContent>
                    <PopoverHeader>
                        <PopoverTitle>
                            <T text={TEXT.bolo} />
                        </PopoverTitle>
                        <PopoverDescription>
                            <T text={TEXT.moreDetailsBody} />
                        </PopoverDescription>
                    </PopoverHeader>
                </PopoverContent>
            </Popover>
        </div>
    )
};

export const LongText: Story = {
    render: () => (
        <div className="min-h-64">
            <Popover defaultOpen>
                <PopoverTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.moreDetails} />
                    </Button>
                </PopoverTrigger>
                <PopoverContent>
                    <PopoverHeader>
                        <PopoverTitle>
                            <T text={TEXT.longLabel} />
                        </PopoverTitle>
                        <PopoverDescription>
                            <T text={TEXT.longWoreda} />
                        </PopoverDescription>
                    </PopoverHeader>
                </PopoverContent>
            </Popover>
        </div>
    )
};
