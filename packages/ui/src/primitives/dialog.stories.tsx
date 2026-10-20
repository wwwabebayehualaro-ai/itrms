import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import { Button } from './button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from './dialog';
import { Input } from './input';
import { Label } from './label';

const meta = {
    title: 'Primitives/Dialog',
    component: Dialog
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rendered open so the dialog itself is what is checked. */
export const Default: Story = {
    render: () => (
        <Dialog defaultOpen>
            <DialogTrigger asChild>
                <Button variant="outline">
                    <T text={TEXT.edit} />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <T text={TEXT.newApplication} />
                    </DialogTitle>
                    <DialogDescription>
                        <T text={TEXT.applicationHelp} />
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="dialog-name">
                        <T text={TEXT.applicantName} />
                    </Label>
                    <Input id="dialog-name" />
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">
                            <T text={TEXT.cancel} />
                        </Button>
                    </DialogClose>
                    <Button>
                        <T text={TEXT.save} />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
};

export const WithoutCloseButton: Story = {
    render: () => (
        <Dialog defaultOpen>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>
                        <T text={TEXT.bolo} />
                    </DialogTitle>
                    <DialogDescription>
                        <T text={TEXT.moreDetailsBody} />
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>
                            <T text={TEXT.close} />
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
};

export const LongText: Story = {
    render: () => (
        <Dialog defaultOpen>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <T text={TEXT.longLabel} />
                    </DialogTitle>
                    <DialogDescription>
                        <T text={TEXT.longWoreda} />
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    )
};
