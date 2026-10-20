import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T } from '../stories/locale';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from './alert-dialog';
import { buttonVariants } from './button';

const meta = {
    title: 'Primitives/AlertDialog',
    component: AlertDialog
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rendered open so the dialog itself is what is checked. */
export const Default: Story = {
    render: () => (
        <AlertDialog defaultOpen>
            <AlertDialogTrigger asChild>
                <button type="button" className={buttonVariants({ variant: 'outline' })}>
                    <T text={TEXT.delete} />
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <T text={TEXT.confirmDeleteTitle} />
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        <T text={TEXT.confirmDeleteMessage} />
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>
                        <T text={TEXT.keep} />
                    </AlertDialogCancel>
                    <AlertDialogAction className={buttonVariants({ variant: 'destructive' })}>
                        <T text={TEXT.delete} />
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
};

export const Closed: Story = {
    render: () => (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <button type="button" className={buttonVariants({ variant: 'outline' })}>
                    <T text={TEXT.delete} />
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <T text={TEXT.confirmDeleteTitle} />
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        <T text={TEXT.confirmDeleteMessage} />
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>
                        <T text={TEXT.keep} />
                    </AlertDialogCancel>
                    <AlertDialogAction>
                        <T text={TEXT.delete} />
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
};

export const LongText: Story = {
    render: () => (
        <AlertDialog defaultOpen>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <T text={TEXT.longLabel} />
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        <T text={TEXT.confirmDeleteMessage} />
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>
                        <T text={TEXT.keep} />
                    </AlertDialogCancel>
                    <AlertDialogAction>
                        <T text={TEXT.longWoreda} />
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
};
