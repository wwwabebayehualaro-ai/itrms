import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), request: vi.fn() }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({
    ...(await original<typeof UI>()),
    useNotify: () => notify
}));

import { FormDesigner } from './';
import { useBuilderActions } from './';
import { hostRenderer } from '../test-utils';

const ALL = ['submission:update', 'submission:delete', 'submission:export', 'template:update', 'view:create'];
const renderWithQuery = hostRenderer({
    client,
    user: {
        id: 'u1',
        email: 'e@example.org',
        full_name: 'Editor',
        roles: ['editor'],
        tenant_id: 't1',
        permissions: ALL
    }
});

/** Puts a saved form in the builder store, as the gallery's "Edit" does, then opens the builder. */
function open(template: any) {
    const { result } = renderHook(() => useBuilderActions());
    act(() => {
        result.current.setTemplate(template);
        result.current.setFields(template.form_config.fields);
        result.current.setRuntime(template.form_config.runtime ?? { dataSources: [] });
    });
    return renderWithQuery(<FormDesigner />);
}

const field = (id: string, type: string, label: string, extra: Record<string, any> = {}) => ({
    id,
    type,
    label,
    category: 'Input',
    props: {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } },
    ...extra
});
const saved = {
    id: 'tpl-1',
    name: 'Trip',
    slug: 'trip',
    row_version: 3,
    status: 'published',
    published_version_id: 'v1',
    form_config: { fields: [field('destination', 'InputText', 'Destination')], runtime: { dataSources: [] } }
};

describe('FormDesigner', () => {
    it('adds a field from the palette, edits it, undoes, deletes with the keyboard and saves version 2', async () => {
        const user = userEvent.setup();
        client.get.mockResolvedValue({ data: [] });
        // the forms API answers with the form as it now is (its wire shape)
        client.patch.mockImplementation((_url: string, body: any) =>
            Promise.resolve({
                data: {
                    id: 'tpl-1',
                    version: 4,
                    key: 'trip',
                    name: { am: saved.name, en: saved.name },
                    category: null,
                    active: true,
                    status: 'draft',
                    ownerUnit: { id: 'u-1', code: 'Z', name: { en: 'Zone' } },
                    publishedVersion: null,
                    updatedAt: '2026-10-25T08:00:00.000Z',
                    document: body.document
                }
            })
        );
        open(saved);

        // the saved field is on the canvas, drawn as it will be filled in
        const canvas = screen.getByRole('main');
        expect(within(canvas).getByText('Destination')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled(); // nothing changed yet

        // add a number from the palette: it is selected and its settings open
        await user.click(screen.getByRole('button', { name: 'Add Number' }));
        const inspector = screen.getByRole('complementary', { name: 'Field settings' });
        const label = within(inspector).getByLabelText('Label');
        expect(label).toHaveValue('Number');
        await user.clear(label);
        await user.type(label, 'Budget');
        expect(within(canvas).getByText('Budget')).toBeInTheDocument();
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

        // typing the label was one step: one undo brings back "Number", a second removes the field
        await user.click(screen.getByRole('button', { name: 'Undo' }));
        expect(within(inspector).getByLabelText('Label')).toHaveValue('Number');
        expect(within(canvas).queryByText('Budget')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Redo' }));
        expect(within(inspector).getByLabelText('Label')).toHaveValue('Budget');

        // a key that is already used is refused
        const key = within(inspector).getByLabelText('Key');
        await user.clear(key);
        await user.type(key, 'destination');
        expect(within(inspector).getByText('Another field already uses this key.')).toBeInTheDocument();
        await user.clear(key);
        await user.type(key, 'budget{Enter}');

        // the original field, selected and deleted with the Delete key
        await user.click(canvas.querySelector('[data-design-field="destination"]') as HTMLElement);
        act(() => void document.body.focus());
        await user.keyboard('{Delete}');
        expect(within(canvas).queryByText('Destination')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /^Save$/ }));
        await waitFor(() => expect(client.patch).toHaveBeenCalledTimes(1));
        const [url, body, options] = client.patch.mock.calls[0] ?? [];
        expect(url).toBe('v1/forms/tpl-1');
        // the version it was based on goes as If-Match: a concurrent edit is refused, never overwritten
        expect(options.headers['if-match']).toBe('"3"');
        expect(body.document.schemaVersion).toBe(2);
        expect(body.document.fields.map((f: any) => [f.id, f.type, f.label])).toEqual([
            ['budget', 'InputNumber', 'Budget']
        ]);
        await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    });

    it('previews the form on the real renderer and shows what would be stored', async () => {
        const user = userEvent.setup();
        client.get.mockResolvedValue({ data: [] });
        open(saved);
        await user.click(screen.getByRole('radio', { name: /Preview/ }));
        await user.type(screen.getByLabelText('Destination'), 'Lisbon');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        expect(await screen.findByText(/"destination": "Lisbon"/)).toBeInTheDocument();
        expect(client.post).not.toHaveBeenCalled();
    });
});
