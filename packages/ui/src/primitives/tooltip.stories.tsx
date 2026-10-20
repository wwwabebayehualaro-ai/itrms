import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = {
    title: 'Primitives/Tooltip',
    component: Tooltip
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rendered open so the content is what is checked. The preview already provides the TooltipProvider. */
export const Default: Story = {
    render: () => (
        <div className="flex min-h-24 items-end">
            <Tooltip defaultOpen>
                <TooltipTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.moreDetails} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <T text={TEXT.moreDetailsBody} />
                </TooltipContent>
            </Tooltip>
        </div>
    )
};

function IconTriggerDemo() {
    const label = useText(TEXT.moreDetails);
    return (
        <div className="flex min-h-24 items-end">
            <Tooltip defaultOpen>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={label}>
                        <Info aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    <T text={TEXT.moreDetails} />
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

export const OnIconButton: Story = { render: () => <IconTriggerDemo /> };

export const LongText: Story = {
    render: () => (
        <div className="flex min-h-32 items-end">
            <Tooltip defaultOpen>
                <TooltipTrigger asChild>
                    <Button variant="outline">
                        <T text={TEXT.woreda} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <T text={TEXT.longWoreda} />
                </TooltipContent>
            </Tooltip>
        </div>
    )
};
