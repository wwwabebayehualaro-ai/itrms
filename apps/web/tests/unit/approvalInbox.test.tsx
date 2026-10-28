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
// what approving it would do (GET form-publications/:id/review)
const review = {
    canPublish: true,
    base: { id: 'v2', number: 2 },
    candidate: { id: 'v3', number: 3 },
    problems: [],
    tests: [],
    diff: {
        added: [{ key: 'reason', label: 'Reason' }],
        removed: [],
        restored: [],
        changed: [],
        form: []
    },
    impact: {
        views: [
            {
                id: 'sv1',
                name: 'Long leaves',
                visibility: 'unit',
                unit: { id: 'u', code: 'Z', name: { en: 'Zone' } },
                mine: false,
                keys: [{ key: 'days', reasons: ['column'] }]
            }
        ]
    }
};
// the server filters by scope (task 0.20d): "decidable" what the caller may decide, "mine" what they asked for
const listOr =
    (items: { canDecide?: boolean; requestedBy?: string; [key: string]: unknown }[]) =>
    (url: string, config?: { params?: { scope?: string } }) => {
        const scope = config?.params?.scope;
        const kept = items.filter((i) =>
            scope === 'decidable' ? i.canDecide : scope === 'mine' ? i.requestedBy === 'me' : true
        );
        return Promise.resolve({ data: url.endsWith('/review') ? review : { items: kept, next: null } });
    };
const ifMatch = { headers: { 'if-match': '"1"' } };
const problem = (data: unknown) =>
    new ApiError('failed', 'ERR_BAD_RESPONSE', { url: 'x' }, { status: 422, headers: {}, data });

describe('ApprovalInbox', () => {
    beforeEach(() => {
        api.get.mockReset().mockImplementation(listOr([request]));
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
        // the review of what approving would do: the change and the saved view it touches
        expect(await within(sheet).findByText('Long leaves')).toBeInTheDocument();
        expect(within(sheet).getByText('Reason')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('v1/form-publications/a1/review', expect.anything());
        expect(api.get).toHaveBeenCalledWith(
            'v1/form-publications',
            expect.objectContaining({ params: expect.objectContaining({ status: 'pending', scope: 'decidable' }) })
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
        api.get.mockReset().mockImplementation(
            listOr([
                request,
                {
                    ...request,
                    id: 'a2',
                    formName: { en: 'Own form' },
                    requestedBy: 'me',
                    canDecide: false,
                    canWithdraw: true
                }
            ])
        );
        renderWithQuery(<ApprovalInbox />);
        expect(await screen.findByText('Publish “Leave Request” (version 3)')).toBeInTheDocument();
        expect(screen.queryByText('Publish “Own form” (version 3)')).not.toBeInTheDocument();
    });
});
