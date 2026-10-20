import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { screen, userEvent, within } from 'storybook/test';

import { NotifyProvider } from '../notify/NotifyProvider';
import { Button } from '../primitives/button';
import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import { confirmAction, confirmStore } from './confirmAction';

// The confirm dialog is mounted by NotifyProvider; `confirmAction()` is the plain function pages call.
const meta = {
    title: 'Feedback/confirmAction',
    parameters: { layout: 'padded' }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ConfirmDemo({ danger, long }: { danger?: boolean; long?: boolean }) {
    const words = useTexts({
        header: long ? TEXT.longLabel : TEXT.confirmDeleteTitle,
        message: TEXT.confirmDeleteMessage,
        accept: TEXT.delete,
        reject: TEXT.keep
    });
    // A confirmation still open when the story is left must not appear in the next story.
    useEffect(() => () => confirmStore.settle(false), []);
    return (
        <Button
            variant="outline"
            onClick={() =>
                void confirmAction({
                    header: words.header,
                    message: words.message,
                    danger,
                    acceptLabel: words.accept,
                    rejectLabel: words.reject
                })
            }
        >
            <T text={TEXT.askConfirm} />
        </Button>
    );
}

const askConfirmation: Story['play'] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
    await screen.findByRole('alertdialog');
};

/** The play function asks, so the open dialog is what is checked. */
export const Default: Story = {
    render: () => (
        <NotifyProvider>
            <ConfirmDemo />
        </NotifyProvider>
    ),
    play: askConfirmation
};

export const Danger: Story = {
    render: () => (
        <NotifyProvider>
            <ConfirmDemo danger />
        </NotifyProvider>
    ),
    play: askConfirmation
};

export const LongText: Story = {
    render: () => (
        <NotifyProvider>
            <ConfirmDemo danger long />
        </NotifyProvider>
    ),
    play: askConfirmation
};
