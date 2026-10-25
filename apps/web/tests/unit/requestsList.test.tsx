import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Renderer from '@itrms/form-engine/renderer';

const hooks = vi.hoisted(() => ({ useSubmissionList: vi.fn(), useTemplateList: vi.fn() }));
vi.mock('@itrms/form-engine/renderer', async (original) => ({ ...(await original<typeof Renderer>()), ...hooks }));

import { RequestsList } from '../../app/(main)/(forms)/submitted-forms/RequestsList';
import { renderWithQuery } from './test-utils';

const row = (id: string) => ({
    id,
    template_id: 'f1',
    submission_data: {},
    submitted_by: 'me',
    submitted_by_name: 'Almaz T.',
    handling_unit: 'u1',
    handling_unit_name: 'Damot Gale',
    created_at: '2026-10-22T07:00:00.000Z',
    updated_at: '2026-10-22T07:00:00.000Z',
    version: 2
});

describe('RequestsList (my requests across forms)', () => {
    beforeEach(() => {
        hooks.useTemplateList.mockReturnValue({ data: [{ id: 'f1', name: 'Trip request' }] });
        hooks.useSubmissionList.mockImplementation(({ before }: { before?: string }) =>
            before === 'cursor-1'
                ? { data: { items: [row('bbbbbbbb-2')], next: null }, isPending: false, error: null }
                : { data: { items: [row('aaaaaaaa-1')], next: 'cursor-1' }, isPending: false, error: null }
        );
    });

    it('lists only the caller’s own, with the form and the office, and pages by cursor', async () => {
        renderWithQuery(<RequestsList title="My requests" description="Yours" />);
        expect(hooks.useSubmissionList).toHaveBeenLastCalledWith({ mine: true, limit: 20, before: undefined });
        expect(screen.getByText('Trip request')).toBeInTheDocument();
        expect(screen.getByText('Damot Gale')).toBeInTheDocument();
        expect(screen.getByText('aaaaaaaa')).toHaveAttribute('href', '/submitted-forms/template/f1/aaaaaaaa-1');

        await userEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(hooks.useSubmissionList).toHaveBeenLastCalledWith({ mine: true, limit: 20, before: 'cursor-1' });
        expect(screen.getByText('bbbbbbbb')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: /previous/i }));
        expect(screen.getByText('aaaaaaaa')).toBeInTheDocument();
    });
});
