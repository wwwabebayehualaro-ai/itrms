import { ApiError } from '@/lib/api/http';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: api }));

import { ApprovalInbox } from '@/screens/ApprovalInbox';
import { renderWithQuery } from './test-utils';

const request = {
    id: 'a1',
    policy: 'template.publish',
    policy_title: 'Publish a form',
    resource_type: 'form_templates',
    resource_id: 't1',
    title: 'Publish “Leave Request”',
    status: 'pending',
    note: 'New approval step',
    payload: { version: '1.2.0' },
    requested_by: 'u1',
    requested_by_name: 'Priya Nair',
    created_at: '2026-10-15T10:00:00Z',
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    comment: null,
    row_version: 1,
    can_decide: true,
    can_cancel: false
};
const problem = (data: unknown) =>
    new ApiError('failed', 'ERR_BAD_RESPONSE', { url: 'x' }, { status: 422, headers: {}, data });

describe('ApprovalInbox', () => {
    beforeEach(() => {
        api.get.mockReset().mockResolvedValue({ data: { items: [request], total: 1, page: 1, page_size: 20 } });
        api.post.mockReset();
    });

    it('opens a request, shows the server’s reason error on the field, then rejects', async () => {
        api.post
            .mockRejectedValueOnce(
                problem({ detail: 'Say why', errors: [{ field: 'comment', message: 'A reason is required' }] })
            )
            .mockResolvedValueOnce({ data: { ...request, status: 'rejected' } });
        renderWithQuery(<ApprovalInbox />);
        await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByText('Priya Nair')).toBeInTheDocument();
        expect(within(sheet).getByText('1.2.0')).toBeInTheDocument();

        await userEvent.click(within(sheet).getByRole('button', { name: /reject/i }));
        expect(await within(sheet).findByText('A reason is required')).toBeInTheDocument();
        expect(api.post).toHaveBeenLastCalledWith('platform/approvals/a1/reject', { comment: '', row_version: 1 });

        await userEvent.type(within(sheet).getByLabelText('Comment'), 'Wrong department');
        await userEvent.click(within(sheet).getByRole('button', { name: /reject/i }));
        await waitFor(() =>
            expect(api.post).toHaveBeenLastCalledWith('platform/approvals/a1/reject', {
                comment: 'Wrong department',
                row_version: 1
            })
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('approves with an optional comment', async () => {
        api.post.mockResolvedValue({ data: { ...request, status: 'approved' } });
        renderWithQuery(<ApprovalInbox />);
        await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
        await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /approve/i }));
        await waitFor(() =>
            expect(api.post).toHaveBeenCalledWith('platform/approvals/a1/approve', { comment: null, row_version: 1 })
        );
    });
});
