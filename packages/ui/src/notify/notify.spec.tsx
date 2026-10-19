import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotifyProvider, confirmAction } from '../index';

describe('confirmAction', () => {
    it('asks in a dialog and resolves with the answer', async () => {
        const user = userEvent.setup();
        render(<NotifyProvider>page</NotifyProvider>);
        const onAccept = vi.fn();
        let answer: Promise<boolean> | undefined;
        act(
            () =>
                void (answer = confirmAction({
                    header: 'Delete this request?',
                    message: 'This cannot be undone.',
                    acceptLabel: 'Delete',
                    danger: true,
                    onAccept
                }))
        );
        expect(await screen.findByRole('alertdialog', { name: 'Delete this request?' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        await expect(answer).resolves.toBe(true);
        expect(onAccept).toHaveBeenCalledOnce();
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

        const onReject = vi.fn();
        act(() => void (answer = confirmAction({ message: 'Leave?', rejectLabel: 'Stay', onReject })));
        await user.click(await screen.findByRole('button', { name: 'Stay' }));
        await expect(answer).resolves.toBe(false);
        expect(onReject).toHaveBeenCalledOnce();
    });

    it('declines a pending question when a new one is asked', async () => {
        render(<NotifyProvider>page</NotifyProvider>);
        let first: Promise<boolean> | undefined;
        act(() => void (first = confirmAction({ message: 'First?' })));
        act(() => void confirmAction({ message: 'Second?' }));
        await expect(first).resolves.toBe(false);
        expect(await screen.findByText('Second?')).toBeInTheDocument();
    });
});
