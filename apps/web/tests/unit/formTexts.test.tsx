// Texts of a stored form in every language (task 0.17a): the languages a form is translated into, the settings form's
// one-name-per-language fields, and the publish warning for texts without Amharic or English.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotifyProvider } from '@itrms/ui';

const engine = vi.hoisted(() => ({
    update: vi.fn(),
    publish: vi.fn(),
    load: vi.fn(),
    list: [] as unknown[]
}));
vi.mock('@itrms/form-engine/renderer', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useFormsLanguages: () => ({ language: 'am', languages: ['am', 'en', 'om'] }),
    useTemplateMutations: () => ({
        update: { mutateAsync: engine.update },
        publish: { mutate: engine.publish, isPending: false, variables: undefined },
        remove: { mutateAsync: vi.fn() }
    }),
    useTemplateLoader: () => engine.load,
    useTemplateList: () => ({ data: engine.list, isPending: false, error: null, refetch: vi.fn() })
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/form-templates/TemplatePreviewDialog', () => ({ default: () => null }));
vi.mock('@/lib/auth/authHooks', () => ({ useCan: () => true }));

import { TemplateSettingsForm } from '@/form-templates/TemplateSettingsForm';
import TemplatesManager from '@/form-templates/TemplatesManager';
import { formLanguages } from '@/lib/preferences';
import type { IFormTemplate } from '@/types/template_builder/form';
import { renderWithQuery } from './test-utils';

describe('formLanguages', () => {
    it('puts Amharic and English first, keeps om and ti, drops unknown tags and duplicates', () => {
        expect(formLanguages(['en', 'om', 'xx', 'ti', 'om', 'am', 3])).toEqual(['am', 'en', 'om', 'ti']);
        expect(formLanguages(undefined)).toEqual(['am', 'en']);
        expect(formLanguages(['wal-Latn'])).toEqual(['am', 'en', 'wal-Latn']);
    });
});

const template = {
    id: 't1',
    name: 'Leave',
    slug: 'leave',
    version: 1,
    status: 'draft',
    is_active: true,
    category: '',
    row_version: 2,
    names: { am: 'ፈቃድ', en: 'Leave' },
    form_config: {}
} as unknown as IFormTemplate;

describe('TemplateSettingsForm', () => {
    beforeEach(() => engine.update.mockReset().mockResolvedValue({}));

    it('requires Amharic and English', async () => {
        renderWithQuery(
            <NotifyProvider>
                <TemplateSettingsForm template={template} onSaved={vi.fn()} />
            </NotifyProvider>
        );
        await userEvent.clear(screen.getByLabelText(/Name \(English\)/));
        await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(await screen.findByText('A form needs a name')).toBeInTheDocument();
        expect(engine.update).not.toHaveBeenCalled();
    });

    it('keeps a name in a language the installation no longer lists', async () => {
        const user = userEvent.setup();
        renderWithQuery(
            <NotifyProvider>
                <TemplateSettingsForm
                    template={{ ...template, names: { am: 'ፈቃድ', en: 'Leave', 'wal-Latn': 'Hayyama' } }}
                    onSaved={() => undefined}
                />
            </NotifyProvider>
        );
        // an untouched save leaves the names alone (the wal-Latn name is not one of the listed languages)
        await user.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(engine.update).toHaveBeenCalled());
        expect(engine.update.mock.lastCall?.[0].data).not.toHaveProperty('names');
        await user.clear(screen.getByLabelText(/Name \(English\)/));
        await user.type(screen.getByLabelText(/Name \(English\)/), 'Leave request');
        await user.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(engine.update).toHaveBeenCalled());
        expect(engine.update.mock.lastCall?.[0].data.names).toEqual({
            am: 'ፈቃድ',
            en: 'Leave request',
            'wal-Latn': 'Hayyama'
        });
    });

    it('sends the names only when they changed, optional languages dropped when empty', async () => {
        const onSaved = vi.fn();
        renderWithQuery(
            <NotifyProvider>
                <TemplateSettingsForm template={template} onSaved={onSaved} />
            </NotifyProvider>
        );
        await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(engine.update.mock.calls[0][0].data).not.toHaveProperty('names');

        await userEvent.type(screen.getByLabelText(/Name \(Afaan Oromoo\)/), 'Hayyama');
        await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(engine.update).toHaveBeenCalledTimes(2));
        expect(engine.update.mock.calls[1][0].data.names).toEqual({ am: 'ፈቃድ', en: 'Leave', om: 'Hayyama' });
    });
});

describe('publishing a form with untranslated texts', () => {
    beforeEach(() => {
        engine.publish.mockReset();
        engine.list = [template];
        engine.load.mockReset();
    });

    it('asks first, then publishes after confirming', async () => {
        engine.load.mockResolvedValue({
            ...template,
            form_config: { fields: [{ id: 'f1', type: 'text', label: { am: 'ስም' } }] }
        });
        renderWithQuery(
            <NotifyProvider>
                <TemplatesManager />
            </NotifyProvider>
        );
        await userEvent.click(screen.getByRole('button', { name: 'Publish Leave' }));
        expect(await screen.findByText(/1 text has no Amharic or English text/)).toBeInTheDocument();
        expect(engine.publish).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Publish anyway' }));
        await waitFor(() => expect(engine.publish).toHaveBeenCalledWith({ id: 't1' }, expect.anything()));
    });

    it('publishes straight away when every text is translated', async () => {
        engine.load.mockResolvedValue({
            ...template,
            form_config: { fields: [{ id: 'f1', type: 'text', label: { am: 'ስም', en: 'Name' } }] }
        });
        renderWithQuery(
            <NotifyProvider>
                <TemplatesManager />
            </NotifyProvider>
        );
        await userEvent.click(screen.getByRole('button', { name: 'Publish Leave' }));
        await waitFor(() => expect(engine.publish).toHaveBeenCalled());
        expect(screen.queryByText(/no Amharic or English/)).not.toBeInTheDocument();
    });
});
