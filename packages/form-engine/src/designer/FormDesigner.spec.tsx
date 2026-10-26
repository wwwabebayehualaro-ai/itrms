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

const ALL = ['form:create', 'form:update', 'form:publish', 'submission:create', 'submission:read', 'submission:export'];
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
        // (the English label gave the new field the key "budget"; the undo goes back to "number", so the selection is gone)
        expect(within(canvas).getByText('Number')).toBeInTheDocument();
        expect(within(canvas).queryByText('Budget')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Redo' }));
        await user.click(within(canvas).getByText('Budget'));
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

    it('switches the language the texts are shown and edited in: canvas, inspector and preview follow', async () => {
        const user = userEvent.setup();
        client.get.mockResolvedValue({ data: [] });
        open({
            ...saved,
            form_config: {
                fields: [field('destination', 'InputText', { am: 'መድረሻ', en: 'Destination' } as never)],
                runtime: { dataSources: [] }
            }
        });
        const canvas = screen.getByRole('main');
        expect(within(canvas).getByText('መድረሻ')).toBeInTheDocument();

        await user.click(screen.getByRole('combobox', { name: 'Texts in' }));
        await user.click(await screen.findByRole('option', { name: 'English' }));
        expect(within(canvas).getByText('Destination')).toBeInTheDocument();
        // switching is no edit
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

        // editing writes English only; Amharic stays
        await user.click(canvas.querySelector('[data-design-field="destination"]') as HTMLElement);
        const label = within(screen.getByRole('complementary', { name: 'Field settings' })).getByLabelText('Label');
        expect(label).toHaveValue('Destination');
        await user.type(label, 's');
        expect(within(canvas).getByText('Destinations')).toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: /Preview/ }));
        expect(await screen.findByLabelText('Destinations')).toBeInTheDocument();
    });

    it('saves a new form with its name in Amharic and English (both required) and the key from the English one', async () => {
        const user = userEvent.setup();
        client.get.mockResolvedValue({ data: [] });
        client.post.mockImplementation((_url: string, body: any) =>
            Promise.resolve({
                data: {
                    id: 'tpl-9',
                    version: 1,
                    key: body.key,
                    name: body.name,
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
        open({ name: '', slug: '', form_config: { fields: saved.form_config.fields, runtime: { dataSources: [] } } });
        await user.click(screen.getByRole('button', { name: /Save as/ }));
        const dialog = await screen.findByRole('dialog');
        const save = within(dialog).getByRole('button', { name: 'Save form' });
        expect(save).toBeDisabled();
        await user.type(within(dialog).getByLabelText(/Name in አማርኛ/), 'የጉዞ ጥያቄ');
        expect(save).toBeDisabled(); // English is required too
        await user.type(within(dialog).getByLabelText(/Name in English/), 'Trip request');
        expect(save).toBeEnabled();
        await user.click(save);
        await waitFor(() => expect(client.post).toHaveBeenCalledTimes(1));
        const [url, body] = client.post.mock.calls[0] ?? [];
        expect(url).toBe('v1/forms');
        expect(body.name).toEqual({ am: 'የጉዞ ጥያቄ', en: 'Trip request' });
        expect(body.key).toBe('trip-request');
    });

    it('counts the same untranslated texts whatever language the builder is opened in', async () => {
        client.get.mockResolvedValue({ data: [] });
        const form = {
            ...saved,
            status: 'published' as const,
            form_config: {
                fields: [field('destination', 'InputText', 'Destination'), field('city', 'InputText', 'City')],
                runtime: { dataSources: [] }
            }
        };
        const counts: (string | null)[] = [];
        for (const language of ['am', 'en']) {
            const view = hostRenderer({
                client,
                language,
                user: {
                    id: 'u1',
                    email: 'e@example.org',
                    full_name: 'Editor',
                    roles: ['editor'],
                    tenant_id: 't1',
                    permissions: ALL
                }
            });
            const { result } = renderHook(() => useBuilderActions());
            act(() => {
                result.current.setTemplate(form);
                result.current.setFields(form.form_config.fields);
                result.current.setRuntime({ dataSources: [] });
            });
            const { unmount } = view(<FormDesigner />);
            counts.push(
                (
                    await screen
                        .findAllByText('Destination')
                        .then(() => document.querySelector('[data-untranslated-badge]'))
                )?.textContent ?? null
            );
            unmount();
        }
        expect(counts[0]).toBe(counts[1]);
        expect(counts[0]).toBe('2');
    });
});
