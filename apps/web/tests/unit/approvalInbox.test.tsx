import { ApiError } from '@/lib/api/http';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: api }));

import { ApprovalInbox } from '@/screens/ApprovalInbox';
import { renderWithQuery } from './test-utils';

// a publication as the forms API sends it
const request = {
    id: 'a1',
    version: 1,
    formId: 'f1',
    formName: { am: 'የፈቃድ ጥያቄ', en: 'Leave Request' },
    formVersion: { id: 'v3', number: 3 },
    status: 'pending',
    note: 'New approval step',
    requestedBy: 'u1',
    requestedByName: 'Priya Nair',
    requestedAt: '2026-10-15T10:00:00Z',
    decidedBy: null,
    decidedByName: null,
    canDecide: true,
    canWithdraw: false,
    decidedAt: null,
    decisionNote: null
};
const ifMatch = { headers: { 'if-match': '"1"' } };
const problem = (data: unknown) =>
    new ApiError('failed', 'ERR_BAD_RESPONSE', { url: 'x' }, { status: 422, headers: {}, data });

describe('ApprovalInbox', () => {
    beforeEach(() => {
        api.get.mockReset().mockResolvedValue({ data: { items: [request] } });
        api.post.mockReset();
    });

    it('opens a request, shows the server’s reason error on the field, then rejects', async () => {
        api.post
            .mockRejectedValueOnce(
                problem({ detail: 'Say why', errors: [{ field: 'note', message: 'A reason is required' }] })
            )
            .mockResolvedValueOnce({ data: { ...request, status: 'rejected' } });
        renderWithQuery(<ApprovalInbox />);
        await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByText('Priya Nair')).toBeInTheDocument();
        expect(within(sheet).getByText('Publish “Leave Request” (version 3)')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith(
            'v1/form-publications',
            expect.objectContaining({ params: { status: 'pending' } })
        );

        await userEvent.click(within(sheet).getByRole('button', { name: /reject/i }));
        expect(await within(sheet).findByText('A reason is required')).toBeInTheDocument();
        expect(api.post).toHaveBeenLastCalledWith('v1/form-publications/a1/rejection', { note: '' }, ifMatch);

        await userEvent.type(within(sheet).getByLabelText('Comment'), 'Wrong department');
        await userEvent.click(within(sheet).getByRole('button', { name: /reject/i }));
        await waitFor(() =>
            expect(api.post).toHaveBeenLastCalledWith(
                'v1/form-publications/a1/rejection',
                { note: 'Wrong department' },
                ifMatch
            )
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('approves with an optional comment', async () => {
        api.post.mockResolvedValue({ data: { ...request, status: 'approved' } });
        renderWithQuery(<ApprovalInbox />);
        await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /approve/i }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('v1/form-publications/a1/approval', {}, ifMatch));
    });
});

describe('the inbox’s scopes', () => {
    it('shows only what the caller may decide under “To decide”, and their own under “My requests”', async () => {
        api.get.mockReset().mockResolvedValue({
            data: {
                items: [
                    request,
                    {
                        ...request,
                        id: 'a2',
                        formName: { en: 'Own form' },
                        requestedBy: 'me',
                        canDecide: false,
                        canWithdraw: true
                    }
                ]
            }
        });
        renderWithQuery(<ApprovalInbox />);
        expect(await screen.findByText('Publish “Leave Request” (version 3)')).toBeInTheDocument();
        expect(screen.queryByText('Publish “Own form” (version 3)')).not.toBeInTheDocument();
    });
});
