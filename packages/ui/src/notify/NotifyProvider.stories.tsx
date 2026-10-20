import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../primitives/button';
import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import { NotifyProvider, useNotify } from './NotifyProvider';

const meta = {
    title: 'Notify/NotifyProvider',
    component: NotifyProvider,
    // required by the type; every story renders its own content
    args: { children: null }
} satisfies Meta<typeof NotifyProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

function ToastButtons({ kind, long }: { kind: 'success' | 'error' | 'warn' | 'info'; long?: boolean }) {
    const notify = useNotify();
    // Toasts live in a module-level store: clear them so one story does not show in the next.
    useEffect(() => () => void toast.dismiss(), []);
    const words = useTexts({
        success: TEXT.saved,
        error: TEXT.failed,
        warn: TEXT.warnText,
        info: TEXT.infoText,
        long: TEXT.confirmDeleteMessage,
        title: TEXT.alertTitle
    });
    return (
        // life: Infinity, so the toast is still shown when axe and the screenshot look at it (the defaults are 3-6 s)
        <Button
            variant="outline"
            onClick={() =>
                notify.show({
                    severity: kind,
                    summary: words.title,
                    detail: long ? words.long : words[kind],
                    life: Infinity
                })
            }
        >
            <T text={TEXT.showToast} />
        </Button>
    );
}

/** The play function shows the toast, so it is part of the accessibility check. */
const showToast: Story['play'] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
    await waitFor(() => expect(document.querySelector('[data-sonner-toast][data-mounted="true"]')).not.toBeNull());
};

export const Success: Story = {
    render: () => (
        <NotifyProvider>
            <ToastButtons kind="success" />
        </NotifyProvider>
    ),
    play: showToast
};

export const Failure: Story = {
    render: () => (
        <NotifyProvider>
            <ToastButtons kind="error" />
        </NotifyProvider>
    ),
    play: showToast
};

export const Warning: Story = {
    render: () => (
        <NotifyProvider>
            <ToastButtons kind="warn" />
        </NotifyProvider>
    ),
    play: showToast
};

export const LongText: Story = {
    render: () => (
        <NotifyProvider>
            <ToastButtons kind="info" long />
        </NotifyProvider>
    ),
    play: showToast
};
