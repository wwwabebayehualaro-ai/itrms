import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from './sheet';

const meta = {
    title: 'Primitives/Sheet',
    component: Sheet
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rendered open so the panel itself is what is checked. */
export const Default: Story = {
    render: () => (
        <Sheet defaultOpen>
            <SheetTrigger asChild>
                <Button variant="outline">
                    <T text={TEXT.edit} />
                </Button>
            </SheetTrigger>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>
                        <T text={TEXT.newApplication} />
                    </SheetTitle>
                    <SheetDescription>
                        <T text={TEXT.applicationHelp} />
                    </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-2 px-4">
                    <Label htmlFor="sheet-name">
                        <T text={TEXT.applicantName} />
                    </Label>
                    <Input id="sheet-name" />
                </div>
                <SheetFooter>
                    <Button>
                        <T text={TEXT.save} />
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
};

export const FromLeft: Story = {
    render: () => (
        <Sheet defaultOpen>
            <SheetContent side="left">
                <SheetHeader>
                    <SheetTitle>
                        <T text={TEXT.menu} />
                    </SheetTitle>
                    <SheetDescription>
                        <T text={TEXT.moreDetailsBody} />
                    </SheetDescription>
                </SheetHeader>
            </SheetContent>
        </Sheet>
    )
};

export const LongText: Story = {
    render: () => (
        <Sheet defaultOpen>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>
                        <T text={TEXT.longLabel} />
                    </SheetTitle>
                    <SheetDescription>
                        <T text={TEXT.longWoreda} />
                    </SheetDescription>
                </SheetHeader>
            </SheetContent>
        </Sheet>
    )
};
