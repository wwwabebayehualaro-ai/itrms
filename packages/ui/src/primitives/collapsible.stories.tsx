import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronsUpDown } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

const meta = {
    title: 'Primitives/Collapsible',
    component: Collapsible
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
    render: () => (
        <Collapsible defaultOpen className="max-w-md space-y-2">
            <CollapsibleTrigger asChild>
                <Button variant="outline">
                    <T text={TEXT.moreDetails} />
                    <ChevronsUpDown aria-hidden="true" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <T text={TEXT.moreDetailsBody} />
            </CollapsibleContent>
        </Collapsible>
    )
};

export const Closed: Story = {
    render: () => (
        <Collapsible className="max-w-md space-y-2">
            <CollapsibleTrigger asChild>
                <Button variant="outline">
                    <T text={TEXT.moreDetails} />
                    <ChevronsUpDown aria-hidden="true" />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <T text={TEXT.moreDetailsBody} />
            </CollapsibleContent>
        </Collapsible>
    )
};

export const LongText: Story = {
    render: () => (
        <Collapsible defaultOpen className="max-w-xs space-y-2">
            <CollapsibleTrigger asChild>
                <Button variant="outline" className="h-auto whitespace-normal">
                    <T text={TEXT.longLabel} />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <T text={TEXT.longWoreda} />
            </CollapsibleContent>
        </Collapsible>
    )
};
