import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Button } from './button';
import { Toaster } from './sonner';

const meta = {
    title: 'Primitives/Sonner',
    component: Toaster
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

function ToastDemo({ kind }: { kind: 'success' | 'error' | 'warning' | 'info' }) {
    // Toasts live in a module-level store: clear them so one story does not show in the next.
    useEffect(() => () => void toast.dismiss(), []);
    const texts = {
        success: useText(TEXT.saved),
        error: useText(TEXT.failed),
        warning: useText(TEXT.warnText),
        info: useText(TEXT.infoText)
    };
    return (
        <>
            {/* one landmark per story: a toaster left by the previous story must not share its name (axe landmark-unique) */}
            <Toaster closeButton richColors containerAriaLabel={`Notifications (${kind})`} />
            <Button variant="outline" onClick={() => toast[kind](texts[kind], { duration: Infinity })}>
                <T text={TEXT.showToast} />
            </Button>
        </>
    );
}

const showToast: Story['play'] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
    // The toast renders in the toaster's own region, outside the story root, and fades in: wait until it is shown.
    await waitFor(() => {
        const toast = document.querySelector<HTMLElement>('[data-sonner-toast][data-mounted="true"]');
        return expect(toast?.textContent?.trim()).toBeTruthy();
    });
};

/** Click the button to show a toast; the toaster is mounted once by NotifyProvider in the app. */
export const Default: Story = { render: () => <ToastDemo kind="success" />, play: showToast };

export const Failure: Story = { render: () => <ToastDemo kind="error" />, play: showToast };

export const Warning: Story = { render: () => <ToastDemo kind="warning" />, play: showToast };

export const Info: Story = { render: () => <ToastDemo kind="info" />, play: showToast };
